"""
Session Guard 中介軟體

保護 API 端點，確保會話操作的有效性和一致性
"""

from uuid import UUID
from fastapi import HTTPException, status
from supabase import Client
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request, Response

from app.db.models import Session as DB_Session, SessionStatus, SessionType
from app.schemas.session import SessionOut
from app.db.supabase_config import get_supabase_client


class SessionGuard:
    """會話守護者 - 保證單一活躍會話"""

    @staticmethod
    def get_session_by_id(supabase: Client, session_id: UUID) -> dict | None:
        """通過 ID 取得會話（返回字典格式）"""
        response = supabase.table("sessions").select("*").eq("id", str(session_id)).limit(1).execute()
        if response.data:
            return response.data[0]
        return None

    @staticmethod
    def get_active_session(supabase: Client) -> dict | None:
        """取得當前活躍的會話（返回字典格式）"""
        response = supabase.table("sessions").select("*").eq("status", SessionStatus.ACTIVE.value).limit(1).execute()
        if response.data:
            return response.data[0]
        return None

    @staticmethod
    def check_no_active_session(supabase: Client):
        """確保沒有活躍的會話，否則拋出異常"""
        if SessionGuard.get_active_session(supabase):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "active_session_exists", "message": "已有活躍會話，無法建立新會話"}
            )

    @staticmethod
    def ensure_session_exists_and_active(supabase: Client, session_id: UUID) -> dict:
        """確保會話存在且為活躍狀態（返回字典格式）"""
        session = SessionGuard.get_session_by_id(supabase, session_id)
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定的會話")
        if session.get("status") != SessionStatus.ACTIVE.value:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="會話並非活躍狀態")
        return session

    @staticmethod
    def ensure_session_can_upgrade(supabase: Client, session_id: UUID) -> dict:
        """確保會話可以升級為錄音模式（返回字典格式）"""
        session = SessionGuard.ensure_session_exists_and_active(supabase, session_id)
        if session.get("type") != SessionType.NOTE_ONLY.value:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="只有純筆記會話才能升級")
        return session

    @staticmethod
    def ensure_session_can_finish(supabase: Client, session_id: UUID) -> dict:
        """確保會話可以被完成（返回字典格式）"""
        return SessionGuard.ensure_session_exists_and_active(supabase, session_id)


class SingleActiveSessionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        supabase = get_supabase_client()
        # 只檢查非 GET 請求，避免影響查詢
        if request.method != "GET":
            active_session = SessionGuard.get_active_session(supabase)
            if active_session:
                return Response(
                    content="已有活躍會話，請先完成或結束現有會話。",
                    status_code=429
                )
        return await call_next(request)
