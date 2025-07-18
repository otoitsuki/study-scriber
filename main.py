"""
StudyScriber FastAPI 應用程式主入口

雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式
"""

import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from datetime import datetime
import logging

# Task 5: Prometheus 監控支援
try:
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    PROMETHEUS_AVAILABLE = True
except ImportError:
    PROMETHEUS_AVAILABLE = False

from app.db.database import auto_init_database, check_database_connection, check_tables_exist, get_database_stats, get_database_mode
from app.api.sessions import router as sessions_router
from app.api.notes import router as notes_router
from app.api.segments import router as segments_router
from app.api.export import router as export_router
from app.ws.upload_audio import router as upload_audio_router
from app.ws.transcript_feed import router as transcript_feed_router
from app.core.ffmpeg import check_ffmpeg_health
from app.core.config import settings
from app.core.container import container
from app.services.stt.factory import get_provider
from app.services.azure_openai_v2 import queue_manager

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

    # Task 3: 啟動隊列管理器
    try:
        await queue_manager.start_workers()
        logger.info("✅ 轉錄隊列管理器啟動成功")
    except Exception as e:
        logger.error(f"❌ 隊列管理器啟動失敗: {e}")

    yield

    # 關閉時執行
    logger.info("🔄 StudyScriber 正在關閉...")

    # Task 3: 停止隊列管理器
    try:
        await queue_manager.stop_workers()
        logger.info("✅ 轉錄隊列管理器已停止")
    except Exception as e:
        logger.warning(f"⚠️ 隊列管理器停止時發生錯誤: {e}")

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
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # 允許前端讀取這個 header
)

# 註冊路由
app.include_router(sessions_router)
app.include_router(notes_router)
app.include_router(segments_router)
app.include_router(export_router)
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
    """除錯端點 - 檢查 provider 狀態"""
    try:
        # 查詢 provider 狀態
        # 這裡僅示範查詢一個 session（可根據實際需求調整）
        from uuid import UUID
        test_session_id = UUID("00000000-0000-0000-0000-000000000000")  # TODO: 改為實際 session id
        provider = get_provider(test_session_id)
        return {
            "status": "success",
            "provider": provider.name(),
            "class_name": type(provider).__name__,
        }
    except Exception as e:
        return {
            "status": "error",
            "error": str(e)
        }


@app.get("/health")
async def health_check():
    """健康檢查端點"""
    try:
        db_ok = await check_database_connection()
        if not db_ok:
            raise HTTPException(status_code=503, detail="Database connection failed")
        tables_ok = await check_tables_exist()
        if not tables_ok:
            raise HTTPException(status_code=503, detail="Database tables missing")
        ffmpeg_health = check_ffmpeg_health()
        # 查詢 provider 狀態
        from uuid import UUID
        test_session_id = UUID("00000000-0000-0000-0000-000000000000")  # TODO: 改為實際 session id
        try:
            provider = get_provider(test_session_id)
            provider_available = provider is not None
        except Exception as e:
            logger.warning(f"Provider 解析失敗: {e}")
            provider_available = False
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
                "provider": {
                    "available": provider_available,
                    "service": provider.name() if provider_available else "Disabled"
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
        # 這裡需要根據實際的 provider 架構來調整，
        # 例如，如果 provider 本身有 get_performance_report 方法
        # 則可以從 provider 獲取，否則返回預設值。
        # 目前，我們只保留了 queue_manager 的啟動/關閉，
        # 所以這裡返回一個預設值。
        return {
            "status": "success",
            "timestamp": datetime.utcnow().isoformat(),
            "transcription_service": {"status": "no_stats_available"},
            "ffmpeg_service": {
                "status": "N/A",
                "available": False,
                "active_processes": 0,
                "pooled_processes": 0
            }
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"無法取得效能統計: {str(e)}")


@app.get("/debug/queue")
async def debug_queue():
    """Task 3 & 4: 除錯端點 - 檢查隊列狀態"""
    try:
        stats = queue_manager.get_stats()
        return {
            "status": "success",
            "queue_stats": stats,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            "status": "error",
            "queue_stats": {
                "error": str(e)
            }
        }


@app.get("/metrics")
async def metrics():
    """Task 5: Prometheus 監控指標端點"""
    if not PROMETHEUS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Prometheus metrics not available - prometheus-client not installed"
        )

    try:
        # 生成 Prometheus 格式的監控指標
        metrics_data = generate_latest()
        return Response(
            content=metrics_data,
            media_type=CONTENT_TYPE_LATEST,
            headers={
                "Content-Type": CONTENT_TYPE_LATEST,
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            }
        )
    except Exception as e:
        logger.error(f"Failed to generate metrics: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate metrics: {str(e)}"
        )


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
