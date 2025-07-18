"""
StudyScriber Notes 管理 API 端點

實作筆記儲存、自動儲存與 UPSERT 邏輯
"""

from datetime import datetime, timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from supabase import Client
import json
import io
import zipfile
import logging
from fastapi.responses import StreamingResponse

from app.db.database import get_supabase_client
from app.schemas.note import (
    NoteSaveRequest, NoteOut, NoteSaveResponse, NoteConflictError
)

# 建立路由器
router = APIRouter(prefix="/api", tags=["筆記管理"])
logger = logging.getLogger(__name__)


@router.put("/notes/{session_id}", response_model=NoteSaveResponse)
async def save_note(
    session_id: UUID,
    request: NoteSaveRequest,
    supabase: Client = Depends(get_supabase_client)
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
        session = await _ensure_session_editable(supabase, session_id)

        # 檢查是否已存在筆記
        existing_note = await _get_existing_note(supabase, session_id)

        if existing_note:
            # 更新現有筆記
            updated_note = await _update_note(supabase, existing_note, request)
        else:
            # 建立新筆記
            updated_note = await _create_note(supabase, session_id, request)

        # 更新會話時間戳
        await _update_session_timestamp(supabase, session_id)

        # 準備時間戳
        server_ts = datetime.fromisoformat(updated_note['updated_at'].replace('Z', '+00:00')) if 'Z' in updated_note['updated_at'] else datetime.fromisoformat(updated_note['updated_at'])

        return NoteSaveResponse(
            success=True,
            message="筆記已成功儲存",
            server_ts=server_ts,
            note=NoteOut.model_validate(updated_note)
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"儲存筆記時發生錯誤: {str(e)}"}
        )


@router.get("/notes/{session_id}", response_model=NoteOut)
async def get_note(
    session_id: UUID,
    supabase: Client = Depends(get_supabase_client)
) -> NoteOut:
    """
    取得筆記內容

    - 用於前端載入現有筆記
    - 如果筆記不存在則返回空白筆記
    """
    try:
        # 檢查會話是否存在
        await _ensure_session_exists(supabase, session_id)

        # 查詢筆記
        note = await _get_existing_note(supabase, session_id)

        if not note:
            # 如果筆記不存在，返回空白筆記
            note = {
                'session_id': str(session_id),
                'content': "",
                'updated_at': datetime.utcnow().isoformat(),
                'client_ts': None
            }

        return NoteOut.model_validate(note)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "internal_error", "message": f"取得筆記時發生錯誤: {str(e)}"}
        )


@router.post("/notes/export")
async def export_note(
    request: dict,
    supabase: Client = Depends(get_supabase_client)
):
    """
    匯出筆記內容與逐字稿為 ZIP 檔案
    """
    try:
        session_id = request.get("session_id")
        note_content = request.get("note_content")
        logger.info(f"開始匯出 session_id: {session_id}")

        # 從資料庫取得真實的轉錄資料
        transcripts = await _get_session_transcripts(supabase, session_id)

        # 建立 ZIP 檔案
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. 加入 Markdown 筆記
            zip_file.writestr('note.md', note_content.encode('utf-8'))

            # 2. 生成真實的 STT 格式逐字稿
            stt_content = _generate_stt_transcript(session_id, transcripts)
            zip_file.writestr('transcript.txt', stt_content.encode('utf-8'))

        zip_buffer.seek(0)

        filename = f"note_{str(session_id)[:8]}_{datetime.now().strftime('%Y%m%d')}.zip"
        logger.info(f"成功生成 ZIP 檔案: {filename}")

        return StreamingResponse(
            zip_buffer,
            media_type='application/zip',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Access-Control-Expose-Headers': 'Content-Disposition'
            }
        )

    except Exception as e:
        logger.error(f"匯出錯誤: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")


# 私有輔助函式

async def _ensure_session_exists(supabase: Client, session_id: UUID) -> dict:
    """確保會話存在"""
    response = supabase.table("sessions").select("*").eq("id", str(session_id)).limit(1).execute()

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "session_not_found", "message": "指定的會話不存在"}
        )

    return response.data[0]


async def _ensure_session_editable(supabase: Client, session_id: UUID) -> dict:
    """確保會話存在且可編輯"""
    session = await _ensure_session_exists(supabase, session_id)

    # 檢查會話狀態是否允許編輯
    if session.get('status') == 'error':
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "session_not_editable",
                "message": f"會話狀態為 {session.get('status')}，無法編輯筆記"
            }
        )

    return session


async def _get_existing_note(supabase: Client, session_id: UUID) -> dict | None:
    """取得現有筆記"""
    response = supabase.table("notes").select("id, session_id, content, client_ts, created_at, updated_at").eq("session_id", str(session_id)).limit(1).execute()

    return response.data[0] if response.data else None


async def _update_note(supabase: Client, note: dict, request: NoteSaveRequest) -> dict:
    """更新現有筆記"""
    # 檢查時間戳衝突（如果提供客戶端時間戳）
    if request.client_ts:
        note_updated_at = datetime.fromisoformat(note['updated_at'].replace('Z', '+00:00'))
        if note_updated_at > request.client_ts:
            # 準備伺服器端筆記資料
            server_note_data = {
                'session_id': str(note['session_id']),
                'content': note['content'],
                'updated_at': note_updated_at,
                'client_ts': note.get('client_ts')
            }

            # 建立錯誤物件
            conflict_error = NoteConflictError(
                message="客戶端筆記版本較舊，請重新載入最新版本",
                server_note=NoteOut.model_validate(server_note_data),
                client_ts=request.client_ts,
                server_ts=note_updated_at
            )

            # 使用 model_dump_json 確保完全序列化
            error_detail_str = conflict_error.model_dump_json()
            error_detail = json.loads(error_detail_str)

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=error_detail
            )

    # 更新筆記內容
    update_data = {
        'content': request.content,
        'client_ts': request.client_ts.isoformat() if request.client_ts else None,
        'updated_at': datetime.utcnow().isoformat()
    }

    response = supabase.table("notes").update(update_data).eq("session_id", str(note['session_id'])).execute()

    if not response.data:
        raise HTTPException(status_code=500, detail="無法更新筆記")

    return response.data[0]


async def _create_note(supabase: Client, session_id: UUID, request: NoteSaveRequest) -> dict:
    """建立新筆記"""
    current_time = datetime.utcnow().isoformat()
    note_data = {
        'session_id': str(session_id),
        'content': request.content,
        'client_ts': request.client_ts.isoformat() if request.client_ts else None,
        'updated_at': current_time
    }

    response = supabase.table("notes").insert(note_data).execute()

    if not response.data:
        raise HTTPException(status_code=500, detail="無法建立筆記")

    return response.data[0]


async def _update_session_timestamp(supabase: Client, session_id: UUID) -> None:
    """更新會話時間戳"""
    update_data = {
        'updated_at': datetime.utcnow().isoformat()
    }

    supabase.table("sessions").update(update_data).eq("id", str(session_id)).execute()


async def _get_session_transcripts(supabase: Client, session_id: str) -> list:
    """從資料庫取得會話的所有轉錄資料"""
    try:
        # 使用 transcript_segments 表，而不是 transcripts
        response = supabase.table("transcript_segments") \
            .select("*") \
            .eq("session_id", session_id) \
            .order("start_time", desc=False) \
            .execute()

        return response.data or []

    except Exception as e:
        logger.error(f"查詢轉錄資料失敗: {str(e)}")
        return []


def _generate_stt_transcript(session_id: str, transcripts: list) -> str:
    """生成 STT 格式的逐字稿"""
    # 建立標題
    lines = [
        "=== 音頻轉錄逐字稿 ===",
        f"Session ID: {session_id}",
        f"生成時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
    ]

    if transcripts:
        # 計算總時長（使用 start_time 欄位）
        last_timestamp = max(t.get('start_time', 0) for t in transcripts)
        duration = str(timedelta(seconds=int(last_timestamp)))
        lines.append(f"錄音時長: {duration}")
    else:
        lines.append("錄音時長: 00:00:00")

    lines.append(f"總段落數: {len(transcripts)}")
    lines.append("=" * 50)
    lines.append("")

    # 加入轉錄內容
    for transcript in transcripts:
        # 使用正確的欄位名稱
        start_time = transcript.get('start_time', 0)
        text = transcript.get('text', '').strip()

        # 格式化時間戳 (HH:MM:SS.mmm)
        time_str = _format_timestamp(start_time)

        # 確保文字沒有換行
        text = text.replace('\n', ' ')

        lines.append(f"[{time_str}] {text}")

    return '\n'.join(lines)


def _generate_stt_transcript(session_id: str, transcripts: list) -> str:
    """生成 STT 格式的逐字稿"""

    # 加入轉錄內容
    for transcript in transcripts:
        timestamp = transcript.get('timestamp', 0)
        text = transcript.get('text', '').strip()

        # 格式化時間戳 (HH:MM:SS.mmm)
        time_str = _format_timestamp(timestamp)

        # 確保文字沒有換行
        text = text.replace('\n', ' ')

        lines.append(f"[{time_str}] {text}")

    return '\n'.join(lines)


def _format_timestamp(seconds: float) -> str:
    """將秒數轉換為 HH:MM:SS.mmm 格式"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    milliseconds = int((seconds % 1) * 1000)

    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"
