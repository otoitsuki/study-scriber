from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

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
    # 你可以依需求再加更多欄位

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
