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

from openai import AzureOpenAI

from ..db.database import get_supabase_client
from app.core.config import settings
from app.ws.transcript_feed import manager as transcript_manager
from app.services.r2_client import R2Client

logger = logging.getLogger(__name__)

# 全域效能監控開關
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

# 配置常數
CHUNK_DURATION = 12  # 12 秒切片
PROCESSING_TIMEOUT = 30  # 處理超時（秒）
MAX_RETRIES = 3  # 最大重試次數

# 全域集合追蹤已廣播 active 相位的 session
_active_phase_sent: Set[str] = set()

class SimpleAudioTranscriptionService:
    """簡化的音訊轉錄服務"""

    def __init__(self, azure_client: AzureOpenAI, deployment_name: str):
        self.client = azure_client
        self.deployment_name = deployment_name
        self.processing_tasks: Dict[str, asyncio.Task] = {}

    async def process_audio_chunk(self, session_id: UUID, chunk_sequence: int, webm_data: bytes) -> bool:
        """
        處理單一音訊切片

        Args:
            session_id: 會話 ID
            chunk_sequence: 切片序號
            webm_data: WebM 音訊數據

        Returns:
            bool: 處理是否成功
        """
        task_key = f"{session_id}_{chunk_sequence}"

        # 避免重複處理
        if task_key in self.processing_tasks:
            logger.debug(f"Chunk {chunk_sequence} already being processed for session {session_id}")
            return False

        # 建立處理任務
        task = asyncio.create_task(
            self._process_chunk_async(session_id, chunk_sequence, webm_data)
        )
        self.processing_tasks[task_key] = task

        # 清理完成的任務
        task.add_done_callback(lambda t: self.processing_tasks.pop(task_key, None))

        return True

    async def _process_chunk_async(self, session_id: UUID, chunk_sequence: int, webm_data: bytes):
        """非同步處理音訊切片"""
        try:
            with PerformanceTimer(f"Process chunk {chunk_sequence} for session {session_id}"):
                logger.info(f"🎵 開始處理音訊切片 {chunk_sequence} (session: {session_id}, size: {len(webm_data)} bytes)")

                # 步驟 1: 驗證 WebM 數據
                if not self._validate_webm_data(webm_data, chunk_sequence):
                    return

                # 步驟 2: WebM → WAV 轉換
                wav_data = await self._convert_webm_to_wav(webm_data, chunk_sequence)
                if not wav_data:
                    logger.error(f"Failed to convert WebM to WAV for chunk {chunk_sequence}")
                    return

                # 步驟 3: Whisper 轉錄
                transcript_result = await self._transcribe_audio(wav_data, session_id, chunk_sequence)
                if not transcript_result:
                    logger.error(f"Failed to transcribe chunk {chunk_sequence}")
                    return

                # 步驟 4: 儲存並推送結果
                await self._save_and_push_result(session_id, chunk_sequence, transcript_result)

                logger.info(f"✅ 成功處理音訊切片 {chunk_sequence}: '{transcript_result.get('text', '')[:50]}...'")

        except Exception as e:
            logger.error(f"Error processing chunk {chunk_sequence} for session {session_id}: {e}", exc_info=True)

    def _validate_webm_data(self, webm_data: bytes, chunk_sequence: int) -> bool:
        """驗證 WebM 數據 - 簡化版本，信任瀏覽器產生的資料"""
        if not webm_data or len(webm_data) < 50:
            logger.warning(f"WebM chunk {chunk_sequence} too small: {len(webm_data) if webm_data else 0} bytes")
            return False

        # 移除 EBML 標頭檢查，信任 MediaRecorder 產生的資料
        # FFmpeg 會用 -fflags +genpts 處理不完整的流式資料
        return True

    async def _convert_webm_to_wav(self, webm_data: bytes, chunk_sequence: int) -> Optional[bytes]:
        """將 WebM / fMP4 轉換為 WAV，自動辨識來源格式"""

        def _detect_format(data: bytes) -> str:
            """簡易檢測音訊封裝格式 (webm / mp4)"""
            if len(data) < 12:
                return 'unknown'
            # WebM (Matroska) 以 EBML header 開頭 0x1A45DFA3
            if data[0:4] == b'\x1A\x45\xDF\xA3':
                return 'webm'
            # MP4/ISOBMFF 常在 4–8 byte 看到 'ftyp'
            if b'ftyp' in data[4:12]:
                return 'mp4'
            return 'unknown'

        try:
            audio_format = _detect_format(webm_data)
            with PerformanceTimer(f"{audio_format.upper()} to WAV conversion for chunk {chunk_sequence}"):

                # 基本 FFmpeg 參數
                cmd = ['ffmpeg']

                # 依來源格式決定輸入參數
                if audio_format == 'mp4':
                    # Safari 產出的 fragmented MP4
                    cmd += ['-f', 'mp4']
                # 通用旗標：生成時間戳處理不完整流
                cmd += ['-fflags', '+genpts', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 'wav', '-y', 'pipe:1']

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
                    logger.error(f"FFmpeg conversion failed for chunk {chunk_sequence}: {error_msg}")
                    return None

                if not stdout or len(stdout) < 100:
                    logger.error(
                        f"FFmpeg produced insufficient WAV data for chunk {chunk_sequence}: {len(stdout) if stdout else 0} bytes")
                    return None

                logger.debug(
                    f"Successfully converted {audio_format.upper()} ({len(webm_data)} bytes) to WAV ({len(stdout)} bytes)")
                return stdout

        except asyncio.TimeoutError:
            logger.error(f"FFmpeg conversion timeout for chunk {chunk_sequence}")
            return None
        except Exception as e:
            logger.error(f"FFmpeg conversion error for chunk {chunk_sequence}: {e}")
            return None

    async def _transcribe_audio(self, wav_data: bytes, session_id: UUID, chunk_sequence: int) -> Optional[Dict[str, Any]]:
        """使用 Azure OpenAI Whisper 轉錄音訊"""
        try:
            with PerformanceTimer(f"Whisper transcription for chunk {chunk_sequence}"):
                # 建立臨時檔案
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                    temp_file.write(wav_data)
                    temp_file.flush()

                    try:
                        # Whisper API 呼叫
                        with open(temp_file.name, 'rb') as audio_file:
                            transcript = self.client.audio.transcriptions.create(
                                model=self.deployment_name,
                                file=audio_file,
                                language="zh",
                                response_format="text"
                            )

                        # 清理臨時檔案
                        Path(temp_file.name).unlink(missing_ok=True)

                        if not transcript or not transcript.strip():
                            logger.debug(f"Empty transcript for chunk {chunk_sequence}")
                            return None

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

        except Exception as e:
            logger.error(f"Whisper transcription failed for chunk {chunk_sequence}: {e}")
            return None

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

    # TODO: 在此處實現更優雅的關閉邏輯
    logger.info("Transcription service is shutting down...")

# ----------------------
# 兼容舊測試的工廠函式與全域變數
# ----------------------

_transcription_service_v2: Optional[SimpleAudioTranscriptionService] = None


def get_azure_openai_client() -> Optional[AzureOpenAI]:
    """根據環境變數建立 AzureOpenAI 用戶端，缺值時回傳 None。"""
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    if not api_key or not endpoint:
        return None
    # 使用預設 API 版本即可
    return AzureOpenAI(api_key=api_key, api_version="2024-06-01", azure_endpoint=endpoint)


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
    logger.info("✅ Transcription service v2 initialized")
    return _transcription_service_v2


def cleanup_transcription_service_v2():
    """清理全域轉錄服務實例。"""
    global _transcription_service_v2
    _transcription_service_v2 = None
