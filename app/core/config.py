from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
import os

# 根據執行環境決定要讀取的 .env 檔案。
# 如果偵測到 TESTING 環境變數為真 (由 pytest/conftest 設定)，
# 則讀取 `.env.local`；預設情況 (正式環境) 則讀取 `.env`。

_ENV_FILE: str = ".env.local" if os.getenv("TESTING", "").lower() in {"1", "true", "yes"} else ".env"

class Settings(BaseSettings):
    LOG_LEVEL: str = "INFO"
    CORS_ORIGINS: str = "http://localhost:3000"
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    DB_MODE: str = "supabase"
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_API_VERSION: str = "2024-02-01"
    WHISPER_DEPLOYMENT_NAME: str = ""
    R2_ACCOUNT_ID: str = ""
    R2_BUCKET_NAME: str = "studyscriber"
    R2_API_TOKEN: str = ""
    WHISPER_BATCH_SIZE: int = Field(2, alias="whisper_batch_size")
    WHISPER_BATCH_TIMEOUT: int = Field(3, alias="whisper_batch_timeout")
    ENABLE_PERFORMANCE_LOGGING: bool = Field(True, alias="enable_performance_logging")
    DEBUG: bool = Field(False, alias="debug")

    # 音頻切片配置
    AUDIO_CHUNK_DURATION_SEC: int = Field(10, description="音頻切片時長（秒）")

    # 你可以依需求再加更多欄位

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

settings = Settings()
