# app/services/stt/gpt4o_provider.py
from __future__ import annotations

import logging
from datetime import datetime
from io import BytesIO
from typing import Any, Dict
from uuid import UUID

from openai import AsyncAzureOpenAI, RateLimitError

from app.core.config import get_settings
from app.core.ffmpeg import detect_audio_format, webm_to_wav
from app.db.database import get_supabase_client
from app.services.stt.interfaces import ISTTProvider
from app.services.stt.lang_map import to_gpt4o
from app.utils.timer import PerformanceTimer
from app.utils.timing import calc_times

settings = get_settings()
logger = logging.getLogger(__name__)


class GPT4oProvider(ISTTProvider):
    """Azure GPT-4o Audio Transcriptions"""

    name = "gpt4o"
    _client: AsyncAzureOpenAI | None = None

    # ---------- client singleton ------------------------------------
    @classmethod
    def _client_lazy(cls) -> AsyncAzureOpenAI:
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
                api_version="2024-06-01",
                timeout=(5, 55),          # connect / read
                max_retries=2,
            )
        return cls._client

    # ---------- main -------------------------------------------------
    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
    ) -> Dict[str, Any] | None:
        """
        • 將 WebM→WAV（16 kHz mono）
        • 呼叫 GPT-4o 取得 text
        • 回傳統一欄位；None 代表跳過
        """

        # 1. 取得 canonical lang_code → zh / en / auto
        supa = get_supabase_client()
        row = (
            supa.table("sessions").select("lang_code")
            .eq("id", str(session_id)).single().execute()
        )
        canonical = (row.data or {}).get("lang_code", "zh-TW")
        api_lang = to_gpt4o(canonical)

        # 2. 轉 WAV
        fmt = detect_audio_format(audio)
        if fmt not in ("webm", "wav"):
            logger.error("GPT4o 不支援格式 %s", fmt)
            return None

        wav_bytes = await webm_to_wav(audio) if fmt == "webm" else audio
        if not wav_bytes:
            logger.error("WebM→WAV 轉換失敗 %s seq=%s", session_id, chunk_seq)
            return None

        # 3. 呼叫 GPT-4o
        client = self._client_lazy()
        with PerformanceTimer(f"gpt4o chunk {chunk_seq}"):
            try:
                # (filename, bytes/IO, mime)
                file_tuple = ("chunk.wav", wav_bytes, "audio/wav")
                resp = await client.audio.transcriptions.create(
                    model=settings.GPT4O_DEPLOYMENT_NAME,
                    file=file_tuple,
                    language=api_lang,
                    response_format="json",
                    prompt=settings.GPT4O_TRANSCRIBE_PROMPT or None,
                )
            except RateLimitError as e:
                logger.warning("GPT4o 429: %s", e)
                raise
            except Exception as e:
                logger.error("GPT4o API error: %s", e, exc_info=True)
                return None

        text = getattr(resp, "text", "").strip()
        if not text:
            logger.info("GPT4o 空白文字 %s seq=%s", session_id, chunk_seq)
            return None

        # 4. 時間戳 = chunk_seq × D
        start_time, end_time = calc_times(chunk_seq)

        return {
            "text": text,
            "chunk_sequence": chunk_seq,
            "session_id": str(session_id),
            "lang_code": canonical,
            "start_time": start_time,
            "end_time": end_time,
            "timestamp": datetime.utcnow().isoformat(),
            "duration": settings.AUDIO_CHUNK_DURATION_SEC,
        }

    # ---------- meta -----------------------------------------------
    def max_rpm(self) -> int:
        return getattr(settings, "GPT4O_MAX_REQUESTS", 60)
