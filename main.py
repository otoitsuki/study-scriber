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
from app.services.azure_openai import get_transcription_service
from app.core.ffmpeg import check_ffmpeg_health
from app.core.config import settings
from app.services.azure_openai_v2 import initialize_transcription_service_v2
from app.middleware.session_guard import SingleActiveSessionMiddleware

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

    try:
        # 自動檢測並初始化資料庫
        await auto_init_database()

        # 檢查資料庫連接
        db_ok = await check_database_connection()
        if not db_ok:
            raise Exception("資料庫連接失敗")

        logger.info("✅ 資料庫初始化完成")

        # 檢查 FFmpeg 可用性
        logger.info("🎬 檢查 FFmpeg 可用性...")
        ffmpeg_health = check_ffmpeg_health()
        if ffmpeg_health['ffmpeg_available']:
            logger.info(f"✅ FFmpeg 可用: {ffmpeg_health['version']}")
            if ffmpeg_health.get('installation_path'):
                logger.info(f"   安裝路徑: {ffmpeg_health['installation_path']}")
        else:
            logger.warning(f"⚠️ 警告: FFmpeg 不可用 - {ffmpeg_health['error']}")
            logger.warning("   音訊轉碼功能將無法使用")
            if 'install_instructions' in ffmpeg_health:
                logger.warning("   安裝建議:")
                for platform, cmd in ffmpeg_health['install_instructions'].items():
                    logger.warning(f"   - {platform}: {cmd}")
            logger.warning("   詳細資訊: https://ffmpeg.org/download.html")

        # 初始化轉錄服務 v2
        logger.info("🎤 正在初始化轉錄服務 v2...")
        await initialize_transcription_service_v2()
        logger.info("✅ 轉錄服務 v2 初始化完成")

    except Exception as e:
        logger.error(f"❌ 應用程式啟動失敗: {e}")
        raise

    yield

    # 關閉時執行
    logger.info("🔄 StudyScriber 正在關閉...")

    # 清理 FFmpeg 資源
    try:
        from app.core.ffmpeg import cleanup_ffmpeg_resources
        cleanup_ffmpeg_resources()
        logger.info("✅ FFmpeg 資源清理完成")
    except Exception as e:
        logger.warning(f"⚠️  FFmpeg 資源清理失敗: {e}")

    # 清理轉錄服務 v2
    try:
        from app.services.azure_openai_v2 import cleanup_transcription_service_v2
        cleanup_transcription_service_v2()
        logger.info("✅ 轉錄服務 v2 清理完成")
    except Exception as e:
        logger.warning(f"⚠️  轉錄服務 v2 清理失敗: {e}")


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
        transcription_service = await get_transcription_service()
        transcription_available = transcription_service is not None

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
        transcription_service = await get_transcription_service()

        if not transcription_service:
            return {
                "status": "service_unavailable",
                "message": "轉錄服務未啟用"
            }

        # 取得效能報告
        performance_report = transcription_service.get_performance_report()

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
