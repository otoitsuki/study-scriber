from __future__ import annotations

import logging
from uuid import UUID
from typing import Any, Dict, Optional
from app.services.stt.base import ISTTProvider
from app.services.azure_whisper import AzureWhisperService
from app.services.stt.lang_map import to_whisper
from app.db.database import get_supabase_client

import json
from app.core.config import get_settings

logger = logging.getLogger(__name__)

__all__ = ["WhisperProvider", "save_and_push_result"]

class WhisperProvider(ISTTProvider):
    name = "whisper"
    _service: Optional[AzureWhisperService] = None

    def __init__(self) -> None:
        if self._service is None:
            self._service = AzureWhisperService()

    def max_rpm(self) -> int:
        # 可根據設定調整
        from app.core.config import get_settings
        settings = get_settings()
        return getattr(settings, "WHISPER_MAX_REQUESTS", 180)


    async def transcribe(self, audio: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any] | None:
        # 查詢 canonical lang_code
        supa = get_supabase_client()
        row = supa.table("sessions").select("lang_code").eq("id", str(session_id)).single().execute()
        canonical = (row.data or {}).get("lang_code", "zh-TW")
        api_language = to_whisper(canonical)
        return await self._service.transcribe(
            audio, session_id, chunk_seq,
            api_language=api_language,
            canonical_lang=canonical
        )

async def save_and_push_result(session_id: UUID, chunk_seq: int, data: dict):
    """共用：把結果寫入 transcript_segments 並透過 WebSocket 推送"""
    from app.ws.transcript_feed import manager
    from app.db.database import get_supabase_client

    settings = get_settings()
    supa = get_supabase_client()
    seg = {
        "session_id": str(session_id),
        "chunk_sequence": chunk_seq,
        "text": data["text"],
        "start_time": chunk_seq * settings.AUDIO_CHUNK_DURATION_SEC,
        "end_time": (chunk_seq + 1) * settings.AUDIO_CHUNK_DURATION_SEC,
        "confidence": 1.0,
        "lang_code": data["lang_code"],
    }
    row = supa.table("transcript_segments").insert(seg).execute()

    # WebSocket
    await manager.broadcast(
        json.dumps({
            "type": "transcript_segment",
            "session_id": str(session_id),
            "segment_id": row.data[0]["id"],
            **seg
        }),
        str(session_id)
    )
