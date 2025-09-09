"""
模型列表端點

提供可用模型的列表，符合 OpenAI API 規格。
"""

import time
import logging
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse

from app.config import get_settings, Settings
from app.models.schemas import ModelsResponse, ModelInfo
from app.services.model_manager import get_model_manager, ModelManager
from app.utils.validators import validate_model_name, ParameterValidationError

logger = logging.getLogger(__name__)

# 建立路由器
router = APIRouter(
    prefix="/v1",
    tags=["models"],
    responses={
        200: {"description": "成功取得模型列表"},
        500: {"description": "內部伺服器錯誤"},
    },
)


def create_model_info(model_id: str, model_details: Dict[str, Any] = None) -> ModelInfo:
    """
    創建模型資訊物件

    Args:
        model_id: 模型 ID
        model_details: 模型詳細資訊

    Returns:
        ModelInfo: 模型資訊物件
    """
    return ModelInfo(
        id=model_id, object="model", created=int(time.time()), owned_by="mlx"
    )


def get_model_metadata(settings: Settings) -> Dict[str, Dict[str, Any]]:
    """
    取得模型元資料

    Args:
        settings: 應用設定

    Returns:
        Dict[str, Dict[str, Any]]: 模型元資料字典
    """
    model_metadata = {}

    for model_name in settings.get_supported_models():
        model_info = settings.get_model_info(model_name)
        if model_info:
            model_metadata[model_name] = {
                "parameters": model_info.get("params", "Unknown"),
                "memory_usage": model_info.get("memory", "Unknown"),
                "relative_speed": model_info.get("speed", "Unknown"),
                "description": f"MLX Whisper {model_name} 模型",
                "capabilities": ["transcription"],
                "languages": "多語言支援",
            }
        else:
            model_metadata[model_name] = {
                "description": f"MLX Whisper {model_name} 模型",
                "capabilities": ["transcription"],
            }

    return model_metadata


@router.get(
    "/models",
    response_model=ModelsResponse,
    summary="取得模型列表",
    description="取得所有可用的 Whisper 模型列表，符合 OpenAI API 格式",
)
async def list_models(
    settings: Settings = Depends(get_settings),
    model_manager: ModelManager = Depends(get_model_manager),
    include_details: bool = False,
) -> JSONResponse:
    """
    取得模型列表端點

    返回所有支援的 Whisper 模型，包括：
    - 模型 ID
    - 創建時間
    - 擁有者資訊
    - 可選的詳細資訊（當 include_details=true 時）

    Args:
        settings: 應用設定
        model_manager: 模型管理器
        include_details: 是否包含詳細資訊

    Returns:
        JSONResponse: 模型列表回應
    """
    try:
        # 取得支援的模型列表
        supported_models = settings.get_supported_models()

        # 取得模型管理器狀態
        model_manager_info = model_manager.get_model_info()
        loaded_models = set(model_manager_info.get("loaded_models", []))
        loading_models = set(model_manager_info.get("loading_models", []))

        # 取得模型元資料
        model_metadata = get_model_metadata(settings)

        # 建立模型列表
        models = []

        for model_id in supported_models:
            # 創建基本模型資訊
            model_info = create_model_info(model_id)

            # 如果需要詳細資訊，添加額外資料
            if include_details:
                model_dict = model_info.model_dump()

                # 添加載入狀態
                if model_id in loaded_models:
                    model_dict["status"] = "loaded"
                elif model_id in loading_models:
                    model_dict["status"] = "loading"
                else:
                    model_dict["status"] = "available"

                # 添加模型元資料
                if model_id in model_metadata:
                    model_dict["metadata"] = model_metadata[model_id]

                # 添加使用統計（如果有）
                model_details = model_manager_info.get("model_details", {})
                if model_id in model_details:
                    detail = model_details[model_id]
                    model_dict["usage_stats"] = {
                        "load_count": detail.get("load_count", 0),
                        "last_access": detail.get("last_access", 0),
                        "idle_time": detail.get("idle_time", 0),
                        "load_time": detail.get("load_time", 0),
                    }

                models.append(model_dict)
            else:
                models.append(model_info.model_dump())

        # 建立回應資料
        response_data = {"object": "list", "data": models}

        # 如果包含詳細資訊，添加額外的統計資訊
        if include_details:
            response_data["summary"] = {
                "total_models": len(supported_models),
                "loaded_models": len(loaded_models),
                "loading_models": len(loading_models),
                "available_models": len(supported_models)
                - len(loaded_models)
                - len(loading_models),
                "default_model": settings.default_model,
                "cache_directory": model_manager_info.get("cache_directory", ""),
            }

        return JSONResponse(
            content=response_data,
            status_code=status.HTTP_200_OK,
            headers={
                "Cache-Control": "public, max-age=300",  # 快取 5 分鐘
                "X-Total-Models": str(len(supported_models)),
                "X-Loaded-Models": str(len(loaded_models)),
            },
        )

    except Exception as e:
        logger.error(f"取得模型列表失敗: {str(e)}", exc_info=True)

        # 返回錯誤回應
        error_response = {
            "error": {
                "message": f"無法取得模型列表: {str(e)}",
                "type": "internal_error",
                "code": "models_list_error",
            }
        }

        return JSONResponse(
            content=error_response, status_code=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@router.get(
    "/models/{model_id}",
    summary="取得特定模型資訊",
    description="取得指定模型的詳細資訊",
)
async def get_model(
    model_id: str,
    settings: Settings = Depends(get_settings),
    model_manager: ModelManager = Depends(get_model_manager),
) -> JSONResponse:
    """
    取得特定模型資訊端點

    Args:
        model_id: 模型 ID
        settings: 應用設定
        model_manager: 模型管理器

    Returns:
        JSONResponse: 模型詳細資訊
    """
    try:
        # 使用驗證器檢查模型，支援別名轉換
        try:
            validated_model_id = validate_model_name(model_id)
        except ParameterValidationError as e:
            return JSONResponse(
                content={
                    "error": {
                        "message": str(e),
                        "type": "invalid_request_error",
                        "code": "model_not_found",
                    }
                },
                status_code=status.HTTP_404_NOT_FOUND,
            )

        # 如果別名被轉換，記錄日誌
        if validated_model_id != model_id:
            logger.info(f"模型別名轉換: '{model_id}' -> '{validated_model_id}'")
            model_id = validated_model_id

        # 取得模型管理器狀態
        model_manager_info = model_manager.get_model_info()
        loaded_models = set(model_manager_info.get("loaded_models", []))
        loading_models = set(model_manager_info.get("loading_models", []))

        # 建立基本模型資訊
        model_info = create_model_info(model_id)
        model_dict = model_info.model_dump()

        # 添加載入狀態
        if model_id in loaded_models:
            model_dict["status"] = "loaded"
        elif model_id in loading_models:
            model_dict["status"] = "loading"
        else:
            model_dict["status"] = "available"

        # 添加模型規格資訊
        model_spec = settings.get_model_info(model_id)
        if model_spec:
            model_dict["specifications"] = {
                "parameters": model_spec.get("params", "Unknown"),
                "memory_requirement": model_spec.get("memory", "Unknown"),
                "relative_speed": model_spec.get("speed", "Unknown"),
            }

        # 添加使用統計
        model_details = model_manager_info.get("model_details", {})
        if model_id in model_details:
            detail = model_details[model_id]
            model_dict["usage_stats"] = {
                "load_count": detail.get("load_count", 0),
                "last_access": detail.get("last_access", 0),
                "idle_time": round(detail.get("idle_time", 0), 2),
                "load_time": round(detail.get("load_time", 0), 2),
                "loaded_at": detail.get("loaded_at", 0),
            }

        # 添加模型能力資訊
        model_dict["capabilities"] = {
            "transcription": True,
            "translation": False,  # 我們沒有實作翻譯功能
            "streaming": False,  # 目前不支援串流
            "batch_processing": True,
        }

        # 添加支援的語言（簡化版本）
        model_dict["supported_languages"] = {
            "count": "80+",
            "primary": ["zh", "en", "ja", "ko", "es", "fr", "de", "it", "pt", "ru"],
            "note": "支援 80+ 種語言的自動檢測和轉錄",
        }

        return JSONResponse(
            content=model_dict,
            status_code=status.HTTP_200_OK,
            headers={
                "Cache-Control": "public, max-age=300",
                "X-Model-Status": model_dict["status"],
            },
        )

    except Exception as e:
        logger.error(f"取得模型 {model_id} 資訊失敗: {str(e)}", exc_info=True)

        return JSONResponse(
            content={
                "error": {
                    "message": f"無法取得模型資訊: {str(e)}",
                    "type": "internal_error",
                    "code": "model_info_error",
                }
            },
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
