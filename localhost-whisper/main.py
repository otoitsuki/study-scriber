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
import signal
import sys
import multiprocessing
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
            timeout_keep_alive=30,  # 保持連線超時
            timeout_graceful_shutdown=60,  # 優雅關機超時
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
            timeout_keep_alive=30,  # 保持連線超時
            timeout_graceful_shutdown=60,  # 優雅關機超時
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
            timeout_keep_alive=30,  # 保持連線超時
            timeout_graceful_shutdown=60,  # 優雅關機超時
        )

    else:
        logger.error(f"❌ 未知的啟動模式: {mode}")
        logger.info("支援的模式: development, production, test")
        sys.exit(1)


def cleanup_and_exit():
    """清理所有子進程並退出"""
    logger.info("🧹 清理 MLX Whisper 相關進程...")
    try:
        # 終止所有子進程
        current_process = multiprocessing.current_process()
        for child in multiprocessing.active_children():
            logger.info(f"🔍 終止子進程: {child.pid}")
            child.terminate()
            child.join(timeout=2)
            if child.is_alive():
                logger.warning(f"⚠️ 強制終止子進程: {child.pid}")
                child.kill()
        
        # 清理 multiprocessing 資源
        multiprocessing.util._cleanup_resources()
    except Exception as e:
        logger.error(f"清理過程中發生錯誤: {e}")
    
    logger.info("✅ MLX Whisper 服務已關閉")


def signal_handler(signum, frame):
    """處理終止信號"""
    logger.info(f"🛑 收到信號 {signum}，正在關閉服務...")
    cleanup_and_exit()
    sys.exit(0)


if __name__ == "__main__":
    # 註冊信號處理器
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        main()
    except KeyboardInterrupt:
        logger.info("🛑 收到 Ctrl+C，正在關閉服務...")
        cleanup_and_exit()
    except Exception as e:
        logger.error(f"❌ 啟動失敗: {str(e)}", exc_info=True)
        cleanup_and_exit()
        sys.exit(1)
    finally:
        cleanup_and_exit()
