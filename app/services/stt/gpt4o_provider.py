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


s = get_settings()
api_key_raw = s.AZURE_OPENAI_API_KEY

logger = logging.getLogger(__name__)

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
        return 60

    async def transcribe(self, webm: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any] | None:
        logger.info(f"[GPT4o] 開始轉錄 chunk {chunk_seq} (session {session_id})")
        fmt = detect_audio_format(webm)
        if fmt not in ("webm", "wav"):
            logger.warning(f"[GPT4o] 不支援的音檔格式: {fmt} (session {session_id}, chunk {chunk_seq})")
            return None
        r2_key = f"gpt4o-cache/{session_id}/{chunk_seq:06}.wav"
        try:
            # 步驟 1: 轉換音檔
            wav_bytes = await webm_to_wav(webm)
            if not wav_bytes:
                logger.error(f"WAV conversion failed (Session: {session_id})。")
                return None
            # （可選）仍上傳 R2 作快取
            await self.r2_client.put_object(r2_key, wav_bytes, "audio/wav")
            # 步驟 2: 呼叫 OpenAI API，傳 (filename, BytesIO, mime)
            from io import BytesIO
            file_tuple = ("audio.wav", BytesIO(wav_bytes), "audio/wav")
            s = get_settings()
            response = await self.client.audio.transcriptions.create(
                model=self.model_name,        # gpt-4o-transcribe
                file=file_tuple,              # (filename, file-obj, mime)
                language="zh-TW",
                response_format="json",
            )
            # 取文字
            if hasattr(response, "text"):
                transcribed_text = response.text
            elif isinstance(response, dict) and "text" in response:
                transcribed_text = response["text"]
            else:
                logger.error("[GPT4o] 無 text 欄位，response=%s", response)
                return None

            logger.debug("[GPT4o] text='%s…' (len=%d)", transcribed_text[:30], len(transcribed_text))

            from datetime import datetime
            from app.lib.settings_utils import get_chunk_duration
            text = response.text.strip()
            result = {
                "text": text,
                "chunk_sequence": chunk_seq,
                "timestamp": datetime.utcnow().isoformat(),
                "language": "zh-TW",
                "start_offset": 0,
                "end_offset": get_chunk_duration(),
            }
            logger.debug("[GPT4o] result → %s", result)
            return result
        except Exception as e:
            logger.error(f"[GPT4o] 轉錄失敗: {e}", exc_info=True)
            return None
        finally:
            pass  # 若需自動刪除 R2 檔案可於此補上
