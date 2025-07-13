from __future__ import annotations

import functools
import logging
from typing import Dict, Optional
from uuid import UUID

from app.db.database import get_supabase_client
from .base import ISTTProvider
from .gemini_provider import GeminiProvider
from .whisper_provider import WhisperProvider
from app.services.stt.gpt4o_provider import GPT4oProvider

logger = logging.getLogger(__name__)

# 簡易 LRU 快取，最多快取 128 個 session 對應 provider
@functools.lru_cache(maxsize=128)
def _create_provider(name: str) -> Optional[ISTTProvider]:
    if name == "gemini":
        return GeminiProvider()
    elif name == "whisper":
        return WhisperProvider()
    return None


__all__ = ["get_provider"]

_provider_cache: Dict[str, ISTTProvider] = {}

def instance(cls) -> ISTTProvider:
    if cls.name not in _provider_cache:
        _provider_cache[cls.name] = cls()
    return _provider_cache[cls.name]

def get_provider(session_id: UUID) -> ISTTProvider:
    from app.db.database import get_supabase_client
    supa = get_supabase_client()
    row = supa.table("sessions").select("stt_provider").eq("id", str(session_id)).single().execute()
    name = (row.data or {}).get("stt_provider", "whisper").lower()
    match name:
        case "gpt4o": return instance(GPT4oProvider)
        case _:       return instance(WhisperProvider)
