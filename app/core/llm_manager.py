"""
LLM 配置管理器 - 使用記憶體快取
不需要修改資料庫架構，支援 session 級別的動態 LLM 配置
"""
from typing import Dict, Optional, Union
from uuid import UUID
from datetime import datetime, timedelta
from dataclasses import dataclass
import logging
from openai import AsyncOpenAI, AsyncAzureOpenAI

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class LLMConfig:
    """LLM 配置資料結構"""
    base_url: str
    api_key: str
    model: str
    api_version: Optional[str] = None
    created_at: datetime = None

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.utcnow()


class LLMConfigManager:
    """
    Session 級 LLM 配置管理器
    使用記憶體快取，不修改資料庫
    """

    def __init__(self, ttl_hours: int = 24):
        self._cache: Dict[UUID, LLMConfig] = {}
        self._ttl_hours = ttl_hours
        logger.info(f"LLMConfigManager initialized with TTL: {ttl_hours} hours")

    def set_config(self, session_id: UUID, config: dict) -> None:
        """儲存 session 的 LLM 配置"""
        self._cache[session_id] = LLMConfig(
            base_url=config["base_url"],
            api_key=config["api_key"],  # TODO: 實際應用應加密
            model=config["model"],
            api_version=config.get("api_version")
        )
        logger.info(f"✅ Set LLM config for session {session_id}, model: {config['model']}")

    def get_config(self, session_id: UUID) -> Optional[LLMConfig]:
        """取得 session 的 LLM 配置，檢查過期時間"""
        if session_id in self._cache:
            config = self._cache[session_id]
            # 檢查是否過期
            if datetime.utcnow() - config.created_at < timedelta(hours=self._ttl_hours):
                return config
            else:
                # 過期則刪除
                del self._cache[session_id]
                logger.info(f"⏰ Expired LLM config for session {session_id}")
        return None

    def clear_config(self, session_id: UUID) -> None:
        """清除特定 session 的配置"""
        if session_id in self._cache:
            del self._cache[session_id]
            logger.info(f"🗑️ Cleared LLM config for session {session_id}")

    def get_cache_stats(self) -> dict:
        """取得快取統計資訊"""
        active_configs = len(self._cache)
        return {
            "active_sessions": active_configs,
            "memory_usage_estimate_kb": active_configs * 1  # 約 1KB per config
        }

    def detect_stt_method(self, model: str) -> str:
        """根據模型名稱判斷 STT 方法"""
        model_lower = model.lower()

        if "breeze-asr" in model_lower:
            return "localhost-whisper"
        elif "whisper" in model_lower:
            return "whisper"
        elif "gpt-4o" in model_lower or "gpt4o" in model_lower:
            return "gpt4o-audio"
        elif "gemini" in model_lower:
            return "gemini"
        else:
            # 預設使用 whisper API（大部分 OpenAI 相容服務都支援）
            logger.info(f"Unknown model {model}, defaulting to whisper API")
            return "whisper"

    def detect_provider_type(self, base_url: str) -> str:
        """根據 base_url 判斷 provider 類型"""
        base_url_lower = base_url.lower()

        if "openai.azure.com" in base_url_lower:
            return "azure"
        elif "api.openai.com" in base_url_lower:
            return "openai"
        elif "localhost" in base_url_lower or "127.0.0.1" in base_url_lower:
            return "local"
        else:
            return "openai_compatible"

    async def create_client(
        self,
        session_id: UUID
    ) -> Optional[Union[AsyncOpenAI, AsyncAzureOpenAI]]:
        """為 session 建立 LLM 客戶端"""

        # 1. 嘗試從快取取得配置
        config = self.get_config(session_id)

        if config:
            logger.info(f"🔧 Creating LLM client for session {session_id} with model {config.model}")

            # 判斷 provider 類型
            provider_type = self.detect_provider_type(config.base_url)

            if provider_type == "azure":
                return AsyncAzureOpenAI(
                    api_key=config.api_key,
                    azure_endpoint=config.base_url,
                    api_version=config.api_version or "2024-06-01",
                    timeout=(5, 55),
                    max_retries=2
                )
            else:
                # OpenAI 標準或相容 API
                return AsyncOpenAI(
                    api_key=config.api_key,
                    base_url=config.base_url,
                    timeout=(5, 55),
                    max_retries=2
                )

        # 2. Fallback 到環境變數（保持向後相容）
        logger.info(f"📦 No session config found for {session_id}, falling back to environment variables")

        if settings.AZURE_OPENAI_API_KEY and settings.AZURE_OPENAI_ENDPOINT:
            logger.info("Using Azure OpenAI from environment variables")
            return AsyncAzureOpenAI(
                api_key=settings.AZURE_OPENAI_API_KEY,
                azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
                api_version="2024-06-01",
                timeout=(5, 55),
                max_retries=2
            )

        logger.warning(f"❌ No LLM configuration available for session {session_id}")
        return None

    def get_model_for_session(self, session_id: UUID) -> str:
        """取得 session 使用的模型名稱"""
        config = self.get_config(session_id)
        if config:
            return config.model

        # Fallback 到環境變數
        stt_method = settings.STT_PROVIDER_DEFAULT
        if stt_method == "whisper":
            return settings.WHISPER_DEPLOYMENT_NAME or "whisper-1"
        elif stt_method == "gpt4o":
            return settings.GPT4O_DEPLOYMENT_NAME or "gpt-4o"

        return "whisper-1"  # 預設

    def mask_api_key(self, api_key: str) -> str:
        """遮罩 API key 用於日誌顯示"""
        if not api_key or len(api_key) < 8:
            return "••••••••"

        # 顯示前 3 碼和後 3 碼
        return f"{api_key[:3]}{'•' * (len(api_key) - 6)}{api_key[-3:]}"


# 全域實例
llm_manager = LLMConfigManager()

