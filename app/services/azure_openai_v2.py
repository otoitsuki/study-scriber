#!/usr/bin/env python3
"""
音訊轉錄服務 v2
使用大切片（10-15秒）+ 直接轉換的架構，避免複雜的 WebM 合併
"""

import asyncio
import logging
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Any, Set
from uuid import UUID
import json
import os
from asyncio import PriorityQueue, Semaphore

from openai import AsyncAzureOpenAI, RateLimitError
from httpx import Timeout

# Task 5: Prometheus 監控依賴
try:
    import prometheus_client as prom
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False
    logger.warning("prometheus-client 未安裝，監控指標將被停用")

from ..db.database import get_supabase_client
from app.core.config import settings
from app.core.ffmpeg import detect_audio_format
from app.core.webm_header_repairer import WebMHeaderRepairer
from app.ws.transcript_feed import manager as transcript_manager
from app.services.r2_client import R2Client

logger = logging.getLogger(__name__)

# Task 5: Prometheus 監控指標
if PROMETHEUS_AVAILABLE:
    # 轉錄請求計數器
    WHISPER_REQ_TOTAL = prom.Counter(
        "whisper_requests_total",
        "Total Whisper API requests",
        ["status", "deployment"]
    )

    # 轉錄延遲指標
    WHISPER_LATENCY_SECONDS = prom.Summary(
        "whisper_latency_seconds",
        "Whisper API latency",
        ["deployment"]
    )

    # 隊列積壓指標
    WHISPER_BACKLOG_GAUGE = prom.Gauge(
        "whisper_backlog_size",
        "Current queue backlog size"
    )

    # 隊列處理統計
    QUEUE_PROCESSED_TOTAL = prom.Counter(
        "queue_processed_total",
        "Total processed jobs",
        ["status"]
    )

    # 隊列等待時間
    QUEUE_WAIT_SECONDS = prom.Summary(
        "queue_wait_seconds",
        "Time jobs spend waiting in queue"
    )

    # 併發處理數量
    CONCURRENT_JOBS_GAUGE = prom.Gauge(
        "concurrent_transcription_jobs",
        "Current number of concurrent transcription jobs"
    )

    logger.info("📊 [Metrics] Prometheus 監控指標已初始化")
else:
    # 如果 Prometheus 不可用，創建空的佔位符
    class NoOpMetric:
        def inc(self, *args, **kwargs): pass
        def set(self, *args, **kwargs): pass
        def time(self): return self
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def labels(self, *args, **kwargs): return self

    WHISPER_REQ_TOTAL = NoOpMetric()
    WHISPER_LATENCY_SECONDS = NoOpMetric()
    WHISPER_BACKLOG_GAUGE = NoOpMetric()
    QUEUE_PROCESSED_TOTAL = NoOpMetric()
    QUEUE_WAIT_SECONDS = NoOpMetric()
    CONCURRENT_JOBS_GAUGE = NoOpMetric()

# 全域效能監控開關
ENABLE_PERFORMANCE_LOGGING = os.getenv("ENABLE_PERFORMANCE_LOGGING", "true").lower() == "true"

# Task 1: 優化的 timeout 配置
TIMEOUT = Timeout(connect=5, read=55, write=30, pool=5)

# Task 3: 併發控制與任務優先級配置
MAX_CONCURRENT_TRANSCRIPTIONS = 1  # 單並發保證順序
QUEUE_HIGH_PRIORITY = 0  # 重試任務高優先級
QUEUE_NORMAL_PRIORITY = 1  # 正常任務
MAX_QUEUE_SIZE = 100  # 最大隊列大小
QUEUE_TIMEOUT_SECONDS = 300  # 隊列超時（5分鐘）

class PerformanceTimer:
    """效能計時器"""

    def __init__(self, operation_name: str):
        self.operation_name = operation_name
        self.start_time = None
        self.end_time = None

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.end_time = time.time()
        duration = self.get_duration()

        if ENABLE_PERFORMANCE_LOGGING:
            if duration > 1.0:  # 記錄超過1秒的操作
                logger.warning(f"⚠️  {self.operation_name} took {duration:.2f}s (slow)")
            else:
                logger.info(f"⏱️  {self.operation_name} completed in {duration:.2f}s")

    def get_duration(self) -> float:
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0

# Task 2: 智能頻率限制處理器
class RateLimitHandler:
    """智能頻率限制處理器 - 避免過長等待"""

    def __init__(self):
        self._delay = 0
        logger.info("🚦 [RateLimitHandler] 頻率限制處理器已初始化")

    async def wait(self):
        """等待當前延遲時間"""
        if self._delay:
            logger.info(f"⏳ [RateLimitHandler] 等待 {self._delay}s 避免頻率限制")
            await asyncio.sleep(self._delay)

    def backoff(self):
        """增加退避延遲（指數退避，最大 60 秒）"""
        previous_delay = self._delay
        self._delay = min((self._delay or 5) * 2, 60)  # 最大 60 秒
        logger.warning(f"📈 [RateLimitHandler] 退避延遲：{previous_delay}s → {self._delay}s")

    def reset(self):
        """重置延遲（API 呼叫成功時）"""
        if self._delay > 0:
            logger.info(f"✅ [RateLimitHandler] 重置延遲：{self._delay}s → 0s")
            self._delay = 0

# Task 3: 轉錄任務佇列管理器
class TranscriptionQueueManager:
    """優先級隊列管理器 - 確保順序處理並避免積壓"""

    def __init__(self):
        # 優先級隊列 (priority, timestamp, job_data)
        self.queue: PriorityQueue = PriorityQueue(maxsize=MAX_QUEUE_SIZE)
        # 併發控制信號量
        self.semaphore = Semaphore(MAX_CONCURRENT_TRANSCRIPTIONS)
        # Worker 任務
        self.workers: list[asyncio.Task] = []
        # Task 4: 積壓監控任務
        self.backlog_monitor_task: Optional[asyncio.Task] = None
        # 統計數據
        self.total_processed = 0
        self.total_failed = 0
        self.total_retries = 0
        # Task 4: 積壓閾值和監控間隔
        self.backlog_threshold = 30  # 超過 5 分鐘積壓 (30 任務 × 10秒)
        self.monitor_interval = 10  # 每 10 秒檢查一次
        self.last_backlog_alert = 0  # 上次積壓警報時間
        self.backlog_alert_cooldown = 60  # 積壓警報冷卻時間（秒）
        # 運行狀態
        self.is_running = False

        logger.info(f"🎯 [QueueManager] 初始化完成：max_concurrent={MAX_CONCURRENT_TRANSCRIPTIONS}, max_queue={MAX_QUEUE_SIZE}")

    async def start_workers(self, num_workers: int = 2):
        """啟動 Worker 任務"""
        if self.is_running:
            logger.warning("⚠️ [QueueManager] Workers already running")
            return

        self.is_running = True
        logger.info(f"🚀 [QueueManager] 啟動 {num_workers} 個 Workers")

        # 啟動工作線程
        for i in range(num_workers):
            worker_task = asyncio.create_task(self._worker(f"Worker-{i+1}"))
            self.workers.append(worker_task)

        # Task 4: 啟動積壓監控
        self.backlog_monitor_task = asyncio.create_task(self._backlog_monitor())
        logger.info("📊 [QueueManager] 積壓監控已啟動")

    async def stop_workers(self):
        """停止所有 Workers"""
        if not self.is_running:
            return

        logger.info("⏹️ [QueueManager] 停止所有 Workers")
        self.is_running = False

        # Task 4: 停止積壓監控
        if self.backlog_monitor_task:
            self.backlog_monitor_task.cancel()
            try:
                await self.backlog_monitor_task
            except asyncio.CancelledError:
                pass

        # 取消所有 worker 任務
        for worker in self.workers:
            worker.cancel()

        # 等待所有任務完成
        await asyncio.gather(*self.workers, return_exceptions=True)
        self.workers.clear()

    async def enqueue_job(self, session_id: UUID, chunk_sequence: int, webm_data: bytes, priority: int = QUEUE_NORMAL_PRIORITY):
        """將轉錄任務加入隊列"""
        timestamp = time.time()
        job_data = {
            'session_id': session_id,
            'chunk_sequence': chunk_sequence,
            'webm_data': webm_data,
            'timestamp': timestamp,
            'retry_count': 0
        }

        try:
            # 使用 put_nowait 避免阻塞，如果隊列滿了會拋出異常
            self.queue.put_nowait((priority, timestamp, job_data))

            # Task 5: 更新隊列大小指標
            queue_size = self.queue.qsize()
            WHISPER_BACKLOG_GAUGE.set(queue_size)

            priority_name = "HIGH" if priority == QUEUE_HIGH_PRIORITY else "NORMAL"
            logger.info(f"📥 [QueueManager] 任務已入隊：session={session_id}, chunk={chunk_sequence}, priority={priority_name}, queue_size={queue_size}")

        except asyncio.QueueFull:
            logger.error(f"❌ [QueueManager] 隊列已滿 ({MAX_QUEUE_SIZE})，丟棄任務：session={session_id}, chunk={chunk_sequence}")
            # 可以考慮廣播隊列滿的錯誤到前端
            await self._broadcast_queue_full_error(session_id, chunk_sequence)
            raise Exception(f"Transcription queue is full ({MAX_QUEUE_SIZE}), please try again later")

    async def _worker(self, worker_name: str):
        """Worker 協程 - 處理隊列中的任務"""
        logger.info(f"👷 [QueueManager] {worker_name} 開始工作")

        while self.is_running:
            try:
                # 等待任務
                try:
                    priority, timestamp, job_data = await asyncio.wait_for(
                        self.queue.get(),
                        timeout=1.0  # 1秒超時，讓 worker 能定期檢查運行狀態
                    )
                except asyncio.TimeoutError:
                    continue  # 超時後繼續檢查運行狀態

                # 檢查任務是否過期
                age = time.time() - timestamp
                if age > QUEUE_TIMEOUT_SECONDS:
                    logger.warning(f"⏰ [QueueManager] {worker_name} 丟棄過期任務：age={age:.1f}s, session={job_data['session_id']}, chunk={job_data['chunk_sequence']}")
                    self.queue.task_done()
                    continue

                # Task 5: 記錄隊列等待時間
                wait_time = time.time() - timestamp
                QUEUE_WAIT_SECONDS.observe(wait_time)

                # 獲取併發控制權
                async with self.semaphore:
                    session_id = job_data['session_id']
                    chunk_sequence = job_data['chunk_sequence']

                    logger.info(f"🔧 [QueueManager] {worker_name} 處理任務：session={session_id}, chunk={chunk_sequence}, age={age:.1f}s, wait={wait_time:.1f}s")

                    try:
                        # 執行轉錄
                        success = await self._process_transcription_job(job_data)

                        if success:
                            self.total_processed += 1
                            # Task 5: 記錄成功處理的任務
                            QUEUE_PROCESSED_TOTAL.labels(status="success").inc()
                            logger.info(f"✅ [QueueManager] {worker_name} 任務完成：session={session_id}, chunk={chunk_sequence}")
                        else:
                            # 處理失敗，決定是否重試
                            # Task 5: 記錄失敗處理的任務
                            QUEUE_PROCESSED_TOTAL.labels(status="failed").inc()
                            await self._handle_job_failure(job_data, worker_name)

                    except Exception as e:
                        logger.error(f"💥 [QueueManager] {worker_name} 任務異常：session={session_id}, chunk={chunk_sequence}, error={e}")
                        # Task 5: 記錄異常處理的任務
                        QUEUE_PROCESSED_TOTAL.labels(status="exception").inc()
                        await self._handle_job_failure(job_data, worker_name)

                # 標記任務完成
                self.queue.task_done()

            except Exception as e:
                logger.error(f"💥 [QueueManager] {worker_name} Worker 異常：{e}")
                await asyncio.sleep(1)  # 短暫休息後繼續

        logger.info(f"👷 [QueueManager] {worker_name} 停止工作")

    async def _process_transcription_job(self, job_data: dict) -> bool:
        """處理單個轉錄任務"""
        session_id = job_data['session_id']
        chunk_sequence = job_data['chunk_sequence']
        webm_data = job_data['webm_data']

        try:
            # 獲取轉錄服務
            service = await initialize_transcription_service_v2()
            if not service:
                logger.error(f"❌ [QueueManager] 轉錄服務不可用：session={session_id}, chunk={chunk_sequence}")
                return False

            # 執行轉錄
            result = await service._transcribe_audio(webm_data, session_id, chunk_sequence)
            if result:
                # 儲存並廣播結果
                await service._save_and_push_result(session_id, chunk_sequence, result)
                return True
            else:
                logger.warning(f"⚠️ [QueueManager] 轉錄無結果：session={session_id}, chunk={chunk_sequence}")
                return False

        except RateLimitError as e:
            logger.warning(f"🚦 [QueueManager] 頻率限制：session={session_id}, chunk={chunk_sequence}, error={e}")
            # 429 錯誤不算失敗，會被重新排隊
            raise e
        except Exception as e:
            logger.error(f"❌ [QueueManager] 轉錄失敗：session={session_id}, chunk={chunk_sequence}, error={e}")
            return False

    async def _handle_job_failure(self, job_data: dict, worker_name: str):
        """處理任務失敗"""
        session_id = job_data['session_id']
        chunk_sequence = job_data['chunk_sequence']
        retry_count = job_data.get('retry_count', 0)

        if retry_count < 3:  # 最多重試 3 次
            job_data['retry_count'] = retry_count + 1
            self.total_retries += 1

            # 重新排隊（高優先級）
            await self.enqueue_job(
                session_id,
                chunk_sequence,
                job_data['webm_data'],
                priority=QUEUE_HIGH_PRIORITY
            )

            logger.info(f"🔄 [QueueManager] {worker_name} 重新排隊：session={session_id}, chunk={chunk_sequence}, retry={retry_count + 1}")
        else:
            self.total_failed += 1
            logger.error(f"❌ [QueueManager] {worker_name} 任務最終失敗：session={session_id}, chunk={chunk_sequence}, max_retries_exceeded")

            # 廣播最終失敗通知
            await self._broadcast_final_failure(session_id, chunk_sequence)

    async def _broadcast_queue_full_error(self, session_id: UUID, chunk_sequence: int):
        """廣播隊列滿錯誤"""
        try:
            error_data = {
                "type": "transcription_error",
                "error_type": "queue_full",
                "message": f"轉錄隊列已滿 ({MAX_QUEUE_SIZE})，請稍後重試",
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "timestamp": datetime.utcnow().isoformat()
            }
            await transcript_manager.broadcast(
                json.dumps(error_data),
                str(session_id)
            )
        except Exception as e:
            logger.error(f"Failed to broadcast queue full error: {e}")

    async def _broadcast_final_failure(self, session_id: UUID, chunk_sequence: int):
        """廣播最終失敗通知"""
        try:
            error_data = {
                "type": "transcription_error",
                "error_type": "final_failure",
                "message": f"段落 {chunk_sequence} 轉錄最終失敗，已達最大重試次數",
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "timestamp": datetime.utcnow().isoformat()
            }
            await transcript_manager.broadcast(
                json.dumps(error_data),
                str(session_id)
            )
        except Exception as e:
            logger.error(f"Failed to broadcast final failure: {e}")

    # Task 4: 積壓監控器
    async def _backlog_monitor(self):
        """積壓監控協程 - 定期檢查隊列積壓並通知前端"""
        logger.info("📊 [BacklogMonitor] 積壓監控開始")

        while self.is_running:
            try:
                queue_size = self.queue.qsize()
                current_time = time.time()

                # 檢查是否超過積壓閾值
                if queue_size > self.backlog_threshold:
                    # 檢查冷卻時間，避免頻繁通知
                    if current_time - self.last_backlog_alert > self.backlog_alert_cooldown:
                        await self._broadcast_backlog_alert(queue_size)
                        self.last_backlog_alert = current_time
                        logger.warning(f"⚠️ [BacklogMonitor] 隊列積壓警報：queue_size={queue_size}, threshold={self.backlog_threshold}")

                # 記錄隊列狀態（調試用）
                if queue_size > 0:
                    logger.debug(f"📊 [BacklogMonitor] 隊列狀態：size={queue_size}, processed={self.total_processed}, failed={self.total_failed}")

                # 等待下次檢查
                await asyncio.sleep(self.monitor_interval)

            except Exception as e:
                logger.error(f"💥 [BacklogMonitor] 監控異常：{e}")
                await asyncio.sleep(self.monitor_interval)

        logger.info("📊 [BacklogMonitor] 積壓監控停止")

    async def _broadcast_backlog_alert(self, queue_size: int):
        """廣播積壓警報到所有活躍會話"""
        try:
            # 計算預估等待時間
            estimated_wait_minutes = (queue_size * 12) // 60  # 假設每個任務平均 12 秒

            alert_data = {
                "event": "stt_backlog",
                "type": "backlog_alert",
                "queue_size": queue_size,
                "threshold": self.backlog_threshold,
                "estimated_wait_minutes": estimated_wait_minutes,
                "message": f"轉錄隊列積壓：{queue_size} 個任務等待處理，預估延遲 {estimated_wait_minutes} 分鐘",
                "timestamp": datetime.utcnow().isoformat(),
                "level": "warning" if queue_size < self.backlog_threshold * 2 else "critical"
            }

            # 廣播到所有活躍連接
            active_connections = getattr(transcript_manager, 'active_connections', {})
            if active_connections:
                broadcast_message = json.dumps(alert_data)

                # 廣播到所有會話
                for session_id in list(active_connections.keys()):
                    try:
                        await transcript_manager.broadcast(broadcast_message, session_id)
                    except Exception as e:
                        logger.warning(f"Failed to broadcast backlog alert to session {session_id}: {e}")

                logger.info(f"📢 [BacklogMonitor] 積壓警報已廣播到 {len(active_connections)} 個會話")
            else:
                logger.debug("📢 [BacklogMonitor] 無活躍會話，跳過積壓警報廣播")

        except Exception as e:
            logger.error(f"Failed to broadcast backlog alert: {e}")

    async def _broadcast_queue_recovery(self, queue_size: int):
        """廣播隊列恢復正常通知"""
        try:
            recovery_data = {
                "event": "stt_recovery",
                "type": "queue_recovery",
                "queue_size": queue_size,
                "message": f"轉錄隊列已恢復正常：當前 {queue_size} 個任務",
                "timestamp": datetime.utcnow().isoformat(),
                "level": "info"
            }

            # 廣播到所有活躍連接
            active_connections = getattr(transcript_manager, 'active_connections', {})
            if active_connections:
                broadcast_message = json.dumps(recovery_data)

                for session_id in list(active_connections.keys()):
                    try:
                        await transcript_manager.broadcast(broadcast_message, session_id)
                    except Exception as e:
                        logger.warning(f"Failed to broadcast recovery to session {session_id}: {e}")

                logger.info(f"📢 [BacklogMonitor] 恢復通知已廣播到 {len(active_connections)} 個會話")

        except Exception as e:
            logger.error(f"Failed to broadcast queue recovery: {e}")

    def get_stats(self) -> dict:
        """獲取隊列統計信息"""
        queue_size = self.queue.qsize()
        return {
            'queue_size': queue_size,
            'max_queue_size': MAX_QUEUE_SIZE,
            'total_processed': self.total_processed,
            'total_failed': self.total_failed,
            'total_retries': self.total_retries,
            'workers_count': len(self.workers),
            'is_running': self.is_running,
            # Task 4: 積壓監控統計
            'backlog_threshold': self.backlog_threshold,
            'is_backlogged': queue_size > self.backlog_threshold,
            'monitor_interval': self.monitor_interval,
            'last_backlog_alert': self.last_backlog_alert,
            'estimated_wait_seconds': queue_size * 12 if queue_size > 0 else 0
        }

# 配置常數
CHUNK_DURATION = settings.AUDIO_CHUNK_DURATION_SEC  # 從配置讀取切片時長
PROCESSING_TIMEOUT = 30  # 處理超時（秒）
MAX_RETRIES = 3  # 最大重試次數

# 全域集合追蹤已廣播 active 相位的 session
_active_phase_sent: Set[str] = set()

# 全域頻率限制處理器
rate_limit = RateLimitHandler()

# Task 3: 全域隊列管理器
queue_manager = TranscriptionQueueManager()

class SimpleAudioTranscriptionService:
    """簡化的音訊轉錄服務"""

    def __init__(self, azure_client: AsyncAzureOpenAI, deployment_name: str):
        self.client = azure_client
        self.deployment_name = deployment_name
        self.processing_tasks: Dict[str, asyncio.Task] = {}

    # def _get_header_repairer(self) -> WebMHeaderRepairer:
    #     """延遲初始化 WebM 檔頭修復器 - 已停用，不再需要檔頭修復"""
    #     if self._header_repairer is None:
    #         self._header_repairer = WebMHeaderRepairer()
    #     return self._header_repairer

    # def _extract_and_cache_header(self, session_id: str, chunk_0_data: bytes) -> bool:
    #     """檔頭提取和緩存 - 已停用，每個 chunk 都有完整檔頭"""
    #     # 不再需要，每個 chunk 都包含完整 WebM Header
    #     return True

    # def _get_cached_header(self, session_id: str) -> Optional[bytes]:
    #     """獲取緩存檔頭 - 已停用，不再需要檔頭緩存"""
    #     # 不再需要，每個 chunk 都包含完整 WebM Header
    #     return None

    # def _clear_session_cache(self, session_id: str) -> None:
    #     """清理會話緩存 - 已停用"""
    #     # 不再需要緩存
    #     pass

    # def _cleanup_expired_cache(self) -> None:
    #     """清理過期緩存 - 已停用"""
    #     # 不再需要緩存管理
    #     pass

    async def process_audio_chunk(self, session_id: UUID, chunk_sequence: int, webm_data: bytes) -> bool:
        """
        處理單一音訊切片 - Task 3: 使用隊列系統

        Args:
            session_id: 會話 ID
            chunk_sequence: 切片序號
            webm_data: WebM 音訊數據

        Returns:
            bool: 處理是否成功（入隊成功即視為成功）
        """
        try:
            logger.info(f"🚀 [TranscriptionService] 提交轉錄任務：session={session_id}, chunk={chunk_sequence}, size={len(webm_data)} bytes")

            # Task 3: 將任務提交到隊列而非直接處理
            await queue_manager.enqueue_job(session_id, chunk_sequence, webm_data)

            # 返回 True 表示成功提交到隊列
            return True

        except Exception as e:
            logger.error(f"❌ [TranscriptionService] 提交任務失敗：session={session_id}, chunk={chunk_sequence}, error={e}")
            return False

    async def _process_chunk_async(self, session_id: UUID, chunk_sequence: int, webm_data: bytes):
        """非同步處理音訊切片 (WebM 直接轉錄架構 v2 + 檔頭修復)"""
        try:
            with PerformanceTimer(f"Process chunk {chunk_sequence} for session {session_id}"):
                session_id_str = str(session_id)
                logger.info(f"🚀 [WebM 直接轉錄] 開始處理音訊切片 {chunk_sequence} (session: {session_id}, size: {len(webm_data)} bytes)")

                # 步驟 1: 驗證和修復 WebM 數據（整合檔頭修復邏輯）
                processed_webm_data = await self._validate_and_repair_webm_data(session_id, chunk_sequence, webm_data)
                if processed_webm_data is None:
                    logger.error(f"❌ [驗證失敗] Chunk {chunk_sequence} 驗證失敗，跳過處理")
                    return

                # 步驟 3: WebM 直接轉錄 (使用修復後的數據)
                logger.info(f"⚡ [架構優化] 跳過 FFmpeg 轉換，直接轉錄 WebM (chunk {chunk_sequence})")
                transcript_result = await self._transcribe_audio(processed_webm_data, session_id, chunk_sequence)
                if not transcript_result:
                    logger.error(f"Failed to transcribe WebM chunk {chunk_sequence}")
                    return

                # 步驟 4: 儲存並推送結果
                await self._save_and_push_result(session_id, chunk_sequence, transcript_result)

                logger.info(f"✅ 成功處理音訊切片 {chunk_sequence}: '{transcript_result.get('text', '')[:50]}...'")

        except Exception as e:
            logger.error(f"Error processing chunk {chunk_sequence} for session {session_id}: {e}", exc_info=True)

    async def _validate_and_repair_webm_data(self, session_id: UUID, chunk_sequence: int, webm_data: bytes) -> Optional[bytes]:
        """
        簡化的 WebM 數據驗證（優化後架構）

        由於 SegmentedAudioRecorder 每個 chunk 都包含完整 WebM Header，
        不再需要複雜的檔頭修復邏輯，只需基本驗證即可。

        Args:
            session_id: 會話 ID
            chunk_sequence: 切片序號
            webm_data: 原始 WebM 音訊數據

        Returns:
            Optional[bytes]: 驗證後的 WebM 數據，驗證失敗時返回 None
        """
        start_time = time.time()

        try:
            # 步驟 1: 基本數據驗證
            if not webm_data or len(webm_data) < 50:
                logger.warning(f"WebM chunk {chunk_sequence} too small: {len(webm_data) if webm_data else 0} bytes")
                return None

            # 步驟 2: 簡化驗證 - 每個 chunk 都應該有完整檔頭
            logger.debug(f"🎯 [簡化驗證] Chunk {chunk_sequence} 數據大小: {len(webm_data)} bytes (session: {session_id})")

            # 檢查是否為 WebM 格式（簡單檢查 EBML header）
            if webm_data[:4] == b'\x1A\x45\xDF\xA3':
                logger.debug(f"✅ [檔頭檢查] Chunk {chunk_sequence} 包含完整 WebM EBML header")
            else:
                logger.warning(f"⚠️ [檔頭檢查] Chunk {chunk_sequence} 可能不是標準 WebM 格式，但繼續處理")

            # 步驟 3: 效能統計
            total_time = (time.time() - start_time) * 1000  # ms
            logger.debug(f"📊 [簡化處理] Chunk {chunk_sequence} 驗證完成 - 總計: {total_time:.1f}ms")

            # 效能警告（應該很快）
            if total_time > 10:  # 超過10ms警告（簡化後應該更快）
                logger.warning(f"⚠️ [效能警告] Chunk {chunk_sequence} 簡化驗證時間過長: {total_time:.1f}ms")

            return webm_data  # 直接返回原始數據

        except Exception as e:
            logger.error(f"❌ [簡化驗證] Chunk {chunk_sequence} 處理異常: {e}")
            return webm_data  # 降級使用原始數據

    async def _convert_webm_to_wav(self, webm_data: bytes, chunk_sequence: int, session_id: UUID) -> Optional[bytes]:
        """
        將 WebM / fMP4 轉換為 WAV (保留用於最終下載檔案)

        注意：在 WebM 直接轉錄架構 v2 中，此方法不再用於即時轉錄流程，
        而是保留作為最終匯出時生成 WAV 檔案的備選方案。
        """

        async def _broadcast_error(error_type: str, error_message: str, details: str = None):
            """透過 WebSocket 廣播錯誤訊息到前端"""
            try:
                from app.ws.transcript_feed import manager as transcript_manager

                # 生成音檔診斷資訊
                hex_header = webm_data[:32].hex(' ', 8).upper() if webm_data else "無數據"
                audio_format = detect_audio_format(webm_data)

                # 根據檢測到的格式提供建議
                def get_format_suggestion(audio_format: str) -> str:
                    suggestions = {
                        'fmp4': '建議檢查瀏覽器錄音設定，或嘗試使用 WebM 格式',
                        'mp4': '建議確認音檔完整性，或嘗試使用 WebM 格式',
                        'webm': '建議檢查 WebM 編碼器設定',
                        'unknown': '建議檢查瀏覽器是否支援音訊錄製，或嘗試重新整理頁面'
                    }
                    return suggestions.get(audio_format, '建議檢查音檔格式是否支援')

                error_data = {
                    "type": "conversion_error",
                    "error_type": error_type,
                    "message": error_message,
                    "details": details,
                    "session_id": str(session_id),
                    "chunk_sequence": chunk_sequence,
                    "timestamp": datetime.utcnow().isoformat(),
                    "diagnostics": {
                        "detected_format": audio_format,
                        "file_size": len(webm_data) if webm_data else 0,
                        "header_hex": hex_header,
                        "suggestion": get_format_suggestion(audio_format)
                    }
                }
                await transcript_manager.broadcast(
                    json.dumps(error_data),
                    str(session_id)
                )
                logger.info(f"🚨 [錯誤廣播] 已通知前端轉換錯誤: {error_type}")
                logger.debug(f"   - 格式診斷: {audio_format}, 大小: {len(webm_data) if webm_data else 0} bytes")
                logger.debug(f"   - 頭部數據: {hex_header}")
            except Exception as e:
                logger.error(f"Failed to broadcast error message: {e}")

        try:
            audio_format = detect_audio_format(webm_data)
            logger.info(f"🎵 [格式檢測] 檢測到音檔格式: {audio_format} (chunk {chunk_sequence}, 大小: {len(webm_data)} bytes)")

            with PerformanceTimer(f"{audio_format.upper()} to WAV conversion for chunk {chunk_sequence}"):

                # 基本 FFmpeg 參數
                cmd = ['ffmpeg']

                # 依來源格式決定輸入參數
                if audio_format == 'mp4':
                    # Safari 產出的 fragmented MP4 - 讓 FFmpeg 自動檢測格式
                    # 不指定 -f 參數，能更好處理各種 MP4 變體
                    pass
                elif audio_format == 'webm':
                    cmd += ['-f', 'webm']
                elif audio_format == 'ogg':
                    cmd += ['-f', 'ogg']
                elif audio_format == 'wav':
                    cmd += ['-f', 'wav']

                # 通用旗標：生成時間戳處理不完整流
                cmd += ['-fflags', '+genpts', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', '-y', 'pipe:1']

                logger.debug(f"🔧 [FFmpeg] 執行命令: {' '.join(cmd)}")

                process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )

                stdout, stderr = await asyncio.wait_for(
                    process.communicate(input=webm_data),
                    timeout=PROCESSING_TIMEOUT
                )

                if process.returncode != 0:
                    error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "Unknown error"
                    logger.error(f"❌ [FFmpeg 錯誤] 轉換失敗 chunk {chunk_sequence}")
                    logger.error(f"   - 格式: {audio_format}")
                    logger.error(f"   - 返回碼: {process.returncode}")
                    logger.error(f"   - 錯誤訊息: {error_msg}")
                    logger.error(f"   - 輸入大小: {len(webm_data)} bytes")

                    # 增強錯誤分析，特別針對 fragmented MP4 錯誤
                    if "could not find corresponding trex" in error_msg.lower():
                        error_reason = "Fragmented MP4 格式錯誤：缺少 Track Extends (trex) 盒，需要使用特殊的 movflags 參數"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 檢測到 fragmented MP4 格式，建議重新整理頁面\n"
                            "2. 如果問題持續，請嘗試使用不同瀏覽器\n"
                            "3. Safari 用戶建議切換至 Chrome 或 Firefox"
                        )
                    elif "trun track id unknown" in error_msg.lower():
                        error_reason = "Fragmented MP4 追蹤 ID 錯誤：Track Run (trun) 盒中的軌道 ID 無法識別"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 這是 fragmented MP4 特有錯誤\n"
                            "2. 建議重新錄音或重啟瀏覽器\n"
                            "3. 考慮降低錄音品質設定"
                        )
                    elif "Invalid data found when processing input" in error_msg:
                        error_reason = f"音檔格式 {audio_format} 與 FFmpeg 不兼容，可能是編碼問題"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 檢查音檔是否完整下載\n"
                            "2. 確認瀏覽器錄音格式設定\n"
                            "3. 嘗試重新開始錄音"
                        )
                    elif "No such file or directory" in error_msg:
                        error_reason = "FFmpeg 程式未找到或配置錯誤"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 請聯繫技術支援\n"
                            "2. 這是伺服器配置問題"
                        )
                    elif "Permission denied" in error_msg:
                        error_reason = "FFmpeg 權限不足"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 請聯繫技術支援\n"
                            "2. 這是伺服器權限問題"
                        )
                    else:
                        error_reason = f"FFmpeg 處理 {audio_format} 格式時發生未知錯誤"
                        detailed_suggestion = (
                            "🔧 解決方案：\n"
                            "1. 嘗試重新錄音\n"
                            "2. 檢查網路連線是否穩定\n"
                            "3. 如果問題持續，請聯繫技術支援"
                        )

                    # 記錄詳細診斷資訊
                    logger.error(f"   - 診斷結果: {error_reason}")
                    logger.error(f"   - 建議方案: {detailed_suggestion}")

                    await _broadcast_error("ffmpeg_conversion_failed", error_reason, detailed_suggestion)
                    return None

                if not stdout or len(stdout) < 100:
                    error_msg = f"FFmpeg 產生的 WAV 數據不足: {len(stdout) if stdout else 0} bytes"
                    logger.error(f"❌ [FFmpeg 警告] {error_msg}")
                    await _broadcast_error("insufficient_output", "轉換後的音檔數據不足，可能是靜音或損壞", error_msg)
                    return None

                logger.info(f"✅ [FFmpeg 成功] {audio_format.upper()} ({len(webm_data)} bytes) → WAV ({len(stdout)} bytes)")
                return stdout

        except asyncio.TimeoutError:
            error_msg = f"FFmpeg 轉換超時 (>{PROCESSING_TIMEOUT}秒)"
            logger.error(f"⏰ [FFmpeg 超時] {error_msg}")
            await _broadcast_error("conversion_timeout", "音檔轉換處理時間過長", error_msg)
            return None
        except Exception as e:
            error_msg = f"FFmpeg 轉換異常: {str(e)}"
            logger.error(f"💥 [FFmpeg 異常] {error_msg}")
            await _broadcast_error("conversion_exception", "音檔轉換過程中發生異常錯誤", error_msg)
            return None

    async def _transcribe_audio(self, webm_data: bytes, session_id: UUID, chunk_sequence: int) -> Optional[Dict[str, Any]]:
        """使用 Azure OpenAI Whisper 直接轉錄 WebM 音訊 (架構優化 v2 + 智能頻率限制處理)"""

        # Task 2: 智能頻率限制處理 - 等待當前延遲
        await rate_limit.wait()

        # Task 5: 記錄併發處理數量
        CONCURRENT_JOBS_GAUGE.inc()

        try:
            # Task 5: 監控轉錄延遲
            with WHISPER_LATENCY_SECONDS.labels(deployment=self.deployment_name).time():
                with PerformanceTimer(f"Whisper WebM transcription for chunk {chunk_sequence}"):
                    # 建立 WebM 格式臨時檔案 (無需 FFmpeg 轉換)
                    with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                        temp_file.write(webm_data)
                        temp_file.flush()

                        try:
                            # Task 1: 使用異步客戶端直接呼叫 Whisper API
                            with open(temp_file.name, 'rb') as audio_file:
                                transcript = await self.client.audio.transcriptions.create(
                                    model=self.deployment_name,
                                    file=audio_file,
                                    language="zh",
                                    response_format="text"
                                )

                            # 清理臨時檔案
                            Path(temp_file.name).unlink(missing_ok=True)

                            if not transcript or not transcript.strip():
                                logger.debug(f"Empty transcript for chunk {chunk_sequence}")
                                # Task 5: 記錄空轉錄
                                WHISPER_REQ_TOTAL.labels(status="empty", deployment=self.deployment_name).inc()
                                return None

                            # Task 2: API 呼叫成功，重置頻率限制延遲
                            rate_limit.reset()

                            # Task 5: 記錄成功的轉錄請求
                            WHISPER_REQ_TOTAL.labels(status="success", deployment=self.deployment_name).inc()

                            logger.info(f"🎯 [WebM 直接轉錄] 成功處理 chunk {chunk_sequence} (格式: WebM → Whisper API)")

                            return {
                                'text': transcript.strip(),
                                'chunk_sequence': chunk_sequence,
                                'session_id': str(session_id),
                                'timestamp': datetime.utcnow().isoformat(),
                                'language': 'zh-TW',
                                'duration': CHUNK_DURATION
                            }

                        finally:
                            # 確保清理臨時檔案
                            Path(temp_file.name).unlink(missing_ok=True)

        except RateLimitError as e:
            # Task 2: 智能處理 429 錯誤
            logger.warning(f"🚦 [頻率限制] Chunk {chunk_sequence} 遇到 429 錯誤：{str(e)}")
            rate_limit.backoff()

            # Task 5: 記錄 429 錯誤
            WHISPER_REQ_TOTAL.labels(status="rate_limit", deployment=self.deployment_name).inc()

            # 廣播頻率限制錯誤到前端
            await self._broadcast_transcription_error(
                session_id,
                chunk_sequence,
                "rate_limit_error",
                f"API 頻率限制，將在 {rate_limit._delay}s 後重試"
            )
            return None

        except Exception as e:
            logger.error(f"WebM direct transcription failed for chunk {chunk_sequence}: {e}")

            # Task 5: 記錄失敗的轉錄請求
            WHISPER_REQ_TOTAL.labels(status="error", deployment=self.deployment_name).inc()

            # 廣播 Whisper API 錯誤到前端
            await self._broadcast_transcription_error(session_id, chunk_sequence, "whisper_api_error", f"Azure OpenAI Whisper WebM 轉錄失敗: {str(e)}")
            return None

        finally:
            # Task 5: 減少併發處理數量
            CONCURRENT_JOBS_GAUGE.dec()

    async def _save_and_push_result(self, session_id: UUID, chunk_sequence: int, transcript_result: Dict[str, Any]):
        """儲存轉錄結果並推送到前端"""
        try:
            # 儲存到資料庫
            supabase = get_supabase_client()

            segment_data = {
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "text": transcript_result['text'],
                "start_time": chunk_sequence * CHUNK_DURATION,
                "end_time": (chunk_sequence + 1) * CHUNK_DURATION,
                "confidence": 1.0,
                "language": transcript_result.get('language', 'zh-TW'),
                "created_at": transcript_result['timestamp']
            }

            response = supabase.table("transcript_segments").insert(segment_data).execute()

            if response.data:
                segment_id = response.data[0]['id']
                logger.debug(f"Saved transcript segment {segment_id} for chunk {chunk_sequence}")

                # 透過 WebSocket 廣播轉錄結果
                # 若尚未廣播 active 相位，先送出
                if str(session_id) not in _active_phase_sent:
                    logger.info(f"🚀 [轉錄推送] 首次廣播 active 相位到 session {session_id}")
                    await transcript_manager.broadcast(
                        json.dumps({"phase": "active"}),
                        str(session_id)
                    )
                    _active_phase_sent.add(str(session_id))
                    logger.info(f"✅ [轉錄推送] Active 相位廣播完成 for session {session_id}")

                # 構建逐字稿片段訊息
                transcript_message = {
                    "type": "transcript_segment",
                    "session_id": str(session_id),
                    "segment_id": segment_id,
                    "text": transcript_result['text'],
                    "chunk_sequence": chunk_sequence,
                    "start_sequence": chunk_sequence,  # 添加 start_sequence 欄位
                    "start_time": segment_data['start_time'],
                    "end_time": segment_data['end_time'],
                    "confidence": segment_data['confidence'],
                    "timestamp": segment_data['created_at']
                }

                logger.info(f"📡 [轉錄推送] 廣播逐字稿片段到 session {session_id}:")
                logger.info(f"   - 文字: '{transcript_result['text'][:50]}{'...' if len(transcript_result['text']) > 50 else ''}'")
                logger.info(f"   - 序號: {chunk_sequence}")
                logger.info(f"   - 時間: {segment_data['start_time']}s - {segment_data['end_time']}s")

                await transcript_manager.broadcast(
                    json.dumps(transcript_message),
                    str(session_id)
                )

                logger.info(f"✅ [轉錄推送] 逐字稿片段廣播完成 for session {session_id}")

                # 廣播轉錄完成消息
                logger.info(f"廣播轉錄完成訊息到 session {session_id}")
                await transcript_manager.broadcast(
                    json.dumps({
                        "type": "transcript_complete",
                        "session_id": str(session_id),
                        "message": "Transcription completed for the batch."
                    }),
                    str(session_id)
                )
                logger.info(f"轉錄任務完成 for session: {session_id}, chunk: {chunk_sequence}")

        except Exception as e:
            logger.error(f"Failed to save/push transcript for chunk {chunk_sequence}: {e}")
            # 廣播轉錄失敗錯誤到前端
            await self._broadcast_transcription_error(session_id, chunk_sequence, "database_error", f"資料庫操作失敗: {str(e)}")

    async def _broadcast_transcription_error(self, session_id: UUID, chunk_sequence: int, error_type: str, error_message: str):
        """廣播轉錄錯誤到前端"""
        try:
            from app.ws.transcript_feed import manager as transcript_manager
            error_data = {
                "type": "transcription_error",
                "error_type": error_type,
                "message": error_message,
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "timestamp": datetime.utcnow().isoformat()
            }
            await transcript_manager.broadcast(
                json.dumps(error_data),
                str(session_id)
            )
            logger.info(f"🚨 [轉錄錯誤廣播] 已通知前端轉錄錯誤: {error_type}")
        except Exception as e:
            logger.error(f"Failed to broadcast transcription error: {e}")

    # TODO: 在此處實現更優雅的關閉邏輯
    logger.info("Transcription service is shutting down...")

# ----------------------
# 兼容舊測試的工廠函式與全域變數
# ----------------------

_transcription_service_v2: Optional[SimpleAudioTranscriptionService] = None


def get_azure_openai_client() -> Optional[AsyncAzureOpenAI]:
    """Task 1: 建立異步 AzureOpenAI 用戶端，包含優化的 timeout 和重試配置"""
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    if not api_key or not endpoint:
        logger.warning("⚠️ [客戶端初始化] Azure OpenAI 環境變數缺失")
        return None

    # Task 1: 創建異步客戶端，包含 timeout 和減少重試次數
    client = AsyncAzureOpenAI(
        api_key=api_key,
        azure_endpoint=endpoint,
        api_version="2024-06-01",
        timeout=TIMEOUT,
        max_retries=2,  # 由 5 次降到 2 次，避免積壓
    )

    logger.info("✅ [客戶端初始化] AsyncAzureOpenAI 客戶端已創建")
    logger.info(f"   - Timeout: connect={TIMEOUT.connect}s, read={TIMEOUT.read}s")
    logger.info(f"   - Max retries: 2 (優化後)")

    return client


def get_whisper_deployment_name() -> Optional[str]:
    """取得 Whisper 部署名稱，環境變數缺值時回傳 None。"""
    return os.getenv("WHISPER_DEPLOYMENT_NAME")


async def initialize_transcription_service_v2() -> Optional[SimpleAudioTranscriptionService]:
    """初始化並快取 SimpleAudioTranscriptionService 實例。若設定不足則回傳 None。"""
    global _transcription_service_v2
    if _transcription_service_v2 is not None:
        return _transcription_service_v2

    client = get_azure_openai_client()
    deployment = get_whisper_deployment_name()
    if not client or not deployment:
        logger.warning("Azure OpenAI 設定不足，無法初始化轉錄服務 v2")
        return None

    _transcription_service_v2 = SimpleAudioTranscriptionService(client, deployment)
    logger.info("✅ Transcription service v2 initialized with async client")
    return _transcription_service_v2


def cleanup_transcription_service_v2():
    """清理全域轉錄服務實例。"""
    global _transcription_service_v2
    _transcription_service_v2 = None
