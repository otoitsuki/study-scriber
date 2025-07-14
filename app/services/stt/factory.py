# app/services/stt/factory.py
from __future__ import annotations

import logging
from typing import Dict, Type
from uuid import UUID

from app.db.database import get_supabase_client
from app.services.stt.interfaces import ISTTProvider
from app.services.stt.whisper_provider import WhisperProvider
from app.services.stt.gpt4o_provider import GPT4oProvider
from app.services.stt.gemini_provider import GeminiProvider
from app.core.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()
# ------------------------------------------------------------------
# 1. provider singleton cache
# ------------------------------------------------------------------
_provider_cache: Dict[str, ISTTProvider] = {}


def _instance(cls: Type[ISTTProvider]) -> ISTTProvider:
    """
    lazy singleton per provider class
    Provider 類別必須有 `name` class 屬性 (str)
    """
    if cls.name not in _provider_cache:
        _provider_cache[cls.name] = cls()
    return _provider_cache[cls.name]


# ------------------------------------------------------------------
# 2. public API
# ------------------------------------------------------------------
def get_provider(session_id: UUID) -> ISTTProvider:
    """
    根據 sessions.stt_provider 欄位，回傳對應 ISTTProvider 物件。
    預設 whisper。
    """
    supa = get_supabase_client()
    row = (
        supa.table("sessions")
        .select("stt_provider")
        .eq("id", str(session_id))
        .single()
        .execute()
    )

    provider_code: str = (
    row.data or {}
).get("stt_provider", settings.STT_PROVIDER_DEFAULT).lower()

    match provider_code:
        case "gpt4o" | "gpt-4o":
            return _instance(GPT4oProvider)
        case "gemini" | "google_gemini":
            return _instance(GeminiProvider)
        case "whisper" | _:
            # 包含 None / 空字串 → whisper
            return _instance(WhisperProvider)
