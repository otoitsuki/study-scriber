"""
StudyScriber Session 管理 API 端點

使用 Supabase Client 實作會話建立、完成和升級功能
"""

from uuid import UUID
from typing import Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client

from app.db.database import get_supabase_client
from app.schemas.session import (
    SessionCreateRequest, SessionOut, SessionUpgradeRequest,
    SessionFinishRequest, SessionStatusResponse, SessionStatus, SessionType, LanguageCode
)

# 建立路由器
router = APIRouter(prefix="/api", tags=["會話管理"])


@router.post("/session", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    request: SessionCreateRequest,
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    建立新會話 (B-001)

    - 支援兩種模式：純筆記 (note_only) 或錄音模式 (recording)
    - 確保同時只有一個活躍會話
    - 自動建立對應的空白筆記記錄
    - 支援精確的錄音開始時間戳
    """
    try:
        # 檢查是否有其他活躍會話
        active_session_response = supabase.table("sessions").select("id").eq("status", "active").limit(1).execute()
        if active_session_response.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="已有一個活躍的會話，無法建立新會話。"
            )

        session_data = {
            "title": request.title,
            "type": request.type.value,
            "language": request.language.value,
            "status": SessionStatus.ACTIVE.value
        }

        # 如果有提供 start_ts，轉換為 PostgreSQL 時間戳格式
        if request.start_ts is not None:
            started_at = datetime.fromtimestamp(request.start_ts / 1000).isoformat()
            session_data["started_at"] = started_at
            print(f"🕐 [SessionAPI] 設定錄音開始時間: {started_at} (原始時間戳: {request.start_ts})")

        # 若為錄音模式且仍未設定 started_at，則預設為目前時間 (UTC)
        if request.type == SessionType.RECORDING and "started_at" not in session_data:
            session_data["started_at"] = datetime.utcnow().isoformat()

        response = supabase.table("sessions").insert(session_data, returning="representation").execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="無法建立會話")

        new_session = response.data[0]
        session_id = new_session['id']

        note_data = {"session_id": session_id, "content": request.content or ""}
        supabase.table("notes").insert(note_data).execute()

        return SessionOut.model_validate(new_session)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": "internal_error", "message": f"建立會話時發生錯誤: {str(e)}"}
        )


@router.patch("/session/{session_id}/finish", response_model=SessionStatusResponse)
async def finish_session(
    session_id: UUID,
    supabase: Client = Depends(get_supabase_client)
) -> SessionStatusResponse:
    """
    完成會話 (B-002)

    - 將活躍會話標記為完成
    - 設定完成時間
    - 釋放會話鎖定，允許建立新會話
    """
    try:
        # 檢查會話是否存在且活躍
        session_response = supabase.table("sessions").select("*").eq("id", str(session_id)).eq("status", "active").limit(1).execute()
        if not session_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到活躍的會話或會話已被完成。"
            )

        # 準備更新數據
        update_data = {
            "status": SessionStatus.COMPLETED.value,
            "completed_at": datetime.utcnow().isoformat()
        }

        # 更新會話狀態
        response = supabase.table("sessions").update(update_data).eq("id", str(session_id)).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="無法更新會話狀態")

        updated_session = response.data[0]

        return SessionStatusResponse(
            success=True,
            message=f"會話 '{updated_session.get('title') or session_id}' 已成功完成",
            session=SessionOut.model_validate(updated_session)
        )

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"完成會話時發生錯誤: {str(e)}"}
        )


@router.delete("/session/{session_id}", response_model=SessionStatusResponse)
async def delete_session(
    session_id: UUID,
    supabase: Client = Depends(get_supabase_client)
) -> SessionStatusResponse:
    """
    刪除會話及其所有相關數據 (B-020)

    - 刪除指定的會話及其所有關聯數據（筆記、音檔、逐字稿等）
    - 由於資料庫有 CASCADE DELETE 約束，會自動清理所有相關表格的數據
    - 此操作不可逆，請謹慎使用
    """
    try:
        # 檢查會話是否存在
        session_response = supabase.table("sessions").select("*").eq("id", str(session_id)).limit(1).execute()
        if not session_response.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="找不到指定的會話。"
            )

        session_data = session_response.data[0]
        session_title = session_data.get('title', '未命名筆記')

        # 刪除會話（會自動級聯刪除所有相關數據）
        delete_response = supabase.table("sessions").delete().eq("id", str(session_id)).execute()

        if not delete_response.data:
            raise HTTPException(status_code=500, detail="無法刪除會話")

        return SessionStatusResponse(
            success=True,
            message=f"會話 '{session_title}' ({session_id}) 及其所有相關數據已成功刪除",
            session=None
        )

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"刪除會話時發生錯誤: {str(e)}"}
        )


@router.patch("/session/{session_id}/upgrade", response_model=SessionOut)
async def upgrade_session_to_recording(
    session_id: UUID,
    request: SessionUpgradeRequest,
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    升級會話至錄音模式 (B-015)

    - 將純筆記會話升級為錄音模式
    - 只有 active 狀態的 note_only 會話可以升級
    """
    try:
        # 檢查會話是否可以升級
        session_response = supabase.table("sessions").select("*").eq("id", str(session_id)).eq("status", "active").eq("type", "note_only").limit(1).execute()
        if not session_response.data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="只有活躍的純筆記會話才能升級。"
            )

        # 準備更新數據
        update_data = {
            "type": SessionType.RECORDING.value,
            "language": request.language.value,
            "started_at": datetime.utcnow().isoformat(),
        }

        # 執行升級
        response = supabase.table("sessions").update(update_data).eq("id", str(session_id)).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="無法升級會話")

        updated_session = response.data[0]

        return SessionOut.model_validate(updated_session)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"升級會話時發生錯誤: {str(e)}"}
        )


@router.get("/session/active", response_model=SessionOut, status_code=status.HTTP_200_OK)
async def get_active_session(
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    取得目前活躍的會話

    - 用於前端檢查是否有進行中的會話
    - 如果沒有活躍會話則返回 404
    """
    response = supabase.table("sessions").select("*").eq("status", "active").limit(1).execute()
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "no_active_session", "message": "目前沒有活躍的會話"}
        )

    return SessionOut.model_validate(response.data[0])


@router.get("/session/{session_id}", response_model=SessionOut)
async def get_session(
    session_id: UUID,
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    取得指定會話的詳細資訊

    - 用於檢視會話狀態和資訊
    """
    response = supabase.table("sessions").select("*").eq("id", str(session_id)).limit(1).execute()

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "session_not_found", "message": "找不到指定的會話"}
        )

    return SessionOut.model_validate(response.data[0])
