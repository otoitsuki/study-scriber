"""
健康檢查端點

提供服務狀態和系統資訊，符合標準的健康檢查 API。
"""

import time
import logging
import asyncio
from typing import Dict, Any
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.config import get_settings, Settings
from app.models.schemas import HealthResponse
from app.services.model_manager import get_model_manager, ModelManager

logger = logging.getLogger(__name__)

# 服務啟動時間
_service_start_time = time.time()

# 建立路由器
router = APIRouter(
    tags=["health"],
    responses={200: {"description": "服務健康"}, 503: {"description": "服務不可用"}},
)


async def get_system_info() -> Dict[str, Any]:
    """取得系統資訊"""
    try:
        import psutil

        # 取得 CPU 使用率
        cpu_percent = psutil.cpu_percent(interval=0.1)

        # 取得記憶體使用情況
        memory = psutil.virtual_memory()

        # 取得磁碟使用情況
        disk = psutil.disk_usage("/")

        return {
            "cpu_percent": round(cpu_percent, 2),
            "memory": {
                "total": memory.total,
                "available": memory.available,
                "used": memory.used,
                "percent": round(memory.percent, 2),
            },
            "disk": {
                "total": disk.total,
                "free": disk.free,
                "used": disk.used,
                "percent": round((disk.used / disk.total) * 100, 2),
            },
        }
    except ImportError:
        # 如果 psutil 不可用，返回基本資訊
        logger.warning("psutil 不可用，無法取得系統資訊")
        return {}
    except Exception as e:
        logger.error(f"取得系統資訊時發生錯誤: {str(e)}")
        return {}


async def check_model_status(model_manager: ModelManager) -> Dict[str, Any]:
    """檢查模型狀態"""
    try:
        model_info = model_manager.get_model_info()

        # 檢查是否有模型正在載入
        loading_models = model_info.get("loading_models", [])
        loaded_models = model_info.get("loaded_models", [])

        # 如果有模型正在載入，給予額外等待時間
        if loading_models:
            logger.info(f"模型正在載入中: {loading_models}")
            await asyncio.sleep(0.1)  # 短暫等待
            model_info = model_manager.get_model_info()

        return {
            "loaded_models": model_info.get("loaded_models", []),
            "loading_models": model_info.get("loading_models", []),
            "total_loaded": model_info.get("total_loaded", 0),
            "supported_models": model_info.get("supported_models", []),
            "cache_directory": model_info.get("cache_directory", ""),
            "model_details": model_info.get("model_details", {}),
        }
    except Exception as e:
        logger.error(f"檢查模型狀態時發生錯誤: {str(e)}")
        return {
            "loaded_models": [],
            "loading_models": [],
            "total_loaded": 0,
            "error": str(e),
        }


def calculate_uptime() -> float:
    """計算服務運行時間"""
    return time.time() - _service_start_time


def determine_service_status(
    model_info: Dict[str, Any], system_info: Dict[str, Any]
) -> str:
    """判斷服務狀態"""

    # 檢查是否有載入的模型或正在載入的模型
    loaded_count = model_info.get("total_loaded", 0)
    loading_models = model_info.get("loading_models", [])

    # 檢查系統資源
    memory_percent = system_info.get("memory", {}).get("percent", 0)
    cpu_percent = system_info.get("cpu_percent", 0)
    disk_percent = system_info.get("disk", {}).get("percent", 0)

    # 判斷狀態
    if model_info.get("error"):
        return "degraded"  # 模型載入有問題

    if loading_models:
        return "starting"  # 模型正在載入中

    if loaded_count == 0:
        return "healthy"  # 沒有載入模型也是正常狀態（按需載入）

    # 檢查資源使用情況
    if memory_percent > 95 or disk_percent > 95:
        return "degraded"  # 資源即將耗盡

    if cpu_percent > 90:
        return "degraded"  # CPU 使用率過高

    return "healthy"  # 一切正常


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="健康檢查",
    description="檢查服務健康狀態和系統資訊",
)
async def health_check(
    settings: Settings = Depends(get_settings),
    model_manager: ModelManager = Depends(get_model_manager),
) -> JSONResponse:
    """
    健康檢查端點

    返回服務的健康狀態，包括：
    - 服務狀態
    - 模型載入情況
    - 系統資源使用情況
    - 運行時間
    - 配置資訊
    """
    try:
        # 取得各種狀態資訊
        model_info = await check_model_status(model_manager)
        system_info = await get_system_info()
        uptime = calculate_uptime()
        service_status = determine_service_status(model_info, system_info)

        # 建立健康檢查回應
        health_data = {
            "status": service_status,
            "timestamp": datetime.now().isoformat(),
            "uptime": round(uptime, 2),
            "version": "1.0.0",  # 可以從 pyproject.toml 讀取
            "workers": settings.workers,
            "max_requests_per_minute": settings.max_requests_per_minute,
            "models_loaded": model_info.get("loaded_models", []),
            "service": {
                "port": settings.port,
                "host": settings.host,
                "debug": settings.debug,
                "reload": settings.reload,
                "max_file_size_mb": settings.get_max_file_size_mb(),
                "request_timeout": settings.request_timeout,
                "log_level": settings.log_level,
            },
            "models": {
                "loaded": model_info.get("loaded_models", []),
                "loading": model_info.get("loading_models", []),
                "supported": model_info.get("supported_models", []),
                "cache_dir": model_info.get("cache_directory", ""),
                "default_model": settings.default_model,
            },
        }

        # 如果有系統資訊，加入回應中
        if system_info:
            health_data["system"] = system_info

        # 如果有模型詳細資訊，加入回應中
        if model_info.get("model_details"):
            health_data["model_details"] = model_info["model_details"]

        # 根據狀態決定 HTTP 狀態碼
        status_code = status.HTTP_200_OK
        if service_status == "degraded":
            status_code = status.HTTP_200_OK  # 降級但仍可用
        elif service_status == "starting":
            status_code = status.HTTP_200_OK  # 啟動中
        elif service_status == "unhealthy":
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE

        return JSONResponse(
            content=health_data,
            status_code=status_code,
            headers={"Cache-Control": "no-cache", "X-Health-Check": "true"},
        )

    except Exception as e:
        logger.error(f"健康檢查失敗: {str(e)}", exc_info=True)

        # 返回錯誤狀態
        error_health_data = {
            "status": "unhealthy",
            "timestamp": datetime.now().isoformat(),
            "uptime": round(calculate_uptime(), 2),
            "error": str(e),
            "workers": settings.workers if settings else 0,
            "max_requests_per_minute": (
                settings.max_requests_per_minute if settings else 0
            ),
            "models_loaded": [],
        }

        return JSONResponse(
            content=error_health_data,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Cache-Control": "no-cache", "X-Health-Check": "true"},
        )


@router.get(
    "/health/ready", summary="就緒檢查", description="檢查服務是否已準備好接收請求"
)
async def readiness_check(
    model_manager: ModelManager = Depends(get_model_manager),
) -> JSONResponse:
    """
    就緒檢查端點

    檢查服務是否已準備好處理請求。
    與健康檢查不同，這個端點主要檢查依賴服務和必要組件。
    """
    try:
        # 檢查模型管理器是否正常
        model_info = model_manager.get_model_info()

        # 檢查是否有模型正在載入（這可能影響就緒狀態）
        loading_models = model_info.get("loading_models", [])

        is_ready = True
        reasons = []

        # 如果有太多模型正在載入，可能影響就緒狀態
        if len(loading_models) > 2:
            is_ready = False
            reasons.append(f"多個模型正在載入中: {loading_models}")

        ready_data = {
            "ready": is_ready,
            "timestamp": datetime.now().isoformat(),
            "loading_models": loading_models,
            "loaded_models": model_info.get("loaded_models", []),
        }

        if reasons:
            ready_data["reasons"] = reasons

        status_code = (
            status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE
        )

        return JSONResponse(content=ready_data, status_code=status_code)

    except Exception as e:
        logger.error(f"就緒檢查失敗: {str(e)}", exc_info=True)

        return JSONResponse(
            content={
                "ready": False,
                "timestamp": datetime.now().isoformat(),
                "error": str(e),
            },
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


@router.get("/health/live", summary="存活檢查", description="檢查服務是否存活")
async def liveness_check() -> JSONResponse:
    """
    存活檢查端點

    簡單的存活檢查，只要服務能回應就表示存活。
    這個端點應該盡可能輕量，不執行複雜的檢查。
    """
    return JSONResponse(
        content={
            "alive": True,
            "timestamp": datetime.now().isoformat(),
            "uptime": round(calculate_uptime(), 2),
        },
        status_code=status.HTTP_200_OK,
    )


@router.get(
    "/v1/status",
    summary="V1 狀態檢查",
    description="提供 v1 API 兼容的狀態端點"
)
async def status_check_v1(
    settings: Settings = Depends(get_settings),
    model_manager: ModelManager = Depends(get_model_manager),
) -> JSONResponse:
    """
    V1 狀態檢查端點
    
    提供與 v1 API 兼容的狀態檢查，返回簡化的狀態信息。
    這個端點主要用於兼容性和監控目的。
    """
    try:
        # 取得基本狀態資訊
        model_info = await check_model_status(model_manager)
        uptime = calculate_uptime()
        
        # 建立簡化的 v1 狀態回應
        status_data = {
            "status": "healthy",
            "version": "1.0.0",
            "uptime": round(uptime, 2),
            "timestamp": datetime.now().isoformat(),
            "service": "MLX Whisper API",
            "models": {
                "loaded": len(model_info.get("loaded_models", [])),
                "loading": len(model_info.get("loading_models", [])),
                "supported": len(model_info.get("supported_models", []))
            }
        }
        
        return JSONResponse(
            content=status_data,
            status_code=status.HTTP_200_OK,
            headers={"Cache-Control": "no-cache", "X-API-Version": "v1"}
        )
        
    except Exception as e:
        logger.error(f"V1 狀態檢查失敗: {str(e)}", exc_info=True)
        
        # 返回錯誤狀態
        error_status = {
            "status": "error",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "error": str(e),
            "service": "MLX Whisper API"
        }
        
        return JSONResponse(
            content=error_status,
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            headers={"Cache-Control": "no-cache", "X-API-Version": "v1"}
        )
