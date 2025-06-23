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


class SessionOut(BaseModel):
    """會話輸出模型"""
    model_config = ConfigDict(from_attributes=True)

    id: UUID = Field(description="會話唯一識別碼")
    title: Optional[str] = Field(description="會話標題")
    type: SessionType = Field(description="會話類型")
    status: SessionStatus = Field(description="會話狀態")
    active: bool = Field(description="是否為活躍會話")
    duration: Optional[int] = Field(None, description="錄音時長（秒）")
    language: LanguageCode = Field(description="語言設定")
    error_reason: Optional[str] = Field(None, description="錯誤原因")
    created_at: datetime = Field(description="建立時間")
    updated_at: datetime = Field(description="更新時間")


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
