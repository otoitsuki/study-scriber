from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, Any
from uuid import UUID

from app.core.config import get_settings
from .base import ISTTProvider

logger = logging.getLogger(__name__)
settings = get_settings()


class WhisperProvider(ISTTProvider):
    """使用 Azure OpenAI Whisper 的語音轉文字 Provider。

    整合現有的 SimpleAudioTranscriptionService 功能，
    提供一致的 Provider 介面。
    """

    def __init__(self) -> None:
        self._service = None

    def name(self) -> str:
        return "whisper"

    def max_rpm(self) -> int:
        # Azure OpenAI 的 Whisper 通常有較高的速率限制
        return getattr(settings, "WHISPER_MAX_REQUESTS", 180)

    async def transcribe(self, webm: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any]:
        """使用現有的 SimpleAudioTranscriptionService 進行轉錄。"""
        logger.info(f"🎙️ [Whisper] 開始轉錄 chunk {chunk_seq} (session {session_id})")

        # 延遲初始化，避免循環導入
        if self._service is None:
            from app.services.azure_openai_v2 import initialize_transcription_service_v2
            self._service = await initialize_transcription_service_v2()
            if self._service is None:
                raise RuntimeError("無法初始化 Whisper 轉錄服務")

        # 使用現有服務進行轉錄
        # 注意：這裡調用的是內部方法，因為 process_audio_chunk 會通過 Queue
        result = await self._service._transcribe_audio(webm, session_id, chunk_seq)

        if result is None:
            raise RuntimeError(f"Whisper 轉錄失敗：chunk {chunk_seq}")

        logger.info(f"✅ [Whisper] chunk {chunk_seq} 轉錄完成，長度 {len(result.get('text', ''))} 字")

        # 確保回傳格式一致
        return {
            "text": result.get("text", ""),
            "chunk_sequence": chunk_seq,
            "session_id": str(session_id),
            "timestamp": result.get("timestamp", datetime.utcnow().isoformat()),
            "start_offset": result.get("start_offset", 0),
            "end_offset": result.get("end_offset", 0),
            "provider": self.name(),
        }
