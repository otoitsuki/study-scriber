"""
MLX Whisper 模型管理器

負責模型名稱驗證和設定管理，
簡化為只返回模型名稱，不再持有模型物件。
"""

import logging
import os
from typing import Dict, List, Optional, Any

from app.config import get_settings


logger = logging.getLogger(__name__)


class ModelLoadError(Exception):
    """模型載入錯誤"""

    pass


class ModelManager:
    """MLX Whisper 模型管理器（簡化版）"""

    def __init__(self):
        """初始化模型管理器"""
        self.settings = get_settings()
        logger.info("模型管理器已初始化 (僅管理名稱和設定)")

    async def get_model(self, model_name: str) -> str:
        """
        驗證並返回模型名稱

        Args:
            model_name: 模型名稱

        Returns:
            str: 驗證後的模型名稱

        Raises:
            ModelLoadError: 模型不存在或無效
            ValueError: 無效的模型名稱
        """
        # 驗證模型名稱
        if model_name not in self.settings.get_supported_models():
            raise ValueError(f"不支援的模型: {model_name}")

        # 檢查別名 (這一步應該在 validator 做，但為保險起見)
        model_name = self.settings.model_aliases.get(model_name, model_name)

        # 檢查模型是否已下載 (如果不是HF模型)
        model_info = self.settings.get_model_info(model_name)
        if not (model_info and model_info.get("hf_repo")):
            model_path = os.path.join(self.settings.model_cache_dir, model_name)
            if not os.path.exists(model_path) or not os.listdir(model_path):
                raise ModelLoadError(f"模型 '{model_name}' 未在本機找到。請先下載。")

        logger.info(f"確認模型 '{model_name}' 可用。")
        return model_name  # 直接返回模型名稱

    async def shutdown(self) -> None:
        """關閉模型管理器"""
        logger.info("模型管理器已關閉")

    def get_model_info(self) -> Dict[str, Any]:
        """
        獲取模型管理器狀態資訊（簡化版）

        Returns:
            Dict: 包含基本模型資訊的字典
        """
        return {
            "loaded_models": [],  # 簡化版不再載入模型
            "loading_models": [],  # 簡化版不再有載入狀態
            "total_loaded": 0,  # 簡化版不再載入模型
            "cache_directory": self.settings.model_cache_dir,
            "supported_models": self.settings.get_supported_models(),
            "model_details": {},  # 簡化版沒有詳細資訊
        }


# 全域模型管理器實例
_model_manager_instance: Optional[ModelManager] = None


def get_model_manager() -> ModelManager:
    """
    獲取全域模型管理器實例（單例模式）

    Returns:
        ModelManager: 模型管理器實例
    """
    global _model_manager_instance

    if _model_manager_instance is None:
        _model_manager_instance = ModelManager()

    return _model_manager_instance


# 全域實例
model_manager = get_model_manager()


# 便利函數
async def get_model_name(model_name: str) -> str:
    """獲取驗證後的模型名稱"""
    return await model_manager.get_model(model_name)
