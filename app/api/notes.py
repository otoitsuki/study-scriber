"""
StudyScriber Notes 管理 API 端點

實作筆記儲存、自動儲存與 UPSERT 邏輯
"""

from datetime import datetime
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.db.database import get_async_session
from app.db.models import Session, Note, SessionStatus
from app.schemas.note import (
    NoteSaveRequest, NoteOut, NoteSaveResponse, NoteConflictError
)
from app.middleware.session_guard import SessionGuard

# 建立路由器
router = APIRouter(prefix="/api", tags=["筆記管理"])


@router.put("/notes/{session_id}", response_model=NoteSaveResponse)
async def save_note(
    session_id: UUID,
    request: NoteSaveRequest,
    db: AsyncSession = Depends(get_async_session)
) -> NoteSaveResponse:
    """
    儲存筆記內容 (B-003)

    - 實作 UPSERT 邏輯：有則更新，無則建立
    - 時間戳管理：檢查客戶端時間戳避免覆蓋較新內容
    - 權限檢查：確保會話存在且可編輯
    - 自動更新會話的 updated_at 時間戳
    """
    try:
        # 檢查會話是否存在且可編輯
        session = await _ensure_session_editable(db, session_id)

        # 檢查是否已存在筆記
        existing_note = await _get_existing_note(db, session_id)

        if existing_note:
            # 更新現有筆記
            updated_note = await _update_note(db, existing_note, request)
        else:
            # 建立新筆記
            updated_note = await _create_note(db, session_id, request)

        # 更新會話時間戳
        await _update_session_timestamp(db, session)

        # 提交異動
        await db.commit()
        await db.refresh(updated_note)

        return NoteSaveResponse(
            success=True,
            message="筆記已成功儲存",
            server_ts=updated_note.updated_at,
            note=NoteOut.model_validate(updated_note)
        )

    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"儲存筆記時發生錯誤: {str(e)}"}
        )


@router.get("/notes/{session_id}", response_model=NoteOut)
async def get_note(
    session_id: UUID,
    db: AsyncSession = Depends(get_async_session)
) -> NoteOut:
    """
    取得筆記內容

    - 用於前端載入現有筆記
    - 如果筆記不存在則返回空白筆記
    """
    try:
        # 檢查會話是否存在
        await _ensure_session_exists(db, session_id)

        # 查詢筆記
        note = await _get_existing_note(db, session_id)

        if not note:
            # 如果筆記不存在，返回空白筆記
            note = Note(
                session_id=session_id,
                content="",
                updated_at=datetime.utcnow(),
                client_ts=None
            )

        return NoteOut.model_validate(note)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"取得筆記時發生錯誤: {str(e)}"}
        )


# 私有輔助函式

async def _ensure_session_exists(db: AsyncSession, session_id: UUID) -> Session:
    """確保會話存在"""
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "session_not_found", "message": "指定的會話不存在"}
        )
    return session


async def _ensure_session_editable(db: AsyncSession, session_id: UUID) -> Session:
    """確保會話存在且可編輯"""
    session = await _ensure_session_exists(db, session_id)

    # 檢查會話狀態是否允許編輯
    if session.status in [SessionStatus.ERROR]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "session_not_editable",
                "message": f"會話狀態為 {session.status.value}，無法編輯筆記"
            }
        )

    return session


async def _get_existing_note(db: AsyncSession, session_id: UUID) -> Note | None:
    """取得現有筆記"""
    result = await db.execute(
        select(Note).where(Note.session_id == session_id)
    )
    return result.scalar_one_or_none()


async def _update_note(db: AsyncSession, note: Note, request: NoteSaveRequest) -> Note:
    """更新現有筆記"""
    # 檢查時間戳衝突（如果提供客戶端時間戳）
    if request.client_ts and note.updated_at > request.client_ts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=NoteConflictError(
                message="客戶端筆記版本較舊，請重新載入最新版本",
                server_note=NoteOut.model_validate(note),
                client_ts=request.client_ts,
                server_ts=note.updated_at
            ).model_dump()
        )

    # 更新筆記內容
    note.content = request.content
    note.client_ts = request.client_ts
    # updated_at 會由 SQLAlchemy 的 onupdate 自動更新

    return note


async def _create_note(db: AsyncSession, session_id: UUID, request: NoteSaveRequest) -> Note:
    """建立新筆記"""
    new_note = Note(
        session_id=session_id,
        content=request.content,
        client_ts=request.client_ts
    )

    db.add(new_note)
    await db.flush()  # 確保獲得 updated_at

    return new_note


async def _update_session_timestamp(db: AsyncSession, session: Session) -> None:
    """更新會話時間戳"""
    # updated_at 會由 SQLAlchemy 觸發器自動更新
    session.updated_at = datetime.utcnow()  # 觸發更新
