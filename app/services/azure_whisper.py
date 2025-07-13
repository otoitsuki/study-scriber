import logging
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import UUID
from typing import Any, Dict, Optional

from openai import AsyncAzureOpenAI
from httpx import Timeout
from app.core.config import settings

__all__ = ["AzureWhisperService", "PerformanceTimer"]

logger = logging.getLogger(__name__)

class PerformanceTimer:
    """效能計時器"""
    def __init__(self, operation_name: str):
        self.operation_name = operation_name
        self.start_time = None
        self.end_time = None

    def __enter__(self):
        import time
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        import time
        self.end_time = time.time()
        duration = self.get_duration()
        if duration > 1.0:
            logger.warning(f"⚠️  {self.operation_name} took {duration:.2f}s (slow)")
        else:
            logger.info(f"⏱️  {self.operation_name} completed in {duration:.2f}s")

    def get_duration(self) -> float:
        if self.start_time and self.end_time:
            return self.end_time - self.start_time
        return 0.0

class AzureWhisperService:
    def __init__(self):
        self.client = AsyncAzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_version="2024-06-01",
            timeout=Timeout(connect=5, read=55, write=30, pool=5),
            max_retries=2,
        )
        self.deployment = settings.WHISPER_DEPLOYMENT_NAME
        self.language = settings.WHISPER_LANGUAGE

    async def transcribe(self, audio: bytes, session_id: UUID, chunk_seq: int, *, api_language: str, canonical_lang: str) -> Optional[Dict[str, Any]]:
        with PerformanceTimer(f"Whisper chunk {chunk_seq}"):
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_file:
                temp_file.write(audio)
                temp_file.flush()
                logger.info(f"🔎 call whisper: session_id={session_id}, chunk={chunk_seq}, api_lang={api_language}, canonical_lang={canonical_lang}, temp_file={temp_file.name}")
                try:
                    with open(temp_file.name, 'rb') as audio_file:
                        transcript = await self.client.audio.transcriptions.create(
                            model=self.deployment,
                            file=audio_file,
                            language=api_language,
                            response_format="json",
                            temperature=0
                        )
                    # Debug Azure 回傳內容
                    try:
                        import json
                        logger.debug("Whisper raw json ⇒ %s", resp) # type: ignore
                        logger.debug("Whisper raw response: %s", json.dumps(transcript if isinstance(transcript, dict) else transcript.__dict__, ensure_ascii=False, indent=2))
                    except Exception as e:
                        logger.debug("Whisper raw response (fallback): %s", str(transcript))
                        logger.debug("Failed to json.dumps transcript: %s", e)
                    Path(temp_file.name).unlink(missing_ok=True)
                    text = getattr(transcript, "text", None) or (transcript.get("text") if isinstance(transcript, dict) else None)
                    if not text or not text.strip():
                        return None
                    return {
                        "text": text.strip(),
                        "chunk_sequence": chunk_seq,
                        "session_id": str(session_id),
                        "lang_code": canonical_lang,
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                finally:

                    Path(temp_file.name).unlink(missing_ok=True)
