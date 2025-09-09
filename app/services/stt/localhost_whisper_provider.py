"""
Localhost Whisper Provider
透過 HTTP API 調用本地運行的 Whisper 服務（基於 MLX）
"""
from __future__ import annotations

import logging
import httpx
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from app.core.config import get_settings
from app.db.database import get_supabase_client
from app.services.stt.interfaces import ISTTProvider
from app.services.stt.lang_map import to_whisper
from app.utils.timer import PerformanceTimer
from app.utils.timing import calc_times
from app.core.ffmpeg import detect_audio_format, webm_to_wav

settings = get_settings()
logger = logging.getLogger(__name__)

__all__ = ["LocalhostWhisperProvider"]


class LocalhostWhisperProvider(ISTTProvider):
    """
    Localhost Whisper Provider
    透過 HTTP API 調用運行在 localhost 的 Whisper 服務
    預設使用 Breeze-ASR-25 模型
    """
    
    name = "localhost-whisper"
    
    def __init__(self, base_url: str = "http://localhost:8001"):
        """
        初始化 Localhost Whisper Provider
        
        Args:
            base_url: localhost whisper 服務的基礎 URL
        """
        self.base_url = base_url.rstrip("/")
        self.transcription_url = f"{self.base_url}/v1/audio/transcriptions"
        self.health_url = f"{self.base_url}/health"
        
        # HTTP 客戶端設定
        self.timeout = httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=5.0)
        
    async def _check_service_health(self) -> bool:
        """檢查 localhost whisper 服務是否可用"""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
                response = await client.get(self.health_url)
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Localhost Whisper 服務健康檢查失敗: {e}")
            return False

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
    ) -> Dict[str, Any] | None:
        """
        使用 localhost Whisper 服務進行語音轉錄
        
        Args:
            audio: 音頻數據 (bytes)
            session_id: 會話 ID
            chunk_seq: 音頻片段序號
            
        Returns:
            轉錄結果字典或 None
        """
        # 1. 查詢 canonical lang_code
        supa = get_supabase_client()
        row = (
            supa.table("sessions")
            .select("lang_code")
            .eq("id", str(session_id))
            .single()
            .execute()
        )
        canonical = (row.data or {}).get("lang_code", "zh-TW")
        api_language = to_whisper(canonical)

        # 2. 使用性能計時器
        with PerformanceTimer(f"LocalhostWhisper chunk {chunk_seq}"):
            # 3. 檢查服務健康狀態
            if not await self._check_service_health():
                logger.error(f"Localhost Whisper 服務不可用: {self.base_url}")
                return None
            
            logger.info(
                f"🎯 Localhost Whisper 轉錄: session_id={session_id}, "
                f"chunk={chunk_seq}, api_lang={api_language}, "
                f"canonical_lang={canonical}, endpoint={self.transcription_url}"
            )
            
            try:
                # 4. 檢測音訊格式並轉換為 WAV
                fmt = detect_audio_format(audio)
                if fmt not in ("webm", "wav"):
                    logger.error(f"Localhost Whisper 不支援格式 {fmt}")
                    return None

                wav_bytes = await webm_to_wav(audio) if fmt == "webm" else audio
                if not wav_bytes:
                    logger.error(f"WebM→WAV 轉換失敗 session={session_id} seq={chunk_seq}")
                    return None

                # 5. 準備請求數據
                files = {
                    "file": ("chunk.wav", wav_bytes, "audio/wav")
                }
                data = {
                    "model": "breeze-asr-25",  # 使用 Breeze-ASR-25 模型
                    "language": api_language,
                    "response_format": "json",
                    "temperature": 0
                }
                
                # 6. 調用 localhost Whisper API
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(
                        self.transcription_url,
                        files=files,
                        data=data
                    )
                    
                    if response.status_code != 200:
                        logger.error(f"Localhost Whisper API 錯誤: {response.status_code} - {response.text}")
                        return None
                    
                    result = response.json()
                
                # 7. 調試輸出
                logger.debug(f"Localhost Whisper raw response: {result}")
                
                # 8. 提取文本
                text = result.get("text", "").strip()
                if not text:
                    logger.info(f"Localhost Whisper 返回空文本: session_id={session_id}, chunk={chunk_seq}")
                    return None
                
                # 9. 計算時間戳
                start_time, end_time = calc_times(chunk_seq)
                
                # 10. 返回結果
                return {
                    "text": text,
                    "chunk_sequence": chunk_seq,
                    "session_id": str(session_id),
                    "lang_code": canonical,
                    "start_time": start_time,
                    "end_time": end_time,
                    "timestamp": datetime.utcnow().isoformat(),
                    "duration": settings.AUDIO_CHUNK_DURATION_SEC,
                    "provider": "localhost-whisper",
                    "model": "breeze-asr-25"
                }
                
            except httpx.TimeoutException:
                logger.error(f"Localhost Whisper 請求超時: session_id={session_id}, chunk={chunk_seq}")
                return None
            except httpx.ConnectError:
                logger.error(f"無法連接到 Localhost Whisper 服務: {self.base_url}")
                return None
            except Exception as e:
                logger.error(f"Localhost Whisper API 錯誤: {e}", exc_info=True)
                return None

    def max_rpm(self) -> int:
        """返回每分鐘最大請求數限制"""
        # localhost 服務通常沒有嚴格的 RPM 限制，但為了避免過載設定合理值
        return getattr(settings, "LOCALHOST_WHISPER_MAX_REQUESTS", 300)