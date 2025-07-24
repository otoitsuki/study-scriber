from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from uuid import UUID
import io, zipfile
from app.db.database import get_supabase_client
from app.utils.export import format_export_filename

router = APIRouter(prefix="/api/export", tags=["export"])

def _sec_to_ts(sec: float) -> str:
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    return f"[{h:02d}:{m:02d}:{s:02d}]"

@router.get("/{sid}", response_class=StreamingResponse)
async def export_resource(sid: UUID, type: str = "zip"):
    try:
        if type != "zip":
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported type")

        sb = get_supabase_client()

        # 1. session 必須 completed，同時取得 stt_provider 和 created_at
        session = (
            sb.table("sessions")
            .select("status, stt_provider, created_at")
            .eq("id", str(sid))
            .limit(1)
            .execute()
            .data
        )
        if not session:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")

        session_data = session[0]
        if session_data["status"] != "completed":
            raise HTTPException(status.HTTP_202_ACCEPTED, "session not finished")

        # 2. 讀 note：欄位名稱可能是 markdown / body / content
        note_row = (
            sb.table("notes")
            .select("content, markdown, body")
            .eq("session_id", str(sid))
            .limit(1)
            .execute()
            .data
        )
        if not note_row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "note not found")
        note = note_row[0]
        note_md = note.get("content") or note.get("markdown") or note.get("body") or ""

        # 3. 逐字稿：優先用有時間戳的 segments，沒有就退回 full_text
        seg_rows = (
            sb.table("transcript_segments")
            .select("text, start_time")
            .eq("session_id", str(sid))
            .order("chunk_sequence")
            .execute()
            .data
        )

        if seg_rows:
            transcript_txt = "\n".join(
                f"{_sec_to_ts(seg.get('start_time', 0))} {seg.get('text', '').strip()}"
                for seg in seg_rows
            )
        else:
            # fallback 讀 transcripts.full_text
            full = (
                sb.table("transcripts")
                .select("full_text")
                .eq("session_id", str(sid))
                .limit(1)
                .execute()
                .data
            )
            transcript_txt = (full[0]["full_text"] if full else "").strip()

        # 4. 建立檔名
        filename = format_export_filename(
            session_id=sid,
            stt_provider=session_data["stt_provider"],
            created_at=session_data["created_at"]
        )

        # 5. 打包 ZIP
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("note.md", note_md.strip())
            zf.writestr("transcript.txt", transcript_txt)

            # 讀取摘要文字（若有）
            # 嘗試讀取 sessions.summary 欄位。若資料庫尚未加入該欄位
            #（舊版 schema），Supabase 會回傳 42703 錯誤，改以空字串處理。
            try:
                summary_row = (
                    sb.table("sessions")
                    .select("summary")
                    .eq("id", str(sid))
                    .limit(1)
                    .execute()
                    .data
                )
                summary_text = (
                    summary_row[0]["summary"] if summary_row and summary_row[0].get("summary") else ""
                ).strip()
            except Exception:  # noqa: BLE001
                # 可能是 sessions 表沒有 summary 欄位
                summary_text = ""
            if summary_text:
                zf.writestr("summary.txt", summary_text)
            else:
                zf.writestr("summary.txt", "(尚未產生或無摘要)")
        buf.seek(0)

        headers = {
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
        return StreamingResponse(buf, media_type="application/zip", headers=headers)
    except HTTPException as e:
        # FastAPI HTTPException 直接丟出
        raise e
    except Exception as e:
        import traceback
        print(f"[EXPORT ERROR] {e}")
        print(traceback.format_exc())
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Export failed: {e}")
