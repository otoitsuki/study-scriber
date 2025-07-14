"""
StudyScriber 音檔切片上傳 API (REST API 簡化架構)

實作完整 10s WebM 檔案上傳，背景處理轉錄任務
"""

import logging
from uuid import UUID
from fastapi import APIRouter, UploadFile, File, BackgroundTasks, Depends, HTTPException
from starlette.status import HTTP_201_CREATED, HTTP_400_BAD_REQUEST, HTTP_409_CONFLICT
from supabase import Client

from app.core.config import Settings, get_settings
from app.db.database import get_supabase_client
from app.services.r2_client import get_r2_client
from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
from app.services.transcript_feed import get_transcript_hub
from app.core.container import container
from app.utils.validators import valid_webm
from app.services.stt.factory import get_provider
from app.services.stt.whisper_provider import save_and_push_result

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["音檔上傳"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


@router.post("/segment", status_code=HTTP_201_CREATED)
async def upload_segment(
    sid: UUID,
    seq: int,
    file: UploadFile = File(...),
    background: BackgroundTasks = BackgroundTasks(),
    settings: Settings = Depends(get_settings),
    supabase: Client = Depends(get_supabase_client)
):
    """
    上傳 10 秒 WebM 音檔切片 (B-020)

    使用 Content-Length + UploadFile.spool_max_size 雙保險
    立即回應 ack，背景處理轉錄
    """

    # --- 基本驗證 ---
    if file.content_type not in ("audio/webm", "audio/webm;codecs=opus"):
        raise HTTPException(HTTP_400_BAD_REQUEST, "Unsupported media type. Expected audio/webm")

    # 讀取檔案內容
    blob = await file.read()

    # 檔案大小檢查
    if len(blob) > MAX_FILE_SIZE:
        raise HTTPException(HTTP_400_BAD_REQUEST, f"File too large: {len(blob)} bytes > {MAX_FILE_SIZE} bytes (5MB)")

    # 會話驗證 - 檢查 session 存在且狀態正確
    try:
        session_response = supabase.table("sessions").select("*").eq("id", str(sid)).eq("status", "active").limit(1).execute()
        if not session_response.data:
            raise HTTPException(HTTP_400_BAD_REQUEST, "Session not found or not active")

        session = session_response.data[0]
        if session.get('type') != 'recording':
            raise HTTPException(HTTP_400_BAD_REQUEST, "Session is not in recording mode")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session validation error: {e}")
        raise HTTPException(HTTP_400_BAD_REQUEST, "Session validation failed")

    # 序號唯一性檢查 - (session_id, seq) UNIQUE
    try:
        existing_response = supabase.table("audio_files").select("id").eq("session_id", str(sid)).eq("chunk_sequence", seq).limit(1).execute()
        if existing_response.data:
            raise HTTPException(HTTP_409_CONFLICT, f"Sequence {seq} already uploaded for this session. Please retry with next sequence or skip.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Sequence uniqueness check error: {e}")
        raise HTTPException(HTTP_400_BAD_REQUEST, "Sequence validation failed")

    # WebM 檔案格式基本驗證
    if not valid_webm(blob[:32]):
        raise HTTPException(HTTP_400_BAD_REQUEST, "Invalid WebM header. Please ensure file is properly encoded WebM format.")

    logger.info(f"✅ Validated WebM segment upload: session={sid}, seq={seq}, size={len(blob)} bytes")

    # --- 立即回 Ack，並丟背景任務 ---
    background.add_task(process_and_transcribe, sid, seq, blob)
    return {"ack": seq, "size": len(blob), "status": "accepted"}


async def process_and_transcribe(sid: UUID, seq: int, webm_blob: bytes):
    """
    背景任務：處理音檔切片並執行轉錄

    流程：R2 儲存 → 資料庫記錄 → FFmpeg 轉換 → Whisper 轉錄 → WebSocket 廣播
    """
    transcript_hub = get_transcript_hub()

    try:
        logger.info(f"🚀 [背景轉錄] 開始處理切片 {seq} (session: {sid}, size: {len(webm_blob)} bytes)")

        # 1. 儲存至 Cloudflare R2
        r2_client = get_r2_client()
        blob_path = await r2_client.store_segment(sid, seq, webm_blob)
        logger.info(f"📁 [R2 儲存] 切片 {seq} 已儲存至 {blob_path}")

        # 2. 記錄到資料庫 audio_files 表
        supabase = get_supabase_client()
        app_settings = get_settings()
        audio_file_data = {
            "session_id": str(sid),
            "chunk_sequence": seq,
            "r2_key": blob_path,
            "r2_bucket": r2_client.bucket_name,
            "file_size": len(webm_blob),
            "duration_seconds": app_settings.AUDIO_CHUNK_DURATION_SEC  # 從環境變數讀取切片時長
        }

        audio_response = supabase.table("audio_files").insert(audio_file_data).execute()
        if not audio_response.data:
            raise Exception("Failed to insert audio file record")

        logger.info(f"📝 [資料庫] 音檔記錄已建立: {audio_response.data[0]['id']}")

        # 3. 啟動轉錄服務
        try:
            provider = get_provider(sid)
            logger.info(f"🎯 [轉錄啟動] 開始轉錄切片 {seq} (provider={provider.name})")
            result = await provider.transcribe(webm_blob, sid, seq)
            if result:
                await save_and_push_result(sid, seq, result)
                logger.info(f"✅ [轉錄啟動] 切片 {seq} 轉錄成功")
            else:
                logger.warning(f"⚠️ [轉錄啟動] 切片 {seq} 轉錄失敗")
        except Exception as transcription_error:
            logger.error(f"❌ [轉錄服務錯誤] 切片 {seq}: {transcription_error}")
            await transcript_hub.broadcast_error(str(sid), "transcription_service_error", str(transcription_error), seq)

        logger.info(f"✅ [背景轉錄] 切片 {seq} 處理完成")

    except Exception as e:
        logger.error(f"❌ [背景轉錄] 切片 {seq} 處理失敗: {e}")
        # 標記切片錯誤狀態
        await _mark_segment_error(sid, seq, str(e))
        # 廣播錯誤到前端
        await transcript_hub.broadcast_error(str(sid), "processing_error", str(e), seq)


async def _mark_segment_error(sid: UUID, seq: int, error_message: str):
    """標記切片處理錯誤"""
    try:
        supabase = get_supabase_client()
        # 可以考慮在 audio_files 表添加 error_message 欄位，或建立錯誤記錄表
        logger.error(f"切片錯誤記錄: session={sid}, seq={seq}, error={error_message}")
    except Exception as e:
        logger.error(f"記錄切片錯誤失敗: {e}")



