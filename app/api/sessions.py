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
from app.db.models import Session, SessionType, SessionStatus
from app.schemas.session import (
    SessionCreateRequest, SessionOut, SessionUpgradeRequest,
    SessionFinishRequest, SessionStatusResponse
)
from app.middleware.session_guard import SessionGuard
from app.services.azure_openai import get_transcription_service

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
    """
    try:
        SessionGuard.check_no_active_session(supabase)

        session_data = {
            "title": request.title,
            "type": request.type.value,
            "language": request.language.value,
            "status": SessionStatus.ACTIVE.value
        }

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
    request: SessionFinishRequest,
    supabase: Client = Depends(get_supabase_client)
) -> SessionStatusResponse:
    """
    完成會話 (B-002)

    - 將活躍會話標記為完成
    - 設定完成時間
    - 釋放會話鎖定，允許建立新會話
    """
    try:
        # 檢查會話是否可以完成
        session_data = SessionGuard.ensure_session_can_finish(supabase, session_id)

        # 準備更新數據
        update_data = {
            "status": SessionStatus.COMPLETED.value,
            "completed_at": datetime.utcnow().isoformat()
        }

        # 注意：當前資料庫 schema 中沒有 duration 欄位
        # 如果需要記錄錄音時長，可以考慮添加到 audio_files 表中

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


@router.patch("/session/{session_id}/upgrade", response_model=SessionOut)
async def upgrade_session_to_recording(
    session_id: UUID,
    request: SessionUpgradeRequest,
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    升級會話至錄音模式 (B-015)

    - 將純筆記會話升級為錄音模式
    - 只有 draft 狀態的 note_only 會話可以升級
    - 升級後狀態變為 recording
    """
    try:
        # 檢查會話是否可以升級
        session_data = SessionGuard.ensure_session_can_upgrade(supabase, session_id)

        # 準備更新數據
        update_data = {
            "type": SessionType.RECORDING.value,
        }

        # 更新語言設定（如果提供）
        if request.language is not None:
            update_data["language"] = request.language.value

        # 執行升級
        response = supabase.table("sessions").update(update_data).eq("id", str(session_id)).execute()

        if not response.data:
            raise HTTPException(status_code=500, detail="無法升級會話")

        updated_session = response.data[0]

        return SessionOut.model_validate(updated_session)

    except HTTPException:
        # 重新拋出已處理的 HTTP 異常
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"升級會話時發生錯誤: {str(e)}"}
        )


@router.get("/session/active", response_model=SessionOut)
async def get_active_session(
    supabase: Client = Depends(get_supabase_client)
) -> SessionOut:
    """
    取得目前活躍的會話

    - 用於前端檢查是否有進行中的會話
    - 如果沒有活躍會話則返回 404
    """
    active_session_data = SessionGuard.get_active_session(supabase)

    if not active_session_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "no_active_session", "message": "目前沒有活躍的會話"}
        )

    return SessionOut.model_validate(active_session_data)


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


@router.get("/transcription/performance")
async def get_transcription_performance() -> Dict[str, Any]:
    """
    獲取轉錄系統效能報告

    - 顯示平均處理時間、最大/最小延遲
    - 評估是否達到 ≤5秒 的延遲目標
    - 提供效能等級評估
    """
    try:
        transcription_service = await get_transcription_service()

        if not transcription_service:
            return {
                "status": "disabled",
                "message": "Transcription service is not available",
                "timestamp": datetime.utcnow().isoformat()
            }

        performance_report = transcription_service.get_performance_report()

        # 計算效能評級
        avg_time = performance_report.get('average_processing_time', 0)
        if avg_time == 0:
            performance_grade = "N/A"
            latency_target_met = None
        elif avg_time <= 3:
            performance_grade = "🟢 Excellent"
            latency_target_met = True
        elif avg_time <= 5:
            performance_grade = "🟡 Good"
            latency_target_met = True
        elif avg_time <= 8:
            performance_grade = "🟠 Fair"
            latency_target_met = False
        else:
            performance_grade = "🔴 Poor"
            latency_target_met = False

        return {
            "status": "active",
            "performance_grade": performance_grade,
            "latency_target_met": latency_target_met,
            "target_latency_seconds": 5,
            **performance_report,
            "timestamp": datetime.utcnow().isoformat()
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "performance_error", "message": f"無法獲取效能報告: {str(e)}"}
        )
