"""
StudyScriber Session Pydantic 模型

定義會話相關的請求和響應模型
"""
import enum
from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

class SessionType(str, enum.Enum):
    """會話類型"""
    NOTE_ONLY = "note_only"
    RECORDING = "recording"

class SessionStatus(str, enum.Enum):
    """會話狀態"""
    ACTIVE = "active"
    COMPLETED = "completed"
    ERROR = "error"

class LanguageCode(str, enum.Enum):
    """支援的語言代碼"""
    ZH_TW = "zh-TW"
    EN_US = "en-US"


class LLMConfigInput(BaseModel):
    """前端傳入的 LLM 配置"""
    base_url: str = Field(..., description="API endpoint URL (e.g., https://api.openai.com/v1)")
    api_key: str = Field(..., description="API key (e.g., sk-...)")
    model: str = Field(..., description="Model name (e.g., whisper-1, gpt-4o, or Azure deployment name)")
    api_version: Optional[str] = Field(None, description="API version (Azure only, e.g., 2024-06-01)")

    class Config:
        json_schema_extra = {
            "example": {
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-1234567890abcdef",
                "model": "whisper-1",
                "api_version": "2024-06-01"
            }
        }


class SessionCreateRequest(BaseModel):
    """建立會話請求"""
    title: Optional[str] = Field(None, max_length=150, description="會話標題")
    type: SessionType = Field(SessionType.NOTE_ONLY, description="會話類型")
    language: LanguageCode = Field(LanguageCode.ZH_TW, description="語言設定")
    stt_provider: Optional[str] = Field(None, description="語音轉文字 Provider ('whisper' or 'gemini') - 已淡化，優先使用 llm_config")
    llm_config: Optional[LLMConfigInput] = Field(None, description="自訂 LLM 配置，將覆蓋環境變數設定")
    content: Optional[str] = Field(None, description="初始筆記內容")
    start_ts: Optional[int] = Field(None, description="錄音開始時間戳（毫秒）")


class SessionOut(BaseModel):
    """會話輸出模型"""
    id: str
    type: SessionType
    status: SessionStatus
    title: Optional[str] = None
    language: LanguageCode
    stt_provider: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SessionUpgradeRequest(BaseModel):
    """會話升級請求（純筆記 → 錄音）"""
    language: Optional[LanguageCode] = Field(None, description="錄音語言設定")


class SessionFinishRequest(BaseModel):
    """完成會話請求"""
    duration: Optional[int] = Field(None, ge=0, description="最終錄音時長（秒）")


class SessionStatusResponse(BaseModel):
    """會話狀態響應"""
    success: bool = Field(description="操作是否成功")
    message: str = Field(description="回應訊息")
    session: Optional[SessionOut] = Field(None, description="會話資料")


class ActiveSessionError(BaseModel):
    """活躍會話衝突錯誤"""
    model_config = ConfigDict(json_encoders={UUID: str})

    error: str = Field("active_session_exists", description="錯誤類型")
    message: str = Field(description="錯誤訊息")
    active_session_id: UUID = Field(description="目前活躍會話 ID")


class SessionProviderUpdateRequest(BaseModel):
    """更新會話 STT Provider 請求"""
    stt_provider: str = Field(..., description="語音轉文字 Provider ('whisper' or 'gemini')")

    class Config:
        json_schema_extra = {
            "example": {
                "stt_provider": "gemini"
            }
        }


class LLMTestCapabilities(BaseModel):
    """LLM 測試連線能力"""
    transcription: bool = Field(description="是否支援音訊轉錄")
    summary: bool = Field(description="是否支援聊天/摘要")


class LLMTestErrors(BaseModel):
    """LLM 測試連線錯誤詳情"""
    transcription: Optional[str] = Field(None, description="轉錄測試錯誤訊息")
    chat: Optional[str] = Field(None, description="聊天測試錯誤訊息")


class LLMTestResponse(BaseModel):
    """LLM 連線測試響應"""
    success: bool = Field(description="整體測試是否成功")
    detected_provider: str = Field(description="偵測到的 provider 類型 (azure, openai, openai_compatible)")
    detected_stt_method: str = Field(description="偵測到的 STT 方法 (whisper, gpt4o-audio, gemini)")
    capabilities: LLMTestCapabilities = Field(description="功能支援情況")
    errors: Optional[LLMTestErrors] = Field(None, description="錯誤詳情（若有）")
    error: Optional[str] = Field(None, description="一般錯誤訊息")

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "detected_provider": "openai",
                "detected_stt_method": "whisper",
                "capabilities": {
                    "transcription": True,
                    "summary": True
                },
                "errors": None,
                "error": None
            }
        }
