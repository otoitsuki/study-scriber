"""
StudyScriber FastAPI 應用程式主入口

雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式
"""

import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime
import logging

from app.db.database import auto_init_database, check_database_connection, check_tables_exist, get_database_stats, get_database_mode
from app.api.sessions import router as sessions_router
from app.api.notes import router as notes_router
from app.ws.upload_audio import router as upload_audio_router
from app.ws.transcript_feed import router as transcript_feed_router
from app.core.ffmpeg import check_ffmpeg_health
from app.core.config import settings
from app.core.container import container
from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
from openai import AzureOpenAI

# 配置日誌
logging.basicConfig(level=settings.LOG_LEVEL, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    應用程式生命週期管理

    啟動時初始化資料庫，關閉時清理資源
    """
    # 啟動時執行
    logger.info("🚀 StudyScriber 正在啟動...")
    check_ffmpeg_health()
    await check_database_connection()

    # 初始化並註冊服務
    api_key = os.getenv("AZURE_OPENAI_API_KEY")
    endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
    deployment = os.getenv("WHISPER_DEPLOYMENT_NAME")
    if api_key and endpoint and deployment:
        azure_client = AzureOpenAI(api_key=api_key, api_version="2024-06-01", azure_endpoint=endpoint)
        transcription_service = SimpleAudioTranscriptionService(azure_client, deployment)
        container.register(SimpleAudioTranscriptionService, lambda: transcription_service)
        logger.info("✅ Transcription service initialized and registered.")
    else:
        logger.warning("Transcription service not initialized due to missing Azure credentials.")


    yield

    # 關閉時執行
    logger.info("🔄 StudyScriber 正在關閉...")
    try:
        service_instance = container.resolve(SimpleAudioTranscriptionService)
        if service_instance:
            logger.info("✅ 轉錄服務已清理")
    except Exception as e:
        logger.warning(f"⚠️ 轉錄服務清理時發生錯誤: {e}")

# 建立 FastAPI 應用程式
app = FastAPI(
    title="StudyScriber API",
    description="雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式",
    version="0.1.0",
    lifespan=lifespan
)

# CORS 設定
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊路由
app.include_router(sessions_router)
app.include_router(notes_router)
app.include_router(upload_audio_router)
app.include_router(transcript_feed_router)


@app.get("/")
async def root():
    """根路由 - API 狀態檢查"""
    return {
        "message": "StudyScriber API is running",
        "version": "0.1.0",
        "status": "healthy"
    }


@app.get("/debug/container")
async def debug_container():
    """除錯端點 - 檢查容器狀態"""
    try:
        # 檢查容器中的轉錄服務
        service = container.resolve(SimpleAudioTranscriptionService)
        return {
            "status": "success",
            "transcription_service": {
                "registered": True,
                "class_name": type(service).__name__,
                "client_type": type(service.client).__name__,
                "deployment_name": service.deployment_name,
                "processing_tasks_count": len(service.processing_tasks),
                "instance_id": id(service)
            }
        }
    except Exception as e:
        return {
            "status": "error",
            "transcription_service": {
                "registered": False,
                "error": str(e)
            }
        }


@app.get("/health")
async def health_check():
    """健康檢查端點"""
    try:
        # 檢查資料庫連接
        db_ok = await check_database_connection()

        if not db_ok:
            raise HTTPException(status_code=503, detail="Database connection failed")

        # 檢查表格是否存在
        tables_ok = await check_tables_exist()

        if not tables_ok:
            raise HTTPException(status_code=503, detail="Database tables missing")

        # 檢查 FFmpeg 狀態
        ffmpeg_health = check_ffmpeg_health()

        # 檢查轉錄服務狀態
        try:
            transcription_service = container.resolve(SimpleAudioTranscriptionService)
            transcription_available = transcription_service is not None
        except Exception as e:
            logger.warning(f"轉錄服務解析失敗: {e}")
            transcription_available = False

        return {
            "status": "healthy",
            "database": "connected",
            "tables": "available",
            "services": {
                "ffmpeg": {
                    "available": ffmpeg_health['ffmpeg_available'],
                    "status": ffmpeg_health['status'],
                    "version": ffmpeg_health.get('version', 'N/A'),
                    "processes": {
                        "active": ffmpeg_health.get('active_processes', 0),
                        "pooled": ffmpeg_health.get('pooled_processes', 0),
                        "max": ffmpeg_health.get('max_processes', 3)
                    }
                },
                "transcription": {
                    "available": transcription_available,
                    "service": "Azure OpenAI Whisper" if transcription_available else "Disabled"
                }
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Health check failed: {str(e)}")


@app.get("/database")
async def database_info():
    """資料庫資訊端點"""
    try:
        # 取得資料庫統計
        db_stats = await get_database_stats()

        # 取得連接模式
        connection_mode = get_database_mode()

        # 檢查連接狀態
        connection_ok = await check_database_connection()

        # 檢查表格狀態
        tables_ok = await check_tables_exist()

        return {
            "status": "success",
            "timestamp": datetime.utcnow().isoformat(),
            "connection": {
                "mode": connection_mode,
                "status": "connected" if connection_ok else "disconnected",
                "tables_available": tables_ok
            },
            "statistics": db_stats
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法取得資料庫資訊: {str(e)}")


@app.get("/performance")
async def performance_stats():
    """效能統計端點"""
    try:
        # 取得轉錄服務效能統計
        try:
            transcription_service = container.resolve(SimpleAudioTranscriptionService)
            if not transcription_service:
                return {
                    "status": "service_unavailable",
                    "message": "轉錄服務未啟用"
                }
            # 取得效能報告 (如果方法存在)
            if hasattr(transcription_service, 'get_performance_report'):
                performance_report = transcription_service.get_performance_report()
            else:
                performance_report = {"status": "no_stats_available"}
        except Exception as e:
            logger.warning(f"轉錄服務解析失敗: {e}")
            return {
                "status": "service_unavailable",
                "message": f"轉錄服務不可用: {str(e)}"
            }

        # 取得 FFmpeg 狀態
        ffmpeg_health = check_ffmpeg_health()

        return {
            "status": "success",
            "timestamp": datetime.utcnow().isoformat(),
            "transcription_service": performance_report,
            "ffmpeg_service": {
                "status": ffmpeg_health['status'],
                "available": ffmpeg_health['ffmpeg_available'],
                "active_processes": ffmpeg_health.get('active_processes', 0),
                "pooled_processes": ffmpeg_health.get('pooled_processes', 0)
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法取得效能統計: {str(e)}")


# 全域例外處理器
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """全域例外處理"""
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc),
            "path": str(request.url)
        }
    )


if __name__ == "__main__":
    # 設置 workers=1 確保在單一進程中運行，
    # 這對於使用內存存儲 WebSocket 連接狀態至關重要。
    # 多進程會導致每個進程有獨立的 ConnectionManager 實例。
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        workers=1
    )
