"""
MLX Whisper API 配置管理模組

使用 pydantic-settings 管理環境變數配置，
提供類型驗證和預設值設定。
"""

import os
import time
from functools import lru_cache
from typing import List, Optional, Dict

from pydantic import Field, field_validator, ConfigDict
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """MLX Whisper API 配置設定"""

    # ===============================
    # 服務配置
    # ===============================
    workers: int = Field(default=4, description="Uvicorn worker 數量", ge=1, le=16)

    port: int = Field(default=8000, description="服務埠號", ge=1024, le=65535)

    host: str = Field(default="0.0.0.0", description="監聽位址")

    # ===============================
    # 效能配置
    # ===============================
    max_requests_per_minute: int = Field(
        default=10, description="每分鐘最大請求數", ge=1, le=1000
    )

    max_concurrent_per_worker: int = Field(
        default=1, description="每個 worker 的最大併發數", ge=1, le=4
    )

    # ===============================
    # 模型配置
    # ===============================
    model_cache_dir: str = Field(default="./models", description="模型快取目錄路徑")

    default_model: str = Field(default="whisper-large-v3", description="預設使用的模型")

    # ===============================
    # 模型別名配置
    # ===============================
    model_aliases: str = Field(
        default="",
        description="模型別名對應。格式: 'source_name:target_name,source2:target2'",
    )

    # ===============================
    # 限制配置
    # ===============================
    max_file_size: int = Field(
        default=26214400,  # 25MB
        description="最大檔案大小（bytes）",
        ge=1024,  # 至少 1KB
        le=104857600,  # 最大 100MB
    )

    request_timeout: int = Field(
        default=600, description="請求逾時時間（秒）", ge=30, le=3600  # 10 minutes
    )

    # ===============================
    # 日誌配置
    # ===============================
    log_level: str = Field(default="INFO", description="日誌等級")

    # ===============================
    # 監控配置
    # ===============================
    enable_metrics: bool = Field(default=True, description="是否啟用 Prometheus 指標")

    metrics_port: int = Field(
        default=9090, description="Prometheus 指標埠號", ge=1024, le=65535
    )

    # ===============================
    # 開發模式配置
    # ===============================
    reload: bool = Field(default=False, description="是否啟用熱重載（僅開發環境）")

    debug: bool = Field(default=False, description="是否啟用調試模式")

    # ===============================
    # 安全配置
    # ===============================
    allowed_hosts: str = Field(
        default="localhost,127.0.0.1,0.0.0.0",
        description="允許的主機列表，用逗號分隔",
        env="WHISPER_API_ALLOWED_HOSTS",
    )

    model_config = ConfigDict(
        # 環境變數前綴
        env_prefix="WHISPER_API_",
        # 從 .env 檔案載入
        env_file=".env",
        # 環境變數優先於 .env 檔案
        env_file_encoding="utf-8",
        # 允許任意類型
        arbitrary_types_allowed=True,
        # 驗證賦值
        validate_assignment=True,
    )

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v: str) -> str:
        """驗證日誌等級"""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        v_upper = v.upper()
        if v_upper not in valid_levels:
            raise ValueError(f"日誌等級必須是 {valid_levels} 之一")
        return v_upper

    @field_validator("default_model")
    @classmethod
    def validate_default_model(cls, v: str) -> str:
        """驗證預設模型名稱"""
        valid_models = [
            "whisper-tiny",
            "whisper-base",
            "whisper-small",
            "whisper-medium",
            "whisper-large-v3",
            "breeze-asr-25",
        ]
        if v not in valid_models:
            raise ValueError(f"模型名稱必須是 {valid_models} 之一")
        return v

    @field_validator("model_cache_dir")
    @classmethod
    def validate_model_cache_dir(cls, v: str) -> str:
        """驗證並建立模型快取目錄"""
        # 確保目錄存在
        os.makedirs(v, exist_ok=True)
        return os.path.abspath(v)

    @field_validator("max_file_size")
    @classmethod
    def validate_max_file_size(cls, v: int) -> int:
        """驗證最大檔案大小"""
        # 轉換為人類可讀的格式用於日誌
        mb_size = v / (1024 * 1024)
        if mb_size > 100:
            raise ValueError("最大檔案大小不能超過 100MB")
        return v

    @field_validator("model_aliases")
    @classmethod
    def parse_model_aliases(cls, v: str) -> Dict[str, str]:
        """解析模型別名環境變數"""
        if not v or v.strip() == "" or v.strip().lower() == "none":
            return {}
        aliases = {}
        try:
            # 支援用逗號分隔多個別名
            for pair in v.split(","):
                if ":" not in pair:
                    # 跳過無效格式，不拋出異常
                    continue
                source, target = pair.split(":", 1)
                aliases[source.strip()] = target.strip()
            return aliases
        except Exception:
            # 發生任何錯誤都返回空字典
            return {}

    @field_validator("allowed_hosts")
    @classmethod
    def parse_allowed_hosts(cls, v: str) -> List[str]:
        """解析允許的主機列表"""
        if not v or v.strip() == "":
            return ["localhost", "127.0.0.1"]
        hosts = [host.strip() for host in v.split(",") if host.strip()]
        return hosts if hosts else ["localhost", "127.0.0.1"]

    def get_supported_models(self) -> List[str]:
        """取得支援的模型列表"""
        return [
            "whisper-tiny",
            "whisper-base",
            "whisper-small",
            "whisper-medium",
            "whisper-large-v3",
            "breeze-asr-25",
        ]

    def get_model_aliases(self) -> Dict[str, str]:
        """取得解析後的模型別名字典"""
        if isinstance(self.model_aliases, dict):
            return self.model_aliases
        elif isinstance(self.model_aliases, str):
            if not self.model_aliases or self.model_aliases.strip() == "":
                return {}
            aliases = {}
            try:
                for pair in self.model_aliases.split(","):
                    if ":" not in pair:
                        continue
                    source, target = pair.split(":", 1)
                    aliases[source.strip()] = target.strip()
                return aliases
            except Exception:
                return {}
        return {}

    def get_allowed_hosts(self) -> List[str]:
        """取得允許的主機列表"""
        if isinstance(self.allowed_hosts, list):
            return self.allowed_hosts
        elif isinstance(self.allowed_hosts, str):
            if not self.allowed_hosts or self.allowed_hosts.strip() == "":
                return ["localhost", "127.0.0.1"]
            hosts = [
                host.strip() for host in self.allowed_hosts.split(",") if host.strip()
            ]
            return hosts if hosts else ["localhost", "127.0.0.1"]
        return ["localhost", "127.0.0.1"]

    def get_model_info(self, model_name: str) -> Optional[dict]:
        """取得模型資訊"""
        model_info = {
            "whisper-tiny": {"params": "39M", "memory": "~1GB", "speed": "10x"},
            "whisper-base": {"params": "74M", "memory": "~1.5GB", "speed": "7x"},
            "whisper-small": {"params": "244M", "memory": "~2.5GB", "speed": "4x"},
            "whisper-medium": {"params": "769M", "memory": "~5GB", "speed": "2x"},
            "whisper-large-v3": {"params": "1550M", "memory": "~10GB", "speed": "1x"},
            "breeze-asr-25": {
                "params": "1550M",
                "memory": "~10GB",
                "speed": "1x",
                "description": "基於 Whisper-large-v2 微調，專為繁體中文和中英混用優化，MLX 格式",
                "hf_repo": "eoleedi/Breeze-ASR-25-mlx",
            },
        }
        return model_info.get(model_name)

    def get_max_file_size_mb(self) -> float:
        """取得最大檔案大小（MB）"""
        return self.max_file_size / (1024 * 1024)

    def is_production(self) -> bool:
        """判斷是否為生產環境"""
        return not (self.debug or self.reload)


@lru_cache()
def get_settings() -> Settings:
    """
    取得配置實例（單例模式）

    使用 lru_cache 確保配置只初始化一次，
    提升效能並確保配置一致性。

    Returns:
        Settings: 配置實例
    """
    return Settings()


# 全域配置實例
settings = get_settings()


# 匯出常用的配置函數
def get_log_level() -> str:
    """取得日誌等級"""
    return settings.log_level


def get_supported_models() -> List[str]:
    """取得支援的模型列表"""
    return settings.get_supported_models()


def is_metrics_enabled() -> bool:
    """檢查是否啟用監控指標"""
    return settings.enable_metrics


def get_model_cache_dir() -> str:
    """取得模型快取目錄"""
    return settings.model_cache_dir
