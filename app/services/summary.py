"""Summary generation service using Azure OpenAI

依據 notes 與 transcript_segments 為指定 session 產生摘要並儲存
"""
from __future__ import annotations

import os
import json
import logging
from typing import Optional, List
from uuid import UUID

from app.db.database import get_supabase_client
from app.services.azure_openai_v2 import get_azure_openai_client
from app.ws.transcript_feed import manager as ws_manager

logger = logging.getLogger(__name__)

DEFAULT_MODEL = os.getenv("AZURE_OPENAI_MODEL", "gpt-4o")
DEFAULT_PROMPT = os.getenv(
    "SUMMARY_PROMPT_TEMPLATE",
    "以以下筆記為基底結構，補充逐字稿細節生成摘要：\n筆記：{notes}\n逐字稿：{transcript}",
)
MAX_RETRIES = 3


async def _fetch_notes_and_transcript(session_id: UUID) -> tuple[str, str]:
    """Fetch note content and concatenated transcript text for the session"""
    supa = get_supabase_client()

    # notes table
    note_resp = (
        supa.table("notes")
        .select("content")
        .eq("session_id", str(session_id))
        .limit(1)
        .execute()
    )
    notes = note_resp.data[0]["content"] if note_resp.data else ""

    # transcript_segments table (ordered)
    seg_resp = (
        supa.table("transcript_segments")
        .select("text")
        .eq("session_id", str(session_id))
        .order("start_time", desc=False)
        .execute()
    )
    transcript_parts: List[str] = [seg.get("text", "").strip() for seg in seg_resp.data or []]
    transcript = "\n".join(filter(None, transcript_parts))

    return notes, transcript


async def generate_summary(session_id: UUID) -> Optional[str]:
    """Generate summary for given session and broadcast.

    Returns summary text if successful else None.
    """
    notes, transcript = await _fetch_notes_and_transcript(session_id)

    if not notes and not transcript:
        logger.info("[Summary] No notes or transcript; skipping summary generation for %s", session_id)
        return None

    # 若資料庫已有摘要，直接返回避免重複生成
    supa_check = get_supabase_client()
    check = (
        supa_check.table("sessions")
        .select("summary")
        .eq("id", str(session_id))
        .limit(1)
        .execute()
    )
    if check.data and check.data[0].get("summary"):
        logger.info("[Summary] Summary already exists for session %s", session_id)
        return check.data[0]["summary"]

    client = get_azure_openai_client()
    if client is None:
        logger.error("[Summary] Azure OpenAI client not configured")
        return None

    prompt = DEFAULT_PROMPT.format(notes=notes, transcript=transcript)

    summary: Optional[str] = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info("[Summary] Generating summary for session %s (attempt %s)", session_id, attempt)
            response = await client.chat.completions.create(
                model=DEFAULT_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
            )
            summary = response.choices[0].message.content  # type: ignore[attr-defined]
            break
        except Exception as e:  # noqa: BLE001
            logger.warning("[Summary] Generation failed: %s", e)
            if attempt == MAX_RETRIES:
                logger.error("[Summary] All retries failed for session %s", session_id)
                await _broadcast_error(session_id, str(e))
                return None

    # persist to DB
    if summary is not None:
        _persist_summary(session_id, summary)
        await _broadcast_ready(session_id, summary)
    return summary


def _persist_summary(session_id: UUID, summary: str) -> None:
    """Update sessions.summary column"""
    try:
        supa = get_supabase_client()
        supa.table("sessions").update({"summary": summary}).eq("id", str(session_id)).execute()
        logger.info("[Summary] Saved summary to DB for session %s", session_id)
    except Exception as e:  # noqa: BLE001
        logger.error("[Summary] Failed to save summary: %s", e)


async def _broadcast_ready(session_id: UUID, summary: str) -> None:
    payload = json.dumps({"type": "summary_ready", "data": summary})
    await ws_manager.broadcast(payload, str(session_id))


async def _broadcast_error(session_id: UUID, message: str) -> None:
    payload = json.dumps({"type": "processing_error", "message": message})
    await ws_manager.broadcast(payload, str(session_id))
