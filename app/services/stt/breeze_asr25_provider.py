# app/services/stt/breeze_asr25_provider.py
from __future__ import annotations

import logging
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional
from uuid import UUID

from openai import AsyncAzureOpenAI
from httpx import Timeout

from app.core.config import get_settings
from app.db.database import get_supabase_client
from app.services.stt.interfaces import ISTTProvider
from app.services.stt.lang_map import to_whisper
from app.utils.timer import PerformanceTimer
from app.utils.timing import calc_times

settings = get_settings()
logger = logging.getLogger(__name__)

__all__ = ["BreezeASR25Provider"]


class BreezeASR25Provider(ISTTProvider):
    """
    Breeze-ASR-25 Provider
    基於 Whisper-large-v2 開發的 MediaTek 模型
    使用 Azure OpenAI Whisper API 調用
    """
    
    name = "breeze-asr-25"
    _client: Optional[AsyncAzureOpenAI] = None

    @classmethod
    def _client_lazy(cls) -> AsyncAzureOpenAI:
        """懶加載 Azure OpenAI 客戶端"""
        if cls._client is None:
            api_key_raw = settings.AZURE_OPENAI_API_KEY
            api_key = (
                api_key_raw.get_secret_value()
                if hasattr(api_key_raw, "get_secret_value")
                else api_key_raw
            )
            cls._client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                api_version=settings.AZURE_OPENAI_API_VERSION,
                timeout=Timeout(connect=5, read=55, write=30, pool=5),
                max_retries=2,
            )
        return cls._client

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
    ) -> Dict[str, Any] | None:
        """
        使用 Breeze-ASR-25 模型進行語音轉錄
        
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
        with PerformanceTimer(f"Breeze-ASR-25 chunk {chunk_seq}"):
            # 3. 創建臨時文件
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                temp_file.write(audio)
                temp_file.flush()
                
                logger.info(
                    f"🎯 Breeze-ASR-25 轉錄: session_id={session_id}, "
                    f"chunk={chunk_seq}, api_lang={api_language}, "
                    f"canonical_lang={canonical}, temp_file={temp_file.name}"
                )
                
                try:
                    # 4. 調用 Azure OpenAI Whisper API
                    client = self._client_lazy()
                    with open(temp_file.name, 'rb') as audio_file:
                        transcript = await client.audio.transcriptions.create(
                            model="breeze-asr-25",  # 指定使用 Breeze-ASR-25 模型
                            file=audio_file,
                            language=api_language,
                            response_format="json",
                            temperature=0
                        )
                    
                    # 5. 調試輸出
                    try:
                        import json
                        logger.debug(
                            "Breeze-ASR-25 raw response: %s",
                            json.dumps(
                                transcript if isinstance(transcript, dict) else transcript.__dict__,
                                ensure_ascii=False,
                                indent=2
                            )
                        )
                    except Exception as e:
                        logger.debug("Breeze-ASR-25 raw response (fallback): %s", str(transcript))
                        logger.debug("Failed to json.dumps transcript: %s", e)
                    
                    # 6. 清理臨時文件
                    Path(temp_file.name).unlink(missing_ok=True)
                    
                    # 7. 提取文本
                    text = getattr(transcript, "text", None) or (
                        transcript.get("text") if isinstance(transcript, dict) else None
                    )
                    
                    if not text or not text.strip():
                        logger.info(f"Breeze-ASR-25 返回空文本: session_id={session_id}, chunk={chunk_seq}")
                        return None
                    
                    # 8. 計算時間戳
                    start_time, end_time = calc_times(chunk_seq)
                    
                    # 9. 返回結果
                    return {
                        "text": text.strip(),
                        "chunk_sequence": chunk_seq,
                        "session_id": str(session_id),
                        "lang_code": canonical,
                        "start_time": start_time,
                        "end_time": end_time,
                        "timestamp": datetime.utcnow().isoformat(),
                        "duration": settings.AUDIO_CHUNK_DURATION_SEC,
                    }
                    
                except Exception as e:
                    logger.error(f"Breeze-ASR-25 API 錯誤: {e}", exc_info=True)
                    return None
                finally:
                    # 確保清理臨時文件
                    Path(temp_file.name).unlink(missing_ok=True)

    def max_rpm(self) -> int:
        """返回每分鐘最大請求數限制"""
        # 使用與 Whisper 相同的限制
        return getattr(settings, "WHISPER_MAX_REQUESTS", 180)