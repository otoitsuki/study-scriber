"""
StudyScriber Session Guard 中介軟體

實作單一 active session 保護機制
"""

from typing import Optional
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import Session, SessionStatus
from app.schemas.session import ActiveSessionError


class SessionGuard:
    """會話守護者 - 保證單一活躍會話"""

    @staticmethod
    async def get_active_session(db: AsyncSession) -> Optional[Session]:
        """取得目前活躍的會話"""
        result = await db.execute(
            select(Session).where(Session.active == True)
        )
        return result.scalars().first()

    @staticmethod
    async def check_no_active_session(db: AsyncSession) -> None:
        """檢查是否無活躍會話，有則拋出異常"""
        active_session = await SessionGuard.get_active_session(db)
        if active_session:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "active_session_exists",
                    "message": f"已存在活躍會話 '{active_session.title or active_session.id}'，請先完成目前會話",
                    "active_session_id": str(active_session.id)
                }
            )

    @staticmethod
    async def ensure_session_exists_and_active(db: AsyncSession, session_id: UUID) -> Session:
        """確保會話存在且為活躍狀態"""
        result = await db.execute(
            select(Session).where(Session.id == session_id)
        )
        session = result.scalars().first()

        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"error": "session_not_found", "message": "找不到指定的會話"}
            )

        if not session.active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "session_not_active",
                    "message": f"會話 '{session.title or session.id}' 並非活躍狀態",
                    "current_status": session.status
                }
            )

        return session

    @staticmethod
    async def ensure_session_can_upgrade(db: AsyncSession, session_id: UUID) -> Session:
        """確保會話可以升級為錄音模式"""
        session = await SessionGuard.ensure_session_exists_and_active(db, session_id)

        # 檢查會話類型
        if session.type.value != "note_only":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "session_cannot_upgrade",
                    "message": f"會話類型 '{session.type.value}' 無法升級為錄音模式"
                }
            )

        # 檢查會話狀態（只有 draft 狀態可以升級）
        if session.status != SessionStatus.DRAFT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "session_status_invalid",
                    "message": f"會話狀態 '{session.status.value}' 無法升級，只有草稿狀態可以升級"
                }
            )

        return session

    @staticmethod
    async def ensure_session_can_finish(db: AsyncSession, session_id: UUID) -> Session:
        """確保會話可以被完成"""
        session = await SessionGuard.ensure_session_exists_and_active(db, session_id)

        # 檢查會話狀態（錯誤狀態的會話不能正常完成）
        if session.status == SessionStatus.ERROR:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "session_in_error_state",
                    "message": f"會話處於錯誤狀態: {session.error_reason}，無法正常完成"
                }
            )

        # 檢查是否已經完成
        if session.status == SessionStatus.COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "session_already_completed",
                    "message": "會話已經完成"
                }
            )

        return session
