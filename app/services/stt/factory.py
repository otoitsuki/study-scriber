from __future__ import annotations

import functools
import logging
from typing import Dict, Optional
from uuid import UUID

from app.db.database import get_supabase_client
from .base import ISTTProvider
from .gemini_provider import GeminiProvider
from .whisper_provider import WhisperProvider

logger = logging.getLogger(__name__)

# 簡易 LRU 快取，最多快取 128 個 session 對應 provider
@functools.lru_cache(maxsize=128)
def _create_provider(name: str) -> Optional[ISTTProvider]:
    if name == "gemini":
        return GeminiProvider()
    elif name == "whisper":
        return WhisperProvider()
    return None


def get_provider(session_id: UUID) -> Optional[ISTTProvider]:
    """取得指定 session 的 STT Provider 實例 (含快取)。"""
    try:
        supabase = get_supabase_client()
        resp = supabase.table("sessions").select("stt_provider").eq("id", str(session_id)).single().execute()
        name = resp.data.get("stt_provider", "whisper") if resp and resp.data else "whisper"
    except Exception as e:
        logger.error(f"[ProviderFactory] 讀取 session {session_id} stt_provider 失敗: {e}")
        name = "whisper"

    provider = _create_provider(name)
    if provider:
        logger.debug(f"[ProviderFactory] 為 session {session_id} 建立 provider: {name}")
    else:
        logger.debug(f"[ProviderFactory] 使用內建 Whisper provider (SimpleAudioTranscriptionService)")
    return provider
