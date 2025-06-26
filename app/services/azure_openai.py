import os
import asyncio
import logging
import time
from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from io import BytesIO
from decimal import Decimal

from openai import AzureOpenAI
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.ffmpeg import feed_ffmpeg_async
from ..db.database import get_async_session
from ..db.models import TranscriptSegment, Transcript

load_dotenv()

logger = logging.getLogger(__name__)

# 優化後的批次處理設定 - 目標延遲 ≤3秒
BATCH_SIZE = int(os.getenv("WHISPER_BATCH_SIZE", "1"))  # 改為1個切片立即處理
BATCH_TIMEOUT = int(os.getenv("WHISPER_BATCH_TIMEOUT", "2"))  # 改為2秒超時

# 效能監控設定
ENABLE_PERFORMANCE_LOGGING = os.getenv("ENABLE_PERFORMANCE_LOGGING", "true").lower() == "true"

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

class AudioBatch:
    """音訊批次處理類別"""

    def __init__(self, session_id: UUID):
        self.session_id = session_id
        self.chunks: List[Dict[str, Any]] = []
        self.created_at = datetime.utcnow()
        self.is_processing = False

    def add_chunk(self, chunk_sequence: int, audio_data: bytes, duration: float = 0.0):
        """添加音訊切片到批次"""
        self.chunks.append({
            'sequence': chunk_sequence,
            'audio_data': audio_data,
            'duration': duration,
            'added_at': datetime.utcnow()
        })

    def is_ready_for_processing(self) -> bool:
        """檢查批次是否準備好處理"""
        if self.is_processing:
            return False

        # 達到批次大小或超時
        chunk_count = len(self.chunks)
        elapsed_time = (datetime.utcnow() - self.created_at).total_seconds()

        is_ready = chunk_count >= BATCH_SIZE or elapsed_time >= BATCH_TIMEOUT

        if is_ready and ENABLE_PERFORMANCE_LOGGING:
            reason = f"chunks={chunk_count}" if chunk_count >= BATCH_SIZE else f"timeout={elapsed_time:.1f}s"
            logger.info(f"🚀 Batch ready for processing: {reason}")

        return is_ready

    def get_total_duration(self) -> float:
        """獲取批次總時長"""
        return sum(chunk['duration'] for chunk in self.chunks)

    def get_batch_age(self) -> float:
        """獲取批次存在時間（秒）"""
        return (datetime.utcnow() - self.created_at).total_seconds()

class AudioTranscriptionService:
    """音訊轉錄服務"""

    def __init__(self):
        self.client = get_azure_openai_client()
        self.deployment_name = get_whisper_deployment_name()
        self.batches: Dict[UUID, AudioBatch] = {}
        self.session_headers: Dict[UUID, bytes] = {}

        # 併發控制：每個 session 一個處理鎖
        self.processing_locks: Dict[UUID, asyncio.Lock] = {}

        # 效能統計
        self.performance_stats = {
            'total_batches_processed': 0,
            'total_processing_time': 0.0,
            'average_processing_time': 0.0,
            'max_processing_time': 0.0,
            'min_processing_time': float('inf')
        }

    async def initialize(self) -> bool:
        """初始化服務"""
        if self.client is None:
            logger.warning("Azure OpenAI client not available - transcription disabled")
            return False

        if self.deployment_name is None:
            logger.warning("Whisper deployment name not configured - transcription disabled")
            return False

        logger.info(f"🎤 Audio transcription service initialized - batch_size={BATCH_SIZE}, timeout={BATCH_TIMEOUT}s")

        # 預載入活躍 session 的 header chunks
        await self._preload_active_session_headers()

        return True

    async def _preload_active_session_headers(self):
        """預載入所有活躍 session 的 header chunks"""
        try:
            from ..db.database import get_supabase_client

            supabase_client = get_supabase_client()

            # 查詢所有活躍的錄音 session
            response = supabase_client.table("sessions").select("id").eq("status", "active").eq("type", "recording").execute()

            active_sessions = response.data if response.data else []
            logger.info(f"Found {len(active_sessions)} active recording sessions")

            # 為每個活躍 session 預載入 header chunk
            loaded_count = 0
            for session_data in active_sessions:
                session_id = UUID(session_data['id'])

                # 檢查是否已經有 header
                if session_id not in self.session_headers:
                    header_data = await self._recover_header_chunk(session_id)
                    if header_data:
                        self.session_headers[session_id] = header_data
                        loaded_count += 1
                        logger.debug(f"Preloaded header for session {session_id}")

            logger.info(f"✅ Preloaded {loaded_count} header chunks for active sessions")

        except Exception as e:
            logger.warning(f"Failed to preload active session headers: {e}")
            # 預載入失敗不影響服務正常運行

    async def add_audio_chunk(self, session_id: UUID, chunk_sequence: int, audio_data: bytes):
        """添加音訊切片到批次處理佇列"""
        if not self.client or not self.deployment_name:
            logger.warning("Transcription service not available")
            return

        with PerformanceTimer(f"Add chunk {chunk_sequence} to batch"):
            # 如果是第一個切片，儲存為 header
            if chunk_sequence == 0:
                self.session_headers[session_id] = audio_data
                logger.info(f"Stored header chunk (seq 0) for session {session_id}, size={len(audio_data)} bytes.")

            # 確保 session 有處理鎖
            if session_id not in self.processing_locks:
                self.processing_locks[session_id] = asyncio.Lock()

            # 獲取或建立批次
            if session_id not in self.batches:
                self.batches[session_id] = AudioBatch(session_id)

            batch = self.batches[session_id]

            # 如果批次正在處理，建立新批次
            if batch.is_processing:
                new_batch = AudioBatch(session_id)
                self.batches[session_id] = new_batch
                batch = new_batch
                logger.debug(f"Created new batch for session {session_id} as previous batch is processing")

            # 添加切片到批次
            batch.add_chunk(chunk_sequence, audio_data)
            logger.debug(f"Added chunk {chunk_sequence} to batch for session {session_id}")

            # 檢查是否準備處理（使用鎖確保只有一個處理任務）
            if batch.is_ready_for_processing() and not batch.is_processing:
                # 立即標記為處理中，防止重複觸發
                batch.is_processing = True
                # 啟動背景處理任務
                asyncio.create_task(self._process_batch_safely(session_id, batch))
                logger.debug(f"Started background batch processing for session {session_id}")

    async def _process_batch_safely(self, session_id: UUID, batch: AudioBatch):
        """安全地處理音訊批次，使用鎖機制"""
        if session_id not in self.processing_locks:
            logger.error(f"No processing lock found for session {session_id}")
            batch.is_processing = False
            return

        async with self.processing_locks[session_id]:
            try:
                await self._process_batch(session_id, batch)
            except Exception as e:
                logger.error(f"Unexpected error in batch processing for session {session_id}: {e}", exc_info=True)
            finally:
                # 確保處理完成後重置狀態
                batch.is_processing = False

    async def _process_batch(self, session_id: UUID, target_batch: AudioBatch):
        """處理音訊批次"""
        batch_start_time = time.time()

        try:
            with PerformanceTimer(f"Process batch for session {session_id}"):
                logger.info(f"🔄 Processing batch for session {session_id} with {len(target_batch.chunks)} chunks (age: {target_batch.get_batch_age():.1f}s)")

                # 合併音訊切片
                with PerformanceTimer("Audio merging"):
                    merged_audio = await self._merge_audio_chunks(session_id, target_batch.chunks)
                    if not merged_audio:
                        logger.error(f"Failed to merge audio chunks for session {session_id}")
                        return

                # 發送到 Azure OpenAI Whisper
                with PerformanceTimer("Azure OpenAI Whisper API"):
                    transcript_result = await self._transcribe_audio(merged_audio, session_id)
                    if transcript_result:
                        # 儲存轉錄結果到資料庫並推送到 WebSocket
                        with PerformanceTimer("Save and push results"):
                            await self._save_and_push_transcript_result(session_id, transcript_result, target_batch.chunks)

                # 更新效能統計
                batch_duration = time.time() - batch_start_time
                self._update_performance_stats(batch_duration, session_id)

                # 檢查是否超過目標延遲
                if batch_duration > 5.0:
                    logger.warning(
                        f"⚠️ 批次處理超過目標延遲: {batch_duration:.2f}s > 5.0s "
                        f"(session: {session_id}, chunks: {len(target_batch.chunks)})"
                    )

        except Exception as e:
            logger.error(f"Error processing batch for session {session_id}: {e}", exc_info=True)
        finally:
            # 清理已處理的批次
            if session_id in self.batches and self.batches[session_id] == target_batch:
                # 創建新的空批次替換已處理的批次
                self.batches[session_id] = AudioBatch(session_id)
                logger.debug(f"Cleaned up processed batch for session {session_id}")

            logger.info(f"✅ Batch processing completed for session {session_id}")

    def _update_performance_stats(self, duration: float, session_id: UUID = None):
        """更新效能統計"""
        self.performance_stats['total_batches_processed'] += 1
        self.performance_stats['total_processing_time'] += duration
        self.performance_stats['average_processing_time'] = (
            self.performance_stats['total_processing_time'] /
            self.performance_stats['total_batches_processed']
        )
        self.performance_stats['max_processing_time'] = max(
            self.performance_stats['max_processing_time'],
            duration
        )
        self.performance_stats['min_processing_time'] = min(
            self.performance_stats['min_processing_time'],
            duration
        )

        # 分類記錄效能
        if duration <= 2.0:
            performance_level = "🟢 優秀"
        elif duration <= 5.0:
            performance_level = "🟡 正常"
        elif duration <= 10.0:
            performance_level = "🟠 緩慢"
        else:
            performance_level = "🔴 嚴重延遲"

        if ENABLE_PERFORMANCE_LOGGING:
            logger.info(f"📊 批次處理完成 ({performance_level}): "
                       f"duration={duration:.2f}s, "
                       f"avg={self.performance_stats['average_processing_time']:.2f}s, "
                       f"max={self.performance_stats['max_processing_time']:.2f}s, "
                       f"total_batches={self.performance_stats['total_batches_processed']}")

            # 每 10 個批次輸出一次詳細統計
            if self.performance_stats['total_batches_processed'] % 10 == 0:
                logger.info(f"📈 轉錄服務效能統計 (最近 10 批次): "
                           f"平均延遲={self.performance_stats['average_processing_time']:.2f}s, "
                           f"最大延遲={self.performance_stats['max_processing_time']:.2f}s, "
                           f"最小延遲={self.performance_stats['min_processing_time']:.2f}s")

    def get_performance_report(self) -> Dict[str, Any]:
        """獲取效能報告"""
        total_batches = self.performance_stats['total_batches_processed']
        avg_time = self.performance_stats['average_processing_time']

        # 計算效能等級
        if avg_time <= 2.0:
            performance_grade = "A+ (優秀)"
        elif avg_time <= 5.0:
            performance_grade = "A (良好)"
        elif avg_time <= 8.0:
            performance_grade = "B (普通)"
        elif avg_time <= 12.0:
            performance_grade = "C (需要改進)"
        else:
            performance_grade = "D (嚴重問題)"

        return {
            **self.performance_stats,
            'current_batch_count': len(self.batches),
            'batch_size_config': BATCH_SIZE,
            'batch_timeout_config': BATCH_TIMEOUT,
            'performance_logging_enabled': ENABLE_PERFORMANCE_LOGGING,
            'performance_grade': performance_grade,
            'target_latency': 5.0,
            'latency_compliance': avg_time <= 5.0 if total_batches > 0 else True,
            'recommendations': self._get_performance_recommendations()
        }

    def _get_performance_recommendations(self) -> List[str]:
        """根據目前效能提供改進建議"""
        recommendations = []
        avg_time = self.performance_stats['average_processing_time']
        max_time = self.performance_stats['max_processing_time']

        if avg_time > 5.0:
            recommendations.append("平均處理時間超過目標，建議檢查 Azure OpenAI API 配置")

        if max_time > 15.0:
            recommendations.append("最大處理時間過長，可能存在網路或 API 問題")

        if len(self.batches) > 5:
            recommendations.append("同時處理的批次過多，建議檢查系統負載")

        if BATCH_SIZE > 3:
            recommendations.append(f"批次大小 ({BATCH_SIZE}) 較大，考慮降低以改善延遲")

        if not recommendations:
            recommendations.append("效能表現良好，無需特別調整")

        return recommendations

    async def _merge_audio_chunks(self, session_id: UUID, chunks: List[Dict[str, Any]]) -> Optional[bytes]:
        """合併音訊切片為單一 PCM 音訊"""
        if not chunks:
            return None

        try:
            # 按序號排序切片
            sorted_chunks = sorted(chunks, key=lambda x: x['sequence'])
            sequences_in_batch = {c['sequence'] for c in sorted_chunks}

            # 驗證音訊切片數據
            valid_chunks = []
            total_audio_size = 0

            for chunk in sorted_chunks:
                audio_data = chunk['audio_data']
                if not audio_data or len(audio_data) < 10:  # 至少需要一些數據
                    logger.warning(f"Skipping empty or too small chunk {chunk['sequence']}: {len(audio_data) if audio_data else 0} bytes")
                    continue

                # 檢查是否為有效的 WebM 數據（檢查 EBML 標頭）
                if chunk['sequence'] == 0:  # Header chunk 必須有 EBML 標頭
                    if not audio_data.startswith(b'\x1a\x45\xdf\xa3'):
                        logger.warning(f"Header chunk {chunk['sequence']} missing EBML header")
                        continue

                valid_chunks.append(chunk)
                total_audio_size += len(audio_data)

            if not valid_chunks:
                logger.error(f"No valid audio chunks found for session {session_id}")
                return None

            logger.debug(f"Found {len(valid_chunks)} valid chunks out of {len(sorted_chunks)} total, total size: {total_audio_size} bytes")

            # 步驟 1: 建立一個二進制 blob，必要時前置 header
            merged_webm = BytesIO()

            # 如果批次中沒有 header (chunk 0)，則從存儲中前置 header
            if 0 not in sequences_in_batch:
                if session_id in self.session_headers:
                    header_data = self.session_headers[session_id]
                    if header_data and len(header_data) > 0:
                        merged_webm.write(header_data)
                        logger.debug(f"Prepended stored header for session {session_id} to batch.")
                    else:
                        logger.warning(f"Stored header for session {session_id} is empty")
                else:
                    # 嘗試從 R2 恢復 header chunk
                    header_chunk = await self._recover_header_chunk(session_id)
                    if header_chunk and len(header_chunk) > 0:
                        self.session_headers[session_id] = header_chunk
                        merged_webm.write(header_chunk)
                        logger.info(f"Recovered and prepended header chunk for session {session_id}")
                    else:
                        # 沒有 header，無法處理此批次
                        logger.error(f"Cannot process batch for session {session_id}: Header chunk (seq 0) not found in store.")
                        return None

            # 寫入當前批次的所有有效切片
            for chunk in valid_chunks:
                merged_webm.write(chunk['audio_data'])

            merged_webm_data = merged_webm.getvalue()
            merged_webm.close()

            if not merged_webm_data or len(merged_webm_data) < 50:  # 至少需要基本的 WebM 結構
                logger.warning(f"Merged audio data too small: {len(merged_webm_data) if merged_webm_data else 0} bytes")
                return None

            logger.debug(f"Merged {len(valid_chunks)} webm chunks into {len(merged_webm_data)} bytes.")

            # 步驟 2: 一次性將合併後的 WebM 轉換為 PCM
            with PerformanceTimer(f"FFmpeg conversion for {len(valid_chunks)} chunks"):
                try:
                    pcm_data = await feed_ffmpeg_async(merged_webm_data)
                    if not pcm_data or len(pcm_data) < 100:  # PCM 數據應該有一定大小
                        logger.error(f"FFmpeg conversion resulted in insufficient data: {len(pcm_data) if pcm_data else 0} bytes")
                        return None

                    logger.debug(f"Converted merged webm to {len(pcm_data)} bytes of PCM.")
                    return pcm_data

                except Exception as e:
                    # 在這裡捕獲並記錄詳細的 FFmpeg 轉換錯誤
                    logger.error(f"FFmpeg conversion failed for a batch of {len(valid_chunks)} chunks: {e}", exc_info=True)
                    # 嘗試保存問題音檔用於調試
                    try:
                        import tempfile
                        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
                            f.write(merged_webm_data)
                            logger.error(f"Problematic WebM saved to: {f.name}")
                    except:
                        pass
                    return None

        except Exception as e:
            logger.error(f"Error merging audio chunks: {e}", exc_info=True)
            return None

    async def _recover_header_chunk(self, session_id: UUID) -> Optional[bytes]:
        """從 R2 恢復 header chunk (序號 0)"""
        try:
            from ..services.r2_client import get_r2_client
            from ..services.r2_client import generate_audio_key

            r2_client = get_r2_client()
            header_key = generate_audio_key(str(session_id), 0)

            logger.info(f"Attempting to recover header chunk from R2: {header_key}")

            # 從 R2 下載 header chunk
            download_result = await r2_client.download_file(header_key)

            if download_result['success']:
                header_data = download_result['data']
                logger.info(f"Successfully recovered header chunk for session {session_id}, size: {len(header_data)} bytes")
                return header_data
            else:
                logger.warning(f"Failed to recover header chunk: {download_result.get('error')}")
                return None

        except Exception as e:
            logger.error(f"Failed to recover header chunk for session {session_id}: {e}")
            return None

    async def _transcribe_audio(self, audio_data: bytes, session_id: UUID) -> Optional[Dict[str, Any]]:
        """使用 Azure OpenAI Whisper 轉錄音訊"""
        try:
            # 建立臨時音訊檔案
            audio_file = BytesIO(audio_data)
            audio_file.name = f"audio_{session_id}.wav"

            # 呼叫 Azure OpenAI Whisper API
            response = await asyncio.to_thread(
                self.client.audio.transcriptions.create,
                model=self.deployment_name,
                file=audio_file,
                response_format="verbose_json",
                language="zh"  # 預設中文，可根據需要調整
            )

            # 處理回應
            if response and response.text:
                result = {
                    'text': response.text.strip(),
                    'language': getattr(response, 'language', 'zh'),
                    'duration': getattr(response, 'duration', 0.0),
                    'segments': getattr(response, 'segments', []),
                    'timestamp': datetime.utcnow().isoformat()
                }

                logger.info(f"Transcription successful for session {session_id}: {len(response.text)} characters")
                return result
            else:
                logger.warning(f"Empty transcription result for session {session_id}")
                return None

        except Exception as e:
            logger.error(f"Transcription failed for session {session_id}: {e}")
            return None
        finally:
            if 'audio_file' in locals():
                audio_file.close()

    async def _save_and_push_transcript_result(self, session_id: UUID, transcript_result: Dict[str, Any], chunks: List[Dict[str, Any]]):
        """儲存轉錄結果到資料庫並推送到 WebSocket"""
        try:
            # 計算時間範圍
            chunk_sequences = [chunk['sequence'] for chunk in chunks]
            start_sequence = min(chunk_sequences)
            end_sequence = max(chunk_sequences)

            # 儲存到資料庫
            segment_id = await self._save_transcript_segment(
                session_id=session_id,
                chunk_sequence=start_sequence,
                text=transcript_result['text'],
                start_time=0.0,  # 暫時使用相對時間，後續可優化
                end_time=transcript_result.get('duration', 5.0),
                confidence=1.0  # Azure OpenAI 不提供信心度
            )

            if segment_id:
                logger.info(f"Saved transcript segment {segment_id} for session {session_id}")

                # 更新完整逐字稿
                await self._update_full_transcript(session_id)

            # 準備推送資料
            push_data = {
                'type': 'transcript_segment',
                'session_id': str(session_id),
                'segment_id': str(segment_id) if segment_id else None,
                'text': transcript_result['text'],
                'start_sequence': start_sequence,
                'end_sequence': end_sequence,
                'start_time': 0.0,
                'end_time': transcript_result.get('duration', 5.0),
                'language': transcript_result.get('language', 'zh'),
                'confidence': 1.0,
                'timestamp': transcript_result['timestamp']
            }

            # 推送到 WebSocket
            from ..ws.transcript_feed import manager
            await manager.broadcast_to_session(session_id, push_data)

            logger.info(f"Pushed transcript result to session {session_id}: {transcript_result['text'][:50]}...")

        except Exception as e:
            logger.error(f"Failed to save and push transcript result for session {session_id}: {e}")

    async def _save_transcript_segment(self, session_id: UUID, chunk_sequence: int, text: str,
                                     start_time: float, end_time: float, confidence: float) -> Optional[UUID]:
        """儲存逐字稿片段到資料庫"""
        try:
            async for db in get_async_session():
                # 檢查是否已存在相同的片段
                existing_segment = await db.execute(
                    select(TranscriptSegment).where(
                        TranscriptSegment.session_id == session_id,
                        TranscriptSegment.chunk_sequence == chunk_sequence
                    )
                )
                existing = existing_segment.scalar_one_or_none()

                if existing:
                    # 更新現有片段
                    existing.text = text
                    existing.start_time = Decimal(str(start_time))
                    existing.end_time = Decimal(str(end_time))
                    existing.confidence = Decimal(str(confidence))
                    segment_id = existing.id
                    logger.debug(f"Updated existing transcript segment {segment_id}")
                else:
                    # 建立新片段
                    new_segment = TranscriptSegment(
                        session_id=session_id,
                        chunk_sequence=chunk_sequence,
                        start_time=Decimal(str(start_time)),
                        end_time=Decimal(str(end_time)),
                        text=text,
                        confidence=Decimal(str(confidence))
                    )
                    db.add(new_segment)
                    await db.flush()  # 獲取 ID
                    segment_id = new_segment.id
                    logger.debug(f"Created new transcript segment {segment_id}")

                await db.commit()
                return segment_id

        except Exception as e:
            logger.error(f"Failed to save transcript segment: {e}")
            return None

    async def _update_full_transcript(self, session_id: UUID):
        """更新完整逐字稿"""
        try:
            async for db in get_async_session():
                # 獲取所有片段，按序號排序
                segments_result = await db.execute(
                    select(TranscriptSegment)
                    .where(TranscriptSegment.session_id == session_id)
                    .order_by(TranscriptSegment.chunk_sequence)
                )
                segments = segments_result.scalars().all()

                if not segments:
                    return

                # 合併所有文字
                full_text = " ".join(segment.text for segment in segments)

                # 檢查是否已存在完整逐字稿
                existing_transcript = await db.execute(
                    select(Transcript).where(Transcript.session_id == session_id)
                )
                existing = existing_transcript.scalar_one_or_none()

                if existing:
                    # 更新現有逐字稿
                    existing.full_text = full_text
                    logger.debug(f"Updated full transcript for session {session_id}")
                else:
                    # 建立新逐字稿
                    new_transcript = Transcript(
                        session_id=session_id,
                        full_text=full_text
                    )
                    db.add(new_transcript)
                    logger.debug(f"Created full transcript for session {session_id}")

                await db.commit()

        except Exception as e:
            logger.error(f"Failed to update full transcript for session {session_id}: {e}")

    async def cleanup(self):
        """清理服務資源"""
        logger.info("Cleaning up AudioTranscriptionService...")

        # 等待所有正在處理的批次完成
        for session_id, lock in self.processing_locks.items():
            try:
                # 嘗試獲取鎖，等待正在進行的處理完成
                async with asyncio.timeout(10):  # 最多等待 10 秒
                    async with lock:
                        pass  # 鎖獲取成功，表示處理已完成
                logger.debug(f"Processing completed for session {session_id}")
            except asyncio.TimeoutError:
                logger.warning(f"Timeout waiting for batch processing to complete for session {session_id}")
            except Exception as e:
                logger.warning(f"Error during cleanup for session {session_id}: {e}")

        # 清理批次，但保留 header chunks
        for session_id in list(self.batches.keys()):
            if session_id in self.batches:
                batch = self.batches[session_id]
                if not batch.is_processing:
                    del self.batches[session_id]
                    logger.debug(f"Cleaned up batch for session {session_id}")

        # 清理處理鎖
        self.processing_locks.clear()

        # 可以選擇保留 header chunks 或清理它們
        # 這裡我們保留 header chunks 以便後續使用
        logger.info(f"Cleanup completed. Retained {len(self.session_headers)} header chunks.")

    def diagnose_session(self, session_id: UUID) -> Dict[str, Any]:
        """診斷特定 session 的狀態"""
        diagnosis = {
            'session_id': str(session_id),
            'has_header': session_id in self.session_headers,
            'header_size': len(self.session_headers.get(session_id, b'')),
            'has_batch': session_id in self.batches,
            'batch_info': None,
            'performance_stats': self.performance_stats.copy()
        }

        if session_id in self.batches:
            batch = self.batches[session_id]
            diagnosis['batch_info'] = {
                'chunk_count': len(batch.chunks),
                'is_processing': batch.is_processing,
                'batch_age_seconds': batch.get_batch_age(),
                'total_duration': batch.get_total_duration(),
                'chunk_sequences': [chunk['sequence'] for chunk in batch.chunks]
            }

        return diagnosis

    def get_all_session_status(self) -> Dict[str, Any]:
        """獲取所有 session 的狀態概覽"""
        return {
            'total_sessions_with_headers': len(self.session_headers),
            'total_active_batches': len(self.batches),
            'sessions_with_headers': list(str(sid) for sid in self.session_headers.keys()),
            'sessions_with_batches': list(str(sid) for sid in self.batches.keys()),
            'performance_stats': self.performance_stats.copy()
        }

def get_azure_openai_client() -> AzureOpenAI | None:
    """
    Initializes and returns the Azure OpenAI client.
    Returns None if the required environment variables are not set.
    """
    try:
        api_key = os.environ["AZURE_OPENAI_API_KEY"]
        azure_endpoint = os.environ["AZURE_OPENAI_ENDPOINT"]
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01")

        return AzureOpenAI(
            api_key=api_key,
            api_version=api_version,
            azure_endpoint=azure_endpoint,
        )
    except KeyError as e:
        logger.warning(f"Azure OpenAI environment variable not set: {e}. The service will be disabled.")
        return None


def get_whisper_deployment_name() -> str | None:
    """
    Returns the Whisper deployment name from environment variables.
    """
    try:
        deployment_name = os.getenv("WHISPER_DEPLOYMENT_NAME", "whisper-1")
        if not deployment_name:
            raise ValueError("WHISPER_DEPLOYMENT_NAME is set to an empty string.")
        return deployment_name
    except ValueError as e:
        logger.warning(f"{e} The service will be disabled.")
        return None

# 全域轉錄服務實例
_transcription_service: Optional[AudioTranscriptionService] = None

async def get_transcription_service() -> Optional[AudioTranscriptionService]:
    """獲取轉錄服務實例"""
    global _transcription_service

    if _transcription_service is None:
        _transcription_service = AudioTranscriptionService()
        if not await _transcription_service.initialize():
            _transcription_service = None

    return _transcription_service
