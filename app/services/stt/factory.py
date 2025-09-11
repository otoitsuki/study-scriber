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
from app.services.stt.breeze_asr25_provider import BreezeASR25Provider
from app.services.stt.localhost_whisper_provider import LocalhostWhisperProvider
from app.services.stt.dynamic_providers import (
    WhisperProviderDynamic,
    GPT4oProviderDynamic,
    GeminiProviderDynamic,
    LocalhostWhisperProviderDynamic
)
from app.core.config import get_settings
from app.core.llm_manager import llm_manager

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
    根據 session 的 LLM 配置或 sessions.stt_provider 欄位，回傳對應 ISTTProvider 物件。
    優先順序：1. Session LLM 配置 2. DB stt_provider 3. 環境變數預設
    """

    # 1. 優先檢查是否有 session 專屬的 LLM 配置
    llm_config = llm_manager.get_config(session_id)

    if llm_config:
        logger.info(f"🎯 Using session LLM config for {session_id}: model={llm_config.model}")

        # 根據模型判斷 STT 方法
        stt_method = llm_manager.detect_stt_method(llm_config.model)

        # 建立動態 provider
        if stt_method == "whisper":
            return WhisperProviderDynamic(
                base_url=llm_config.base_url,
                api_key=llm_config.api_key,
                model=llm_config.model,
                api_version=llm_config.api_version
            )
        elif stt_method == "gpt4o-audio":
            return GPT4oProviderDynamic(
                base_url=llm_config.base_url,
                api_key=llm_config.api_key,
                model=llm_config.model,
                api_version=llm_config.api_version
            )
        elif stt_method == "gemini":
            return GeminiProviderDynamic(
                api_key=llm_config.api_key,
                model=llm_config.model,
                endpoint=llm_config.base_url
            )
        elif stt_method == "localhost-whisper":
            return LocalhostWhisperProviderDynamic(
                base_url=llm_config.base_url,
                api_key=llm_config.api_key or "dummy",
                model=llm_config.model
            )

    # 2. Fallback 到原有邏輯（從 DB 讀 stt_provider）
    logger.info(f"📦 No session LLM config found for {session_id}, using DB stt_provider")

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
        case "breeze-asr-25" | "localhost-breeze":
            # 使用 Localhost Whisper Provider with Breeze-ASR-25 模型
            provider = LocalhostWhisperProvider(model="breeze-asr-25")
            _provider_cache[f"localhost-whisper-breeze"] = provider
            return provider
        case "localhost-whisper":
            # 使用預設的 Localhost Whisper Provider
            return _instance(LocalhostWhisperProvider)
        case "localhost-whisper-turbo":
            # 使用 Localhost Whisper Provider with Large3 Turbo 模型
            provider = LocalhostWhisperProvider(model="whisper-large3-turbo")
            _provider_cache[f"localhost-whisper-turbo"] = provider
            return provider
        case "whisper" | _:
            # 包含 None / 空字串 → whisper
            return _instance(WhisperProvider)
