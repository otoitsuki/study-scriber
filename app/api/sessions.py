"""
StudyScriber Session 管理 API 端點

實作會話建立、完成和升級功能
"""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db.database import get_async_session
from app.db.models import Session, SessionType, SessionStatus, Note
from app.schemas.session import (
    SessionCreateRequest, SessionOut, SessionUpgradeRequest,
    SessionFinishRequest, SessionStatusResponse
)
from app.middleware.session_guard import SessionGuard

# 建立路由器
router = APIRouter(prefix="/api", tags=["會話管理"])


@router.post("/session", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    request: SessionCreateRequest,
    db: AsyncSession = Depends(get_async_session)
) -> SessionOut:
    """
    建立新會話 (B-001)

    - 支援兩種模式：純筆記 (note_only) 或錄音模式 (recording)
    - 確保同時只有一個活躍會話
    - 自動建立對應的空白筆記記錄
    """
    try:
        # 檢查是否已有活躍會話
        await SessionGuard.check_no_active_session(db)

        # 建立新會話
        new_session = Session(
            title=request.title,
            type=request.type,
            language=request.language,
            active=True,  # 新建立的會話自動設為活躍
            status=SessionStatus.DRAFT if request.type == SessionType.NOTE_ONLY else SessionStatus.RECORDING
        )

        db.add(new_session)
        await db.flush()  # 取得 session_id

        # 建立對應的空白筆記
        new_note = Note(
            session_id=new_session.id,
            content=""  # 空白筆記內容
        )
        db.add(new_note)

        await db.commit()
        await db.refresh(new_session)

        return SessionOut.model_validate(new_session)

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常（如 SessionGuard 的 429 錯誤）
        await db.rollback()
        raise
    except IntegrityError as e:
        await db.rollback()
        # 如果是唯一約束錯誤（活躍會話衝突）
        if "uq_one_active" in str(e):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "active_session_conflict",
                    "message": "系統檢測到並發衝突，請重新嘗試建立會話"
                }
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "database_error", "message": "資料庫操作失敗"}
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"建立會話時發生錯誤: {str(e)}"}
        )


@router.patch("/session/{session_id}/finish", response_model=SessionStatusResponse)
async def finish_session(
    session_id: UUID,
    request: SessionFinishRequest,
    db: AsyncSession = Depends(get_async_session)
) -> SessionStatusResponse:
    """
    完成會話 (B-002)

    - 將活躍會話標記為完成
    - 設定最終錄音時長（如適用）
    - 釋放會話鎖定，允許建立新會話
    """
    try:
        # 檢查會話是否可以完成
        session = await SessionGuard.ensure_session_can_finish(db, session_id)

        # 更新會話狀態
        session.active = False
        session.status = SessionStatus.COMPLETED

        # 設定錄音時長（如果提供）
        if request.duration is not None:
            session.duration = request.duration

        await db.commit()
        await db.refresh(session)

        return SessionStatusResponse(
            success=True,
            message=f"會話 '{session.title or session.id}' 已成功完成",
            session=SessionOut.model_validate(session)
        )

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"完成會話時發生錯誤: {str(e)}"}
        )


@router.patch("/session/{session_id}/upgrade", response_model=SessionOut)
async def upgrade_session_to_recording(
    session_id: UUID,
    request: SessionUpgradeRequest,
    db: AsyncSession = Depends(get_async_session)
) -> SessionOut:
    """
    升級會話至錄音模式 (B-015)

    - 將純筆記會話升級為錄音模式
    - 只有 draft 狀態的 note_only 會話可以升級
    - 升級後狀態變為 recording
    """
    try:
        # 檢查會話是否可以升級
        session = await SessionGuard.ensure_session_can_upgrade(db, session_id)

        # 執行升級
        session.type = SessionType.RECORDING
        session.status = SessionStatus.RECORDING

        # 更新語言設定（如果提供）
        if request.language is not None:
            session.language = request.language

        await db.commit()
        await db.refresh(session)

        return SessionOut.model_validate(session)

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"升級會話時發生錯誤: {str(e)}"}
        )


@router.get("/session/active", response_model=SessionOut)
async def get_active_session(
    db: AsyncSession = Depends(get_async_session)
) -> SessionOut:
    """
    取得目前活躍的會話

    - 用於前端檢查是否有進行中的會話
    - 如果沒有活躍會話則返回 404
    """
    active_session = await SessionGuard.get_active_session(db)

    if not active_session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "no_active_session", "message": "目前沒有活躍的會話"}
        )

    return SessionOut.model_validate(active_session)


@router.get("/session/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_session)
) -> SessionOut:
    """
    取得指定會話的詳細資訊

    - 用於檢視會話狀態和資訊
    """
    result = await db.execute(
        select(Session).where(Session.id == session_id)
    )
    session = result.scalars().first()

    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "session_not_found", "message": "找不到指定的會話"}
        )

    return SessionOut.model_validate(session)
