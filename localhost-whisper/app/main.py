"""
MLX Whisper API 主應用

整合所有組件，提供完整的 Whisper API 服務，
符合 OpenAI API 規格。
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Dict, Any

from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi

from app.config import get_settings
from app.api import health, models, transcriptions
from app.middleware.error_handler import ErrorHandlerMiddleware
from app.middleware.metrics import (
    PrometheusMetricsMiddleware,
    setup_metrics_integration,
)
from app.services.model_manager import get_model_manager
from app.services.rate_limiter import get_rate_limiter
from app.services.transcription import get_transcription_service

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("mlx_whisper_api.log", encoding="utf-8"),
    ],
)

logger = logging.getLogger(__name__)

# 取得設定
settings = get_settings()

# 啟動時初始化服務
_startup_complete = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    應用生命週期管理器

    處理應用啟動和關閉時的初始化和清理工作
    """
    global _startup_complete

    # 啟動階段
    logger.info("🚀 MLX Whisper API 啟動中...")

    try:
        # 初始化模型管理器
        logger.info("🧠 初始化模型管理器...")
        model_manager = get_model_manager()

        # 跳過預載入模型，避免用戶交互阻塞服務啟動
        logger.info("⚡ 跳過預載入模型，將在首次請求時動態載入")
        # 如果需要預載入，可以在服務啟動後異步執行

        # 初始化速率限制器
        logger.info("🛡️ 初始化速率限制器...")
        rate_limiter = get_rate_limiter()

        # 初始化轉錄服務
        logger.info("🎤 初始化轉錄服務...")
        transcription_service = get_transcription_service()

        # 服務健康檢查
        try:
            service_status = await transcription_service.get_service_status()
            if service_status.get("available", False):
                logger.info("✅ 轉錄服務初始化成功")
            else:
                logger.warning("⚠️ 轉錄服務可能未完全就緒")
        except Exception as e:
            logger.warning(f"⚠️ 轉錄服務健康檢查失敗: {str(e)}")

        _startup_complete = True

        logger.info("🎉 MLX Whisper API 啟動完成!")
        logger.info(f"🌐 服務運行在: http://{settings.host}:{settings.port}")
        logger.info(f"📚 API 文件: http://{settings.host}:{settings.port}/docs")
        logger.info(f"🔧 Workers: {settings.workers}")
        logger.info(f"📝 日誌等級: {settings.log_level}")

        if settings.enable_metrics:
            logger.info(
                f"📊 Prometheus 指標: http://{settings.host}:{settings.metrics_port}/metrics"
            )

        yield

    except Exception as e:
        logger.error(f"❌ 啟動過程中發生錯誤: {str(e)}", exc_info=True)
        _startup_complete = False
        raise

    # 關閉階段
    logger.info("🛑 MLX Whisper API 關閉中...")

    try:
        # 清理模型管理器
        logger.info("🧠 清理模型管理器...")
        await model_manager.shutdown()

        # 清理轉錄服務
        logger.info("🎤 清理轉錄服務...")
        await transcription_service.shutdown()

        logger.info("✅ MLX Whisper API 已安全關閉")

    except Exception as e:
        logger.error(f"❌ 關閉過程中發生錯誤: {str(e)}", exc_info=True)


# 創建 FastAPI 應用
app = FastAPI(
    title="MLX Whisper API",
    description="""

    ## 📖 使用方法
    使用標準的 OpenAI Python SDK:
    ```python
    import openai

    client = openai.OpenAI(
        base_url="http://localhost:8000/v1",
        api_key="not-required"
    )

    with open("audio.mp3", "rb") as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-large-v3",
            file=audio_file
        )
    ```
    """,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# 添加中間件

# 1. 錯誤處理中間件（最外層）
app.add_middleware(ErrorHandlerMiddleware)

# 2. 指標中間件
if settings.enable_metrics:
    logger.info("📊 啟用指標中間件")
    from app.middleware.metrics import (
        PrometheusMetricsMiddleware,
        setup_metrics_endpoint,
    )

    # 直接添加指標中間件
    app.add_middleware(PrometheusMetricsMiddleware)

    # 設定指標端點
    setup_metrics_endpoint(app)

# 3. CORS 中間件
app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"]
        if settings.debug
        else ["http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:8000"]
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 4. 信任主機中間件
# 在開發環境中使用更寬鬆的配置
if settings.debug:
    # 開發環境：允許所有主機
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["*"],
    )
elif settings.is_production():
    # 生產環境：使用嚴格的主機限制
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.get_allowed_hosts(),
    )

# 包含路由器
app.include_router(health.router)
app.include_router(models.router)
app.include_router(transcriptions.router)


# 根路徑
@app.get(
    "/",
    summary="API 根路徑",
    description="提供 API 基本資訊和快速連結",
    response_description="API 資訊",
)
async def root() -> JSONResponse:
    """
    API 根路徑端點

    提供 API 的基本資訊、版本和快速連結
    """
    api_info = {
        "name": "MLX Whisper API",
        "version": "1.0.0",
        "description": "OpenAI 相容的 MLX Whisper 轉錄服務",
        "status": "healthy" if _startup_complete else "starting",
        "endpoints": {
            "health": "/health",
            "models": "/v1/models",
            "transcriptions": "/v1/audio/transcriptions",
            "docs": "/docs",
            "redoc": "/redoc",
            "openapi": "/openapi.json",
        },
        "features": [
            "音頻轉錄 (OpenAI Whisper API 相容)",
            "多語言支援 (80+ 語言)",
            "多種輸出格式 (JSON, Text, SRT, VTT)",
            "Apple MLX 加速",
            "動態模型載入",
            "速率限制",
            "Prometheus 監控",
        ],
        "supported_models": settings.get_supported_models(),
        "max_file_size_mb": settings.get_max_file_size_mb(),
        "timestamp": time.time(),
    }

    return JSONResponse(
        content=api_info,
        headers={"Cache-Control": "public, max-age=300", "X-API-Version": "1.0.0"},
    )


# 自定義 OpenAPI 配置
def custom_openapi():
    """自定義 OpenAPI 規格"""
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title="MLX Whisper API",
        version="1.0.0",
        description=app.description,
        routes=app.routes,
    )

    # 添加服務器資訊
    openapi_schema["servers"] = [
        {
            "url": f"http://{settings.host}:{settings.port}",
            "description": "本地開發伺服器",
        },
        {"url": "http://localhost:8000", "description": "預設本地伺服器"},
    ]

    # 添加標籤資訊
    openapi_schema["tags"] = [
        {"name": "health", "description": "健康檢查和服務狀態"},
        {"name": "models", "description": "模型管理和資訊"},
        {"name": "transcriptions", "description": "音頻轉錄服務"},
    ]

    # 添加安全定義（雖然我們不使用）
    openapi_schema["components"]["securitySchemes"] = {
        "ApiKeyAuth": {
            "type": "apiKey",
            "in": "header",
            "name": "Authorization",
            "description": "API 密鑰（可選，目前不需要）",
        }
    }

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi


# 全域異常處理器
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """HTTP 異常處理器"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "message": exc.detail,
                "type": "http_error",
                "code": exc.status_code,
            }
        },
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """通用異常處理器"""
    logger.error(f"未處理的異常: {str(exc)}", exc_info=True)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "message": "內部伺服器錯誤",
                "type": "internal_error",
                "code": "internal_server_error",
            }
        },
    )


# 自定義中間件：請求日誌
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """請求日誌中間件"""
    start_time = time.time()

    # 記錄請求開始
    logger.info(
        f"📥 {request.method} {request.url.path} - "
        f"客戶端: {request.client.host if request.client else 'unknown'}"
    )

    # 處理請求
    response = await call_next(request)

    # 計算處理時間
    process_time = time.time() - start_time

    # 記錄回應
    logger.info(
        f"📤 {request.method} {request.url.path} - "
        f"狀態: {response.status_code}, "
        f"處理時間: {process_time:.3f}s"
    )

    # 添加處理時間標頭
    response.headers["X-Process-Time"] = str(process_time)

    return response


# 如果直接執行此檔案
if __name__ == "__main__":
    import uvicorn

    logger.info("🚀 直接啟動 MLX Whisper API...")

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        workers=1,  # 直接運行時使用單 worker
        log_level=settings.log_level.lower(),
        reload=settings.reload,
        access_log=True,
    )
