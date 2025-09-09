#!/usr/bin/env python3
"""
MLX Whisper 模型下載工具

預先下載和管理 Whisper 模型，避免在 API 呼叫時才下載。
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import List, Dict, Any

# 添加專案路徑
sys.path.insert(0, str(Path(__file__).parent.parent))

import mlx_whisper
from app.config import get_settings

# 設定日誌
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)

# 支援的模型及其資訊
MODELS_INFO = {
    "whisper-tiny": {
        "params": "39M",
        "size": "~150MB",
        "memory": "~1GB",
        "speed": "10x",
        "description": "最小模型，速度最快但準確度較低",
    },
    "whisper-base": {
        "params": "74M",
        "size": "~290MB",
        "memory": "~1.5GB",
        "speed": "7x",
        "description": "基礎模型，平衡速度和準確度",
    },
    "whisper-small": {
        "params": "244M",
        "size": "~950MB",
        "memory": "~2.5GB",
        "speed": "4x",
        "description": "小型模型，較好的準確度",
    },
    "whisper-medium": {
        "params": "769M",
        "size": "~3GB",
        "memory": "~5GB",
        "speed": "2x",
        "description": "中型模型，準確度很好",
    },
    "whisper-large-v3": {
        "params": "1550M",
        "size": "~6GB",
        "memory": "~10GB",
        "speed": "1x",
        "description": "最大模型，準確度最高但速度較慢",
    },
    "breeze-asr-25": {
        "params": "1550M",
        "size": "~6GB",
        "memory": "~10GB",
        "speed": "1x",
        "description": "基於 Whisper-large-v2 微調，專為繁體中文和中英混用優化，MLX 格式，由聯發科開發",
        "hf_repo": "eoleedi/Breeze-ASR-25-mlx",
        "type": "huggingface",
    },
}


def print_models_info():
    """顯示所有可用模型的資訊"""
    print("\n🤖 可用的 MLX Whisper 模型:")
    print("=" * 80)

    for model_name, info in MODELS_INFO.items():
        print(f"\n📦 {model_name}")
        print(f"   參數量: {info['params']}")
        print(f"   檔案大小: {info['size']}")
        print(f"   記憶體需求: {info['memory']}")
        print(f"   相對速度: {info['speed']}")
        print(f"   說明: {info['description']}")

    print("\n" + "=" * 80)


def check_model_exists(model_name: str, models_dir: Path) -> bool:
    """檢查模型是否已存在"""
    # 對於 HuggingFace 模型，它們會自動快取，不需要預下載
    if (
        model_name in MODELS_INFO
        and MODELS_INFO[model_name].get("type") == "huggingface"
    ):
        return True  # HuggingFace 模型總是"存在"的，因為可以動態載入

    model_path = models_dir / model_name

    # 檢查目錄是否存在且包含模型檔案
    if model_path.exists() and model_path.is_dir():
        # 簡單檢查是否有檔案
        model_files = list(model_path.glob("*"))
        return len(model_files) > 0

    return False


def download_model(model_name: str, models_dir: Path) -> bool:
    """下載指定的模型"""
    if model_name not in MODELS_INFO:
        logger.error(f"❌ 不支援的模型: {model_name}")
        return False

    model_path = models_dir / model_name
    info = MODELS_INFO[model_name]

    logger.info(f"📥 開始下載模型: {model_name}")
    logger.info(f"   檔案大小: {info['size']}")
    logger.info(f"   下載位置: {model_path}")

    try:
        # 確保目錄存在
        model_path.mkdir(parents=True, exist_ok=True)

        # 檢查是否為 HuggingFace 模型
        if info.get("type") == "huggingface":
            hf_repo = info.get("hf_repo", model_name)
            logger.info(f"🔄 正在從 HuggingFace 下載模型: {hf_repo}")
            model = mlx_whisper.load_model(hf_repo)
        else:
            # 使用 mlx_whisper 下載標準模型
            logger.info("🔄 正在下載模型檔案...")
            model = mlx_whisper.load_model(model_name)

        if model is None:
            logger.error(f"❌ 模型 {model_name} 下載失敗")
            return False

        logger.info(f"✅ 模型 {model_name} 下載成功")
        logger.info(f"📁 模型儲存在: {model_path}")

        return True

    except Exception as e:
        logger.error(f"❌ 下載模型 {model_name} 時發生錯誤: {str(e)}")

        # 清理可能損壞的檔案
        if model_path.exists():
            import shutil

            shutil.rmtree(model_path, ignore_errors=True)
            logger.info("🧹 已清理損壞的模型檔案")

        return False


def verify_model(model_name: str, models_dir: Path) -> bool:
    """驗證模型是否正常載入"""
    logger.info(f"🔍 驗證模型: {model_name}")

    try:
        model_path = models_dir / model_name
        model = mlx_whisper.load_model(str(model_path))

        if model is None:
            logger.error(f"❌ 模型 {model_name} 載入失敗")
            return False

        logger.info(f"✅ 模型 {model_name} 驗證成功")
        return True

    except Exception as e:
        logger.error(f"❌ 驗證模型 {model_name} 時發生錯誤: {str(e)}")
        return False


def list_downloaded_models(models_dir: Path):
    """列出已下載的模型"""
    print(f"\n📂 已下載的模型 (位置: {models_dir}):")
    print("=" * 60)

    downloaded = []

    for model_name in MODELS_INFO.keys():
        if check_model_exists(model_name, models_dir):
            downloaded.append(model_name)
            print(f"✅ {model_name}")
        else:
            print(f"❌ {model_name} (未下載)")

    print(f"\n共 {len(downloaded)}/{len(MODELS_INFO)} 個模型已下載")

    if downloaded:
        total_size = sum(
            [
                float(
                    MODELS_INFO[model]["size"]
                    .replace("~", "")
                    .replace("GB", "")
                    .replace("MB", "")
                )
                for model in downloaded
            ]
        )
        print(f"估計佔用空間: ~{total_size:.1f}GB")


def clean_model(model_name: str, models_dir: Path) -> bool:
    """清理指定的模型"""
    model_path = models_dir / model_name

    if not model_path.exists():
        logger.warning(f"⚠️ 模型 {model_name} 不存在，無需清理")
        return True

    try:
        import shutil

        shutil.rmtree(model_path)
        logger.info(f"🗑️ 已刪除模型: {model_name}")
        return True

    except Exception as e:
        logger.error(f"❌ 刪除模型 {model_name} 失敗: {str(e)}")
        return False


def main():
    """主函數"""
    parser = argparse.ArgumentParser(description="MLX Whisper 模型管理工具")

    parser.add_argument(
        "action",
        choices=["list", "info", "download", "verify", "clean", "download-all"],
        help="執行的動作",
    )

    parser.add_argument("models", nargs="*", help="要操作的模型名稱")

    parser.add_argument(
        "--models-dir", type=Path, default=None, help="模型儲存目錄 (預設從配置讀取)"
    )

    parser.add_argument("--force", action="store_true", help="強制執行，覆蓋現有模型")

    args = parser.parse_args()

    # 取得模型目錄
    if args.models_dir:
        models_dir = args.models_dir
    else:
        settings = get_settings()
        models_dir = Path(settings.model_cache_dir)

    # 確保模型目錄存在
    models_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"📁 模型目錄: {models_dir}")

    # 執行相應動作
    if args.action == "info":
        print_models_info()

    elif args.action == "list":
        list_downloaded_models(models_dir)

    elif args.action == "download":
        if not args.models:
            logger.error("❌ 請指定要下載的模型名稱")
            sys.exit(1)

        success_count = 0

        for model_name in args.models:
            if not args.force and check_model_exists(model_name, models_dir):
                logger.info(
                    f"⏭️ 模型 {model_name} 已存在，跳過下載（使用 --force 強制重新下載）"
                )
                continue

            if download_model(model_name, models_dir):
                success_count += 1

        logger.info(f"📊 下載完成: {success_count}/{len(args.models)} 個模型成功")

    elif args.action == "download-all":
        logger.info("📥 下載所有模型...")
        success_count = 0

        for model_name in MODELS_INFO.keys():
            if not args.force and check_model_exists(model_name, models_dir):
                logger.info(f"⏭️ 模型 {model_name} 已存在，跳過")
                continue

            if download_model(model_name, models_dir):
                success_count += 1

        logger.info(f"📊 批量下載完成: {success_count} 個模型成功")

    elif args.action == "verify":
        if not args.models:
            logger.error("❌ 請指定要驗證的模型名稱")
            sys.exit(1)

        success_count = 0

        for model_name in args.models:
            if verify_model(model_name, models_dir):
                success_count += 1

        logger.info(f"📊 驗證完成: {success_count}/{len(args.models)} 個模型正常")

    elif args.action == "clean":
        if not args.models:
            logger.error("❌ 請指定要清理的模型名稱")
            sys.exit(1)

        success_count = 0

        for model_name in args.models:
            if clean_model(model_name, models_dir):
                success_count += 1

        logger.info(f"📊 清理完成: {success_count}/{len(args.models)} 個模型")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("🛑 操作被用戶中斷")
        sys.exit(130)
    except Exception as e:
        logger.error(f"❌ 發生未預期錯誤: {str(e)}", exc_info=True)
        sys.exit(1)
