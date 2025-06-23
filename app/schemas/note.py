"""
StudyScriber Note Pydantic 模型

定義筆記相關的請求和響應模型
"""

from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict, field_validator


class NoteSaveRequest(BaseModel):
    """儲存筆記請求"""
    content: str = Field(description="筆記內容（Markdown 格式）")
    client_ts: Optional[datetime] = Field(None, description="客戶端時間戳")

    @field_validator('content')
    @classmethod
    def validate_content_length(cls, v: str) -> str:
        """驗證筆記內容長度（限制 1MB）"""
        if len(v.encode('utf-8')) > 1024 * 1024:  # 1MB limit
            raise ValueError('筆記內容超過 1MB 限制')
        return v


class NoteOut(BaseModel):
    """筆記輸出模型"""
    model_config = ConfigDict(from_attributes=True)

    session_id: UUID = Field(description="會話 ID")
    content: str = Field(description="筆記內容")
    updated_at: datetime = Field(description="伺服器更新時間")
    client_ts: Optional[datetime] = Field(None, description="客戶端時間戳")


class NoteSaveResponse(BaseModel):
    """筆記儲存響應"""
    success: bool = Field(description="儲存是否成功")
    message: str = Field(description="回應訊息")
    server_ts: datetime = Field(description="伺服器時間戳")
    note: Optional[NoteOut] = Field(None, description="更新後的筆記資料")


class NoteConflictError(BaseModel):
    """筆記衝突錯誤（客戶端時間戳較舊）"""
    error: str = Field("note_conflict", description="錯誤類型")
    message: str = Field(description="錯誤訊息")
    server_note: NoteOut = Field(description="伺服器端較新的筆記資料")
    client_ts: Optional[datetime] = Field(None, description="客戶端時間戳")
    server_ts: datetime = Field(description="伺服器時間戳")
