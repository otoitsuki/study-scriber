"""
StudyScriber Session Pydantic 模型

定義會話相關的請求和響應模型
"""

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

from app.db.models import SessionType, SessionStatus, LanguageCode


class SessionCreateRequest(BaseModel):
    """建立會話請求"""
    title: Optional[str] = Field(None, max_length=150, description="會話標題")
    type: SessionType = Field(SessionType.NOTE_ONLY, description="會話類型")
    language: LanguageCode = Field(LanguageCode.ZH_TW, description="語言設定")
    content: Optional[str] = Field(None, description="初始筆記內容")


class SessionOut(BaseModel):
    """會話輸出模型"""
    id: UUID
    type: SessionType
    status: SessionStatus
    title: Optional[str] = None
    language: LanguageCode
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
