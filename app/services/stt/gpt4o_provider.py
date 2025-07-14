from __future__ import annotations

import logging
import tempfile
from datetime import datetime
from typing import Any, Dict
from uuid import UUID

from openai import AsyncAzureOpenAI, RateLimitError

from app.core.config import get_settings
from app.core.ffmpeg import detect_audio_format, webm_to_wav
from app.db.database import get_supabase_client
from app.services.stt.interfaces import ISTTProvider
from app.services.stt.lang_map import to_gpt4o
from app.utils.timer import PerformanceTimer

logger = logging.getLogger(__name__)
s = get_settings()


class GPT4oProvider(ISTTProvider):
    """
    Azure GPT-4o Speech-to-Text Provider
    依 session.lang_code → ISO-639-1 → GPT4o 語音端點
    """

    name = "gpt4o"

    _client: AsyncAzureOpenAI | None = None

    # ---------- util -------------------------------------------------
    @classmethod
    def _client_lazy(cls) -> AsyncAzureOpenAI:
        if cls._client is None:
            api_key_raw = s.AZURE_OPENAI_API_KEY
            api_key = (
                api_key_raw.get_secret_value()
                if hasattr(api_key_raw, "get_secret_value")
                else api_key_raw
            )
            cls._client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=s.AZURE_OPENAI_ENDPOINT,
                api_version="2024-06-01",
                timeout=(5, 55),
                max_retries=2,
            )
        return cls._client

    # ---------- public API -------------------------------------------
    async def transcribe(
        self, audio: bytes, session_id: UUID, chunk_seq: int
    ) -> Dict[str, Any] | None:
        """
        1. 轉 webm→wav（GPT-4o 目前僅支援 wav）
        2. 呼叫 Azure GPT-4o 端點
        3. 回傳統一 dict 給呼叫端
        """

        # 取得 canonical 語言碼（zh-TW / en-US …）
        supa = get_supabase_client()
        row = (
            supa.table("sessions")
            .select("lang_code")
            .eq("id", str(session_id))
            .single()
            .execute()
        )
        canonical = (row.data or {}).get("lang_code", "zh-TW")
        api_lang = to_gpt4o(canonical)  # zh / en / auto

        # ---------- (1) 準備 wav ----------
        fmt = detect_audio_format(audio)
        if fmt not in ("webm", "wav"):
            logger.error("GPT4o 不支援音訊格式 %s", fmt)
            return None

        try:
            if fmt == "webm":
                wav_bytes = await webm_to_wav(audio)
                if not wav_bytes:
                    logger.error("webm_to_wav 失敗，session=%s chunk=%s", session_id, chunk_seq)
                    return None
            else:
                wav_bytes = audio
        except Exception as e:
            logger.error("WebM→WAV 轉換異常: %s", e)
            return None

        # ---------- (2) 呼叫 GPT-4o ----------
        client = self._client_lazy()

        with PerformanceTimer(f"gpt4o chunk {chunk_seq}"):
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fp:
                fp.write(wav_bytes)
                fp.flush()
                try:
                    resp = await client.audio.transcriptions.create(
                        model=s.GPT4O_DEPLOYMENT_NAME,
                        file=open(fp.name, "rb"),
                        language=api_lang,
                        response_format="json",
                        prompt=s.GPT4O_TRANSCRIBE_PROMPT
                    )
                except RateLimitError as e:
                    logger.warning("GPT4o 429: %s", e)
                    raise
                except Exception as e:
                    logger.error("GPT4o API error: %s", e, exc_info=True)
                    return None

        text: str = getattr(resp, "text", "").strip()
        if not text:
            logger.warning("GPT4o 空白文字 (session=%s chunk=%s)", session_id, chunk_seq)
            return None

        return {
            "text": text,
            "chunk_sequence": chunk_seq,
            "session_id": str(session_id),
            "lang_code": canonical,
            "timestamp": datetime.utcnow().isoformat(),
        }

    # ---------- meta -------------------------------------------------
    def max_rpm(self) -> int:
        """回傳每分鐘最大呼叫數（config 可調）。"""
        return getattr(s, "GPT4O_MAX_REQUESTS", 60)
