from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, field_validator
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
    WHISPER_LANGUAGE: str = Field("zh", description="Whisper 轉錄語言代碼")
    # --- STT Provider 新增設定 ---
    STT_PROVIDER_DEFAULT: str = Field("whisper", description="預設語音轉文字 Provider ('whisper' or 'gemini')")
    GEMINI_ENDPOINT: str = Field("", description="Vertex AI 端點，如 us-central1-aiplatform.googleapis.com")
    GEMINI_API_KEY: str = Field("", description="GCP 服務帳戶 API Key")
    GEMINI_PROMPT: str = Field("請輸出逐字稿：", description="Gemini system prompt")
    GEMINI_MAX_REQUESTS: int = Field(90, description="Gemini 每分鐘最大請求次數 (RateLimiter 用)")
    R2_ACCOUNT_ID: str = ""
    R2_BUCKET_NAME: str = "studyscriber"
    R2_API_TOKEN: str = ""
    WHISPER_BATCH_SIZE: int = Field(2, alias="whisper_batch_size")
    WHISPER_BATCH_TIMEOUT: int = Field(3, alias="whisper_batch_timeout")
    ENABLE_PERFORMANCE_LOGGING: bool = Field(True, alias="enable_performance_logging")
    DEBUG: bool = Field(False, alias="debug")

    # 音頻切片配置
    AUDIO_CHUNK_DURATION_SEC: int = int(os.getenv("AUDIO_CHUNK_DURATION_SEC", 28))

    # 逐字稿顯示配置
    TRANSCRIPT_DISPLAY_INTERVAL_SEC: int = Field(10, description="逐字稿時間戳顯示間隔（秒）")

    # REST API 簡化架構配置
    SEGMENT_DURATION: int = Field(10, description="分段錄音時長（秒）")
    UPLOAD_MAX_SIZE: int = Field(5 * 1024 * 1024, description="檔案上傳大小限制（5MB）")
    AUDIO_BITRATE: int = Field(128000, description="音頻位元率（128 kbps）")
    MIME_TYPE: str = Field("audio/webm;codecs=opus", description="音頻檔案 MIME 類型")

    # 上傳設定
    UPLOAD_TIMEOUT_SEC: int = Field(30, description="上傳超時時間（秒）")
    MAX_RETRIES: int = Field(3, description="最大重試次數")
    RETRY_DELAY_SEC: int = Field(2, description="重試延遲時間（秒）")

    # 滑動視窗 Rate Limiting 配置
    USE_SLIDING_WINDOW_RATE_LIMIT: bool = Field(False, description="啟用滑動視窗頻率限制")
    SLIDING_WINDOW_MAX_REQUESTS: int = Field(3, description="滑動視窗內最大請求數")
    SLIDING_WINDOW_SECONDS: int = Field(60, description="滑動視窗時間（秒）")

    # Whisper 段落過濾門檻參數 (從環境變數讀取)
    FILTER_NO_SPEECH: float = Field(
        0.2,
        description="靜音檢測門檻：no_speech_prob 超過此值的段落將被過濾（0.0-1.0）",
        ge=0.0,
        le=1.0
    )
    FILTER_LOGPROB: float = Field(
        -1.0,
        description="置信度過濾門檻：avg_logprob 低於此值的段落將被過濾（負值）"
    )
    FILTER_COMPRESSION: float = Field(
        2.4,
        description="重複內容檢測門檻：compression_ratio 超過此值的段落將被過濾（正值）",
        gt=0.0
    )

    # 並發處理優化配置（用戶建議參數）
    MAX_CONCURRENT_TRANSCRIPTIONS: int = Field(3, description="最大並發轉錄數")
    TRANSCRIPTION_WORKERS_COUNT: int = Field(3, description="轉錄Worker數量")
    QUEUE_BACKLOG_THRESHOLD: int = Field(10, description="隊列積壓警報門檻")
    QUEUE_MONITOR_INTERVAL: int = Field(5, description="監控間隔(秒)")
    QUEUE_ALERT_COOLDOWN: int = Field(30, description="警報冷卻時間(秒)")

    # 隊列系統配置
    MAX_QUEUE_SIZE: int = Field(100, description="最大隊列大小")
    QUEUE_TIMEOUT_SECONDS: int = Field(300, description="隊列超時（秒）")

    # 你可以依需求再加更多欄位

    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

settings = Settings()

def get_settings() -> Settings:
    """獲取應用程式設定實例"""
    return settings
