import logging
import uuid
from io import BytesIO
from typing import Dict, Any
from pydantic import SecretStr
from uuid import UUID
from openai import AsyncAzureOpenAI
from app.core.config import get_settings
from app.services.stt.base import ISTTProvider
from app.core.ffmpeg import detect_audio_format, webm_to_wav
from app.services.r2_client import get_r2_client
from app.lib.httpx_timeout import get_httpx_timeout
from datetime import datetime
from app.lib.settings_utils import get_chunk_duration
from app.services.stt.lang_map import to_gpt4o
from app.db.database import get_supabase_client


s = get_settings()
api_key_raw = s.AZURE_OPENAI_API_KEY

logger = logging.getLogger(__name__)

__all__ = ["GPT4oProvider"]

class GPT4oProvider(ISTTProvider):
    """
    使用 Azure OpenAI GPT-4o 模型的語音轉文字 (STT) 提供者。
    """
    def __init__(self):
        settings = get_settings()
        if not all([
            settings.AZURE_OPENAI_API_KEY,
            settings.AZURE_OPENAI_ENDPOINT,
            settings.GPT4O_DEPLOYMENT_NAME
        ]):
            raise ValueError("GPT-4o 所需的 Azure OpenAI 憑證或部署名稱尚未設定。")
        # 兼容 SecretStr 與普通 str
        api_key = (
            api_key_raw.get_secret_value()
            if isinstance(api_key_raw, SecretStr)
            else api_key_raw
        )
        self.client = AsyncAzureOpenAI(
            api_key=api_key,
            azure_endpoint=s.AZURE_OPENAI_ENDPOINT,
            api_version="2024-05-01-preview",
            timeout=get_httpx_timeout(),
        )
        self.model_name = settings.GPT4O_DEPLOYMENT_NAME
        self.r2_bucket = settings.R2_BUCKET_NAME
        self.r2_client = get_r2_client()

    def name(self) -> str:
        return "gpt4o"

    def max_rpm(self) -> int:
        # TODO: 根據設定調整
        from app.core.config import get_settings
        settings = get_settings()
        return getattr(settings, "GPT4O_MAX_REQUESTS", 60)

    async def transcribe(self, audio: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any] | None:
        # 查詢 canonical lang_code
        supa = get_supabase_client()
        row = supa.table("sessions").select("lang_code").eq("id", str(session_id)).single().execute()
        canonical = (row.data or {}).get("lang_code", "zh-TW")
        provider_lang = to_gpt4o(canonical)
        # TODO: call Azure GPT-4o transcribe endpoint
        # 先檢查格式，僅支援 webm/wav
        fmt = detect_audio_format(audio)
        if fmt not in ("webm", "wav"):
            logger.error(f"[GPT4o] 不支援的音訊格式: {fmt}")
            return None
        try:
            if fmt == "webm":
                wav_bytes = await webm_to_wav(audio)
                if not wav_bytes:
                    logger.error(f"[GPT4o] webm_to_wav 轉換失敗 (session={session_id}, chunk={chunk_seq})")
                    return None
            else:
                wav_bytes = audio
            # 這裡預留後續上傳與回傳格式，暫以 NotImplementedError 表示
            raise NotImplementedError("GPT-4o provider 尚未實作上傳與回傳")
        except Exception as e:
            logger.error(f"[GPT4o] 轉檔或上傳過程異常: {e}")
            return None
