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

    # 滑動視窗專用指標
    SLIDING_WINDOW_PERMITS = prom.Gauge(
        "sliding_window_available_permits",
        "Available permits in sliding window rate limiter"
    )

    SLIDING_WINDOW_ACTIVE_REQUESTS = prom.Gauge(
        "sliding_window_active_requests",
        "Current active requests in sliding window"
    )

    SLIDING_WINDOW_QUEUE_TIME = prom.Summary(
        "sliding_window_queue_seconds",
        "Time spent waiting for sliding window permit"
    )

    API_QUOTA_UTILIZATION = prom.Gauge(
        "azure_api_quota_utilization_percent",
        "Azure API quota utilization percentage"
    )

    RATE_LIMITER_TYPE = prom.Gauge(
        "rate_limiter_type",
        "Type of rate limiter in use (0=traditional, 1=sliding_window)",
        ["limiter_type"]
    )

    # 段落過濾指標
    WHISPER_SEGMENTS_FILTERED = prom.Counter(
        "whisper_segments_filtered_total",
        "Total number of segments filtered by quality checks",
        ["reason", "deployment"]
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
    SLIDING_WINDOW_PERMITS = NoOpMetric()
    SLIDING_WINDOW_ACTIVE_REQUESTS = NoOpMetric()
    SLIDING_WINDOW_QUEUE_TIME = NoOpMetric()
    API_QUOTA_UTILIZATION = NoOpMetric()
    RATE_LIMITER_TYPE = NoOpMetric()
    WHISPER_SEGMENTS_FILTERED = NoOpMetric()

# 全域效能監控開關
ENABLE_PERFORMANCE_LOGGING = os.getenv("ENABLE_PERFORMANCE_LOGGING", "true").lower() == "true"

# Task 1: 優化的 timeout 配置
TIMEOUT = Timeout(connect=5, read=55, write=30, pool=5)

# Task 3: 併發控制與任務優先級配置（使用settings配置值）
# 改為從 settings 動態讀取，支援環境變數配置
QUEUE_HIGH_PRIORITY = 0  # 重試任務高優先級
QUEUE_NORMAL_PRIORITY = 1  # 正常任務

# Task 4: 音訊段落配置 - 移除硬編碼，使用配置值
# CHUNK_DURATION 現在在第 751 行從 settings.AUDIO_CHUNK_DURATION_SEC 讀取
PROCESSING_TIMEOUT = 60  # 處理超時時間（秒）

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

# 滑動視窗頻率限制處理器
class SlidingWindowRateLimiter:
    """滑動視窗頻率限制處理器 - 精確控制 API 配額使用"""

    def __init__(self, max_requests: int = 3, window_seconds: int = 60):
        """
        初始化滑動視窗頻率限制器

        Args:
            max_requests: 滑動視窗內最大請求數（預設 3）
            window_seconds: 滑動視窗時間長度（預設 60 秒）
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.semaphore = Semaphore(max_requests)
        self.active_requests = 0
        self.total_acquired = 0
        self.total_released = 0
        self._lock = asyncio.Lock()  # 保護統計數據的一致性

        logger.info(f"🪟 [SlidingWindow] 初始化完成：{max_requests} requests/{window_seconds}s")

    async def acquire(self) -> None:
        """
        取得 API 呼叫許可

        使用 semaphore 控制併發數，並通過 call_later 實現滑動視窗自動釋放
        """
        logger.debug(f"🎫 [SlidingWindow] 請求許可，當前活躍: {self.active_requests}/{self.max_requests}")

        # 記錄等待開始時間（用於 Prometheus 指標）
        wait_start_time = time.time()

        # 等待 semaphore 許可
        await self.semaphore.acquire()

        # 計算等待時間並更新 Prometheus 指標
        wait_duration = time.time() - wait_start_time
        SLIDING_WINDOW_QUEUE_TIME.observe(wait_duration)

        # 更新統計數據（使用鎖保護）
        async with self._lock:
            self.active_requests += 1
            self.total_acquired += 1

        # 更新 Prometheus 指標
        SLIDING_WINDOW_ACTIVE_REQUESTS.set(self.active_requests)
        SLIDING_WINDOW_PERMITS.set(self.max_requests - self.active_requests)

        # 更新配額利用率指標
        utilization = (self.active_requests / self.max_requests) * 100
        API_QUOTA_UTILIZATION.set(utilization)

        # 安排 window_seconds 後自動釋放許可
        try:
            loop = asyncio.get_event_loop()
            loop.call_later(self.window_seconds, self._release_permit)
            logger.debug(f"✅ [SlidingWindow] 許可已取得，活躍請求: {self.active_requests}, 將在 {self.window_seconds}s 後自動釋放")
        except Exception as e:
            # 如果 call_later 失敗，立即釋放許可避免死鎖
            logger.error(f"❌ [SlidingWindow] call_later 設定失敗: {e}")
            self.semaphore.release()
            async with self._lock:
                self.active_requests = max(0, self.active_requests - 1)
            # 回滾 Prometheus 指標
            SLIDING_WINDOW_ACTIVE_REQUESTS.set(self.active_requests)
            SLIDING_WINDOW_PERMITS.set(self.max_requests - self.active_requests)
            utilization = (self.active_requests / self.max_requests) * 100
            API_QUOTA_UTILIZATION.set(utilization)
            raise

    def _release_permit(self) -> None:
        """
        釋放許可（私有方法，由 call_later 調用）

        注意：此方法在事件循環的回調中執行，必須是同步的
        """
        try:
            self.semaphore.release()

            # 更新統計數據（注意：此處無法使用 async lock）
            # 使用原子操作確保一致性
            self.active_requests = max(0, self.active_requests - 1)
            self.total_released += 1

            # 更新 Prometheus 指標
            SLIDING_WINDOW_ACTIVE_REQUESTS.set(self.active_requests)
            SLIDING_WINDOW_PERMITS.set(self.max_requests - self.active_requests)

            # 更新配額利用率指標
            utilization = (self.active_requests / self.max_requests) * 100
            API_QUOTA_UTILIZATION.set(utilization)

            logger.debug(f"🎫 [SlidingWindow] 許可已自動釋放，活躍請求: {self.active_requests}")
        except Exception as e:
            logger.error(f"❌ [SlidingWindow] 釋放許可時發生錯誤: {e}")

    async def wait(self) -> None:
        """
        等待許可（相容於 RateLimitHandler 介面）

        此方法提供與現有 RateLimitHandler.wait() 相同的介面
        """
        await self.acquire()

    def get_stats(self) -> dict:
        """
        獲取滑動視窗統計資訊

        Returns:
            dict: 包含當前狀態的統計資訊
        """
        return {
            'type': 'sliding_window',
            'max_requests': self.max_requests,
            'window_seconds': self.window_seconds,
            'active_requests': self.active_requests,
            'available_permits': self.max_requests - self.active_requests,
            'total_acquired': self.total_acquired,
            'total_released': self.total_released,
            'utilization_percent': (self.active_requests / self.max_requests) * 100 if self.max_requests > 0 else 0,
            'is_at_capacity': self.active_requests >= self.max_requests
        }

    def reset(self) -> None:
        """
        重置統計數據（保持與 RateLimitHandler 介面一致）

        注意：此方法不會影響當前的 semaphore 狀態或活躍請求
        """
        logger.info(f"🔄 [SlidingWindow] 重置統計數據")
        self.total_acquired = 0
        self.total_released = 0

    def backoff(self) -> None:
        """
        退避處理（相容於 RateLimitHandler 介面）

        對於滑動視窗 Rate Limiter，退避實際上是由自動排隊機制處理，
        此方法主要用於記錄和統計目的
        """
        logger.warning(f"🚦 [SlidingWindow] 遇到 429 錯誤，滑動視窗將自動處理退避")

    @property
    def _delay(self) -> int:
        """
        模擬延遲屬性（相容於 RateLimitHandler 介面）

        對於滑動視窗，"延遲"概念是基於可用許可數量計算的預估等待時間
        """
        if self.active_requests >= self.max_requests:
            # 如果已達容量上限，估算需要等待的時間
            return max(1, self.window_seconds // 4)  # 估算等待時間
        return 0

    def __str__(self) -> str:
        """字串表示"""
        return f"SlidingWindowRateLimiter({self.max_requests}/{self.window_seconds}s, active={self.active_requests})"

    def __repr__(self) -> str:
        """詳細字串表示"""
        return f"SlidingWindowRateLimiter(max_requests={self.max_requests}, window_seconds={self.window_seconds}, active_requests={self.active_requests})"

# Task 3: 轉錄任務佇列管理器
class TranscriptionQueueManager:
    """優先級隊列管理器 - 確保順序處理並避免積壓"""

    def __init__(self):
        # 優先級隊列 (priority, timestamp, job_data)
        self.queue: PriorityQueue = PriorityQueue(maxsize=settings.MAX_QUEUE_SIZE)
        # 併發控制信號量（使用配置值）
        self.semaphore = Semaphore(settings.MAX_CONCURRENT_TRANSCRIPTIONS)
        # Worker 任務
        self.workers: list[asyncio.Task] = []
        # Task 4: 積壓監控任務
        self.backlog_monitor_task: Optional[asyncio.Task] = None
        # 統計數據
        self.total_processed = 0
        self.total_failed = 0
        self.total_retries = 0
        # Task 4: 積壓閾值和監控間隔（使用配置值）
        self.backlog_threshold = settings.QUEUE_BACKLOG_THRESHOLD
        self.monitor_interval = settings.QUEUE_MONITOR_INTERVAL
        self.last_backlog_alert = 0  # 上次積壓警報時間
        self.backlog_alert_cooldown = settings.QUEUE_ALERT_COOLDOWN
        # 運行狀態
        self.is_running = False

        logger.info(f"🎯 [QueueManager] 初始化完成：max_concurrent={settings.MAX_CONCURRENT_TRANSCRIPTIONS}, max_queue={settings.MAX_QUEUE_SIZE}")

    async def start_workers(self, num_workers: int = None):
        """啟動 Worker 任務"""
        if self.is_running:
            logger.warning("⚠️ [QueueManager] Workers already running")
            return

        # 使用配置值作為默認值
        if num_workers is None:
            num_workers = settings.TRANSCRIPTION_WORKERS_COUNT

        self.is_running = True
        logger.info(f"🚀 [QueueManager] 啟動 {num_workers} 個 Workers（配置值：{settings.TRANSCRIPTION_WORKERS_COUNT}）")

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
            logger.error(f"❌ [QueueManager] 隊列已滿 ({settings.MAX_QUEUE_SIZE})，丟棄任務：session={session_id}, chunk={chunk_sequence}")
            # 可以考慮廣播隊列滿的錯誤到前端
            await self._broadcast_queue_full_error(session_id, chunk_sequence)
            raise Exception(f"Transcription queue is full ({settings.MAX_QUEUE_SIZE}), please try again later")

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
                if age > settings.QUEUE_TIMEOUT_SECONDS:
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
                        result = await self._process_transcription_job(job_data)

                        if result is True:
                            self.total_processed += 1
                            # Task 5: 記錄成功處理的任務
                            QUEUE_PROCESSED_TOTAL.labels(status="success").inc()
                            logger.info(f"✅ [QueueManager] {worker_name} 任務完成：session={session_id}, chunk={chunk_sequence}")
                        elif result == "filtered":
                            self.total_processed += 1
                            # Task 5: 記錄被過濾的任務
                            QUEUE_PROCESSED_TOTAL.labels(status="filtered").inc()
                            logger.info(f"🔇 [QueueManager] {worker_name} 任務被過濾（靜音），跳過重試：session={session_id}, chunk={chunk_sequence}")
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
                # 檢查是否為被過濾的結果
                if isinstance(result, dict) and result.get("filtered"):
                    logger.info(f"🔇 [QueueManager] Chunk {chunk_sequence} 被靜音過濾，跳過重試：session={session_id}")
                    return "filtered"  # 返回特殊標記，表示不需要重試
                else:
                    # 儲存並廣播正常結果
                    await service._save_and_push_result(session_id, chunk_sequence, result)
                    return True
            else:
                logger.warning(f"⚠️ [QueueManager] 轉錄無結果：session={session_id}, chunk={chunk_sequence}")
                return False

        except RateLimitError as e:
            logger.warning(f"🚦 [頻率限制] Chunk {chunk_sequence} 遇到 429 錯誤：{str(e)}")
            # 注意：這裡不調用 rate_limit.backoff()，因為它是在轉錄服務中處理的
            return False
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
                "message": f"轉錄隊列已滿 ({settings.MAX_QUEUE_SIZE})，請稍後重試",
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
            'max_queue_size': settings.MAX_QUEUE_SIZE,
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

# Rate Limiter 工廠函數
def get_rate_limiter():
    """
    Rate Limiter 工廠函數 - 根據配置選擇適當的頻率限制策略

    Returns:
        RateLimitHandler 或 SlidingWindowRateLimiter 實例
    """
    if settings.USE_SLIDING_WINDOW_RATE_LIMIT:
        logger.info(f"🪟 [配置] 使用滑動視窗頻率限制：{settings.SLIDING_WINDOW_MAX_REQUESTS} requests/{settings.SLIDING_WINDOW_SECONDS}s")

        # 更新 Rate Limiter 類型指標
        RATE_LIMITER_TYPE.labels(limiter_type="sliding_window").set(1)
        RATE_LIMITER_TYPE.labels(limiter_type="traditional").set(0)

        return SlidingWindowRateLimiter(
            max_requests=settings.SLIDING_WINDOW_MAX_REQUESTS,
            window_seconds=settings.SLIDING_WINDOW_SECONDS
        )
    else:
        logger.info("🚦 [配置] 使用傳統指數退避頻率限制")

        # 更新 Rate Limiter 類型指標
        RATE_LIMITER_TYPE.labels(limiter_type="traditional").set(1)
        RATE_LIMITER_TYPE.labels(limiter_type="sliding_window").set(0)

        return RateLimitHandler()

# 全域頻率限制處理器（動態選擇）
rate_limit = get_rate_limiter()

# Task 3: 全域隊列管理器
queue_manager = TranscriptionQueueManager()

class SimpleAudioTranscriptionService:
    """簡化的音訊轉錄服務"""

    def __init__(self, azure_client: AsyncAzureOpenAI, deployment_name: str):
        self.client = azure_client
        self.deployment_name = deployment_name
        self.processing_tasks: Dict[str, asyncio.Task] = {}

    def _keep(self, segment: dict) -> bool:
        """
        根據 Whisper verbose_json 回應判斷是否保留轉錄段落

        使用 no_speech_prob、avg_logprob、compression_ratio 等指標過濾幻覺內容

        Args:
            segment: Whisper verbose_json 格式的段落資料

        Returns:
            bool: True 表示保留段落，False 表示過濾掉
        """
        try:
            # 檢查必要欄位是否存在
            required_fields = ['no_speech_prob', 'avg_logprob', 'compression_ratio']
            for field in required_fields:
                if field not in segment:
                    logger.warning(f"🔍 [段落過濾] 段落缺少必要欄位 '{field}'，過濾掉")
                    WHISPER_SEGMENTS_FILTERED.labels(
                        reason="missing_field",
                        deployment=self.deployment_name
                    ).inc()
                    return False

            # 提取過濾指標
            no_speech_prob = segment['no_speech_prob']
            avg_logprob = segment['avg_logprob']
            compression_ratio = segment['compression_ratio']

            # 過濾條件 1: 靜音檢測 - no_speech_prob 過高
            if no_speech_prob >= settings.FILTER_NO_SPEECH:
                logger.debug(f"🔇 [段落過濾] 靜音機率過高: {no_speech_prob:.3f} >= {settings.FILTER_NO_SPEECH}")
                WHISPER_SEGMENTS_FILTERED.labels(
                    reason="no_speech",
                    deployment=self.deployment_name
                ).inc()
                return False

            # 過濾條件 2: 置信度檢測 - avg_logprob 過低
            if avg_logprob < settings.FILTER_LOGPROB:
                logger.debug(f"📉 [段落過濾] 置信度過低: {avg_logprob:.3f} < {settings.FILTER_LOGPROB}")
                WHISPER_SEGMENTS_FILTERED.labels(
                    reason="low_confidence",
                    deployment=self.deployment_name
                ).inc()
                return False

            # 過濾條件 3: 重複內容檢測 - compression_ratio 過高
            if compression_ratio > settings.FILTER_COMPRESSION:
                logger.debug(f"🔄 [段落過濾] 重複比率過高: {compression_ratio:.3f} > {settings.FILTER_COMPRESSION}")
                WHISPER_SEGMENTS_FILTERED.labels(
                    reason="high_compression",
                    deployment=self.deployment_name
                ).inc()
                return False

            # 所有檢查通過，保留段落
            logger.debug(f"✅ [段落過濾] 段落品質良好，保留")
            logger.debug(f"   - 靜音機率: {no_speech_prob:.3f} < {settings.FILTER_NO_SPEECH}")
            logger.debug(f"   - 置信度: {avg_logprob:.3f} >= {settings.FILTER_LOGPROB}")
            logger.debug(f"   - 重複比率: {compression_ratio:.3f} <= {settings.FILTER_COMPRESSION}")
            return True

        except Exception as e:
            logger.error(f"❌ [段落過濾] 過濾邏輯異常: {e}")
            # 異常情況下預設過濾掉，避免產出錯誤內容
            WHISPER_SEGMENTS_FILTERED.labels(
                reason="filter_error",
                deployment=self.deployment_name
            ).inc()
            return False

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
                logger.info(f"�� [WebM 直接轉錄] 開始處理音訊切片 {chunk_sequence} (session: {session_id}, size: {len(webm_data)} bytes)")

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
        """使用 Azure OpenAI Whisper 直接轉錄 WebM 音訊 (verbose_json + 段落過濾)"""
        # 若此 session 指定非 Whisper Provider，改由對應 Provider 處理
        from app.services.stt.factory import get_provider
        alt_provider = get_provider(session_id)
        if alt_provider and alt_provider.name() != "whisper":
            return await alt_provider.transcribe(webm_data, session_id, chunk_sequence)

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
                            # Task 4: 使用 verbose_json 格式以獲取詳細段落資訊
                            with open(temp_file.name, 'rb') as audio_file:
                                transcript = await self.client.audio.transcriptions.create(
                                    model=self.deployment_name,
                                    file=audio_file,
                                    language=settings.WHISPER_LANGUAGE,
                                    response_format="verbose_json"
                                )

                            # 清理臨時檔案
                            Path(temp_file.name).unlink(missing_ok=True)

                            # Task 4: 處理 verbose_json 回應和段落過濾
                            if not transcript or not hasattr(transcript, 'segments') or not transcript.segments:
                                logger.debug(f"💭 [段落過濾] Chunk {chunk_sequence} 無段落數據")
                                # Task 5: 記錄空轉錄
                                WHISPER_REQ_TOTAL.labels(status="empty", deployment=self.deployment_name).inc()
                                return None

                            # Task 4: 使用 _keep 函數過濾段落
                            filtered_segments = []
                            total_segments = len(transcript.segments)
                            logger.info(f"🔍 [段落過濾] Chunk {chunk_sequence} 開始過濾，總段落數: {total_segments}")

                            for i, segment in enumerate(transcript.segments):
                                # 將 segment 轉換為字典以供 _keep 函數處理
                                segment_dict = {
                                    'id': getattr(segment, 'id', i),
                                    'seek': getattr(segment, 'seek', 0),
                                    'start': getattr(segment, 'start', 0.0),
                                    'end': getattr(segment, 'end', 0.0),
                                    'text': getattr(segment, 'text', ''),
                                    'tokens': getattr(segment, 'tokens', []),
                                    'temperature': getattr(segment, 'temperature', 0.0),
                                    'avg_logprob': getattr(segment, 'avg_logprob', 0.0),
                                    'compression_ratio': getattr(segment, 'compression_ratio', 0.0),
                                    'no_speech_prob': getattr(segment, 'no_speech_prob', 0.0)
                                }

                                if self._keep(segment_dict):
                                    filtered_segments.append(segment_dict)
                                    logger.debug(f"✅ [段落過濾] 段落 {i} 保留: '{segment_dict['text'][:30]}...'")
                                else:
                                    # 詳細記錄被過濾的原因
                                    logger.info(f"❌ [段落過濾] 段落 {i} 被過濾: '{segment_dict['text'][:50]}...'")
                                    logger.info(f"   - 靜音機率: {segment_dict.get('no_speech_prob', 'N/A'):.3f} (門檻: {settings.FILTER_NO_SPEECH})")
                                    logger.info(f"   - 置信度: {segment_dict.get('avg_logprob', 'N/A'):.3f} (門檻: {settings.FILTER_LOGPROB})")
                                    logger.info(f"   - 重複比率: {segment_dict.get('compression_ratio', 'N/A'):.3f} (門檻: {settings.FILTER_COMPRESSION})")

                            # Task 4: 檢查過濾結果
                            kept_count = len(filtered_segments)
                            filtered_count = total_segments - kept_count

                            logger.info(f"📊 [段落過濾統計] Chunk {chunk_sequence}: 總數={total_segments}, 保留={kept_count}, 過濾={filtered_count}")

                            if not filtered_segments:
                                logger.warning(f"⚠️ [段落過濾] Chunk {chunk_sequence} 所有段落都被過濾，返回空結果")
                                # 記錄為空轉錄（所有段落被過濾）
                                WHISPER_REQ_TOTAL.labels(status="empty", deployment=self.deployment_name).inc()
                                # 返回特殊標記，表示這是被過濾（不是失敗）
                                return {"filtered": True, "chunk_sequence": chunk_sequence}

                            # Task 4: 合併保留的段落文字
                            combined_text = ' '.join(segment['text'].strip() for segment in filtered_segments).strip()

                            # 新增：計算段落在切片中的實際起迄時間 (秒)
                            earliest_start = min(seg['start'] for seg in filtered_segments)
                            latest_end = max(seg['end'] for seg in filtered_segments)

                            if not combined_text:
                                logger.warning(f"⚠️ [段落過濾] Chunk {chunk_sequence} 合併後文字為空")
                                WHISPER_REQ_TOTAL.labels(status="empty", deployment=self.deployment_name).inc()
                                return None

                            # Task 2: API 呼叫成功，重置頻率限制延遲
                            rate_limit.reset()

                            # Task 5: 記錄成功的轉錄請求
                            WHISPER_REQ_TOTAL.labels(status="success", deployment=self.deployment_name).inc()

                            logger.info(f"🎯 [WebM 直接轉錄] 成功處理 chunk {chunk_sequence} (格式: WebM → Whisper API verbose_json)")
                            logger.info(f"📝 [過濾結果] 最終文字: '{combined_text[:100]}{'...' if len(combined_text) > 100 else ''}'")

                            return {
                                'text': combined_text,
                                'chunk_sequence': chunk_sequence,
                                'session_id': str(session_id),
                                'timestamp': datetime.utcnow().isoformat(),
                                'language': 'zh-TW',
                                'duration': getattr(transcript, 'duration', settings.AUDIO_CHUNK_DURATION_SEC),
                                'segments_total': total_segments,
                                'segments_kept': kept_count,
                                'segments_filtered': filtered_count,
                                # 新增：回傳在切片中的相對起迄時間，供後續計算絕對時間
                                'start_offset': earliest_start,
                                'end_offset': latest_end
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

            # 根據 Rate Limiter 類型構建適當的錯誤訊息
            if isinstance(rate_limit, SlidingWindowRateLimiter):
                # 滑動視窗模式：基於可用許可數量提供資訊
                stats = rate_limit.get_stats()
                if stats['is_at_capacity']:
                    error_msg = f"API 配額已滿（{stats['active_requests']}/{stats['max_requests']}），請等待約 {rate_limit._delay}s"
                else:
                    error_msg = f"API 頻率限制，滑動視窗排隊處理中（{stats['available_permits']} 個許可可用）"
            else:
                # 傳統指數退避模式
                error_msg = f"API 頻率限制，將在 {rate_limit._delay}s 後重試"

            # 廣播頻率限制錯誤到前端
            await self._broadcast_transcription_error(
                session_id,
                chunk_sequence,
                "rate_limit_error",
                error_msg
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

            # 獲取 session 的 started_at 時間戳（如果有的話）
            session_response = supabase.table("sessions").select("started_at").eq("id", str(session_id)).limit(1).execute()

            # 讀取 started_at（若無則為 None）
            started_at = None
            if session_response.data and session_response.data[0].get('started_at'):
                started_at = session_response.data[0]['started_at']

            # 計算段落相對時間（若有 started_at 可用於日後絕對時間換算）
            chunk_start_seconds = chunk_sequence * settings.AUDIO_CHUNK_DURATION_SEC
            start_time = chunk_start_seconds + transcript_result.get('start_offset', 0)
            end_time = chunk_start_seconds + transcript_result.get('end_offset', settings.AUDIO_CHUNK_DURATION_SEC)

            if started_at:
                logger.info(
                    f"🕐 [時間計算 v2] 精確開始時間: {started_at}, "
                    f"chunk={chunk_sequence}, chunk_start={chunk_start_seconds}s, "
                    f"offset=({transcript_result.get('start_offset', 0)}s-{transcript_result.get('end_offset', 0)}s) → "
                    f"absolute=({start_time}s-{end_time}s)"
                )
            else:
                logger.info(
                    f"🕐 [時間計算 v2] 未檢測到 started_at，使用 fallback 相對時間。" \
                    f"chunk={chunk_sequence}, chunk_start={chunk_start_seconds}s, " \
                    f"offset=({transcript_result.get('start_offset', 0)}s-{transcript_result.get('end_offset', 0)}s) → " \
                    f"relative=({start_time}s-{end_time}s)"
                )

            segment_data = {
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "text": transcript_result['text'],
                "start_time": start_time,
                "end_time": end_time,
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
