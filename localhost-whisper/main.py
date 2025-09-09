#!/usr/bin/env python3
"""
MLX Whisper API 啟動腳本

提供多種啟動模式：
- 開發模式：自動重載、調試輸出
- 生產模式：多 worker、最佳化配置
- 測試模式：單 worker、測試配置
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# 添加專案根目錄到 Python 路徑
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

import uvicorn
from app.config import get_settings
from app.main import app

# 設定日誌
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


def create_directories():
    """創建必要的目錄"""
    directories = ["models", "scripts"]

    for directory in directories:
        Path(directory).mkdir(exist_ok=True)
        logger.info(f"📁 確保目錄存在: {directory}")


def check_dependencies():
    """檢查必要的依賴"""
    try:
        import mlx
        import mlx_whisper
        import fastapi
        import uvicorn

        logger.info("✅ 所有必要依賴已安裝")
        return True
    except ImportError as e:
        logger.error(f"❌ 缺少必要依賴: {str(e)}")
        logger.error("請運行: pip install -r requirements.txt")
        return False


def main():
    """主啟動函數"""
    logger.info("🚀 啟動 MLX Whisper API...")

    # 檢查依賴
    if not check_dependencies():
        sys.exit(1)

    # 創建必要目錄
    create_directories()

    # 取得設定
    settings = get_settings()

    # 確定啟動模式
    mode = os.getenv("WHISPER_API_MODE", "development")

    if mode == "development":
        logger.info("🔧 開發模式啟動")
        uvicorn.run(
            "app.main:app",
            host=settings.host,
            port=settings.port,
            workers=1,  # 開發模式使用單 worker
            reload=True,
            reload_dirs=["app"],
            log_level=settings.log_level.lower(),
            access_log=True,
            use_colors=True,
        )

    elif mode == "production":
        logger.info("🏭 生產模式啟動")
        uvicorn.run(
            app,
            host=settings.host,
            port=settings.port,
            workers=settings.workers,
            log_level=settings.log_level.lower(),
            access_log=True,
            server_header=False,
            date_header=False,
        )

    elif mode == "test":
        logger.info("🧪 測試模式啟動")
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=9001,  # 使用不同端口避免衝突
            workers=1,
            log_level="debug",
            access_log=True,
        )

    else:
        logger.error(f"❌ 未知的啟動模式: {mode}")
        logger.info("支援的模式: development, production, test")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("🛑 收到中斷信號，正在關閉服務...")
    except Exception as e:
        logger.error(f"❌ 啟動失敗: {str(e)}", exc_info=True)
        sys.exit(1)
