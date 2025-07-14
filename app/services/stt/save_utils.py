import json, logging
from uuid import UUID
from datetime import datetime

from app.db.database import get_supabase_client
from app.utils.timing import calc_times
from app.ws.transcript_feed import manager as ws

logger = logging.getLogger(__name__)


async def save_and_push_result(
    sid: UUID,
    chunk_seq: int,
    res: dict,
) -> None:
    """
    將 provider 回傳的結果：
      1. 寫入 transcript_segments
      2. 透過 WebSocket 推送給前端
    必要欄位：text, lang_code, timestamp
    可選欄位：start_time, end_time
    """
    # -------- 1. 時間欄位保障 --------
    if "start_time" not in res or "end_time" not in res:
        res["start_time"], res["end_time"] = calc_times(chunk_seq)

    # -------- 2. 寫入 DB -------------
    supa = get_supabase_client()
    seg_data = {
        "session_id": str(sid),
        "chunk_sequence": chunk_seq,
        "text": res["text"],
        "start_time": res["start_time"],
        "end_time": res["end_time"],
        "confidence": 1.0,
        "lang_code": res["lang_code"],
        "created_at": res.get("timestamp", datetime.utcnow().isoformat()),
    }
    row = supa.table("transcript_segments").insert(seg_data).execute()
    seg_id = row.data[0]["id"]

    # -------- 3. WebSocket 推送 ------
    await ws.broadcast(
        json.dumps(
            {
                "type": "transcript_segment",
                "session_id": str(sid),
                "segment_id": seg_id,
                "chunk_sequence": chunk_seq,
                "start_time": res["start_time"],
                "end_time": res["end_time"],
                "text": res["text"],
            }
        ),
        str(sid),
    )
    logger.info("📡 推送 transcript_segment seq=%s start=%.1f", chunk_seq, res["start_time"])
