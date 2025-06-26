"""
StudyScriber Supabase 資料庫連接配置

專為 Supabase PostgreSQL 設計的資料庫連接模組
使用 Supabase 客戶端 API 進行資料庫操作
"""
import logging
from .supabase_config import get_supabase_client

# 設置日誌
logger = logging.getLogger(__name__)

def get_supabase_db():
    """
    取得 Supabase 客戶端的依賴注入函式。

    取代舊的 get_async_session 和 get_database_session_safe。
    用於 FastAPI 的 Depends()。
    """
    return get_supabase_client()

async def check_database_connection():
    """
    檢查 Supabase 資料庫連接狀態
    """
    try:
        client = get_supabase_client()
        # 嘗試執行一個簡單的查詢
        client.table('sessions').select("id").limit(1).execute()
        logger.info("✅ Supabase 資料庫連接正常")
        return True
    except Exception as e:
        logger.error(f"❌ Supabase 資料庫連接失敗: {e}")
        logger.error("💡 請檢查 SUPABASE_URL 和 SUPABASE_KEY 環境變數")
        return False

async def check_tables_exist() -> bool:
    """
    檢查所有必要的 Supabase 資料庫表格是否存在

    Returns:
        bool: 如果所有表格都存在則回傳 True，否則回傳 False
    """
    required_tables = [
        'sessions',
        'audio_files',
        'transcript_segments',
        'transcripts',
        'notes'
    ]
    client = get_supabase_client()

    try:
        for table_name in required_tables:
            try:
                # 嘗試查詢表格來檢查是否存在
                client.table(table_name).select("id", head=True).limit(1).execute()
                logger.info(f"✅ 表格 '{table_name}' 存在且可訪問")
            except Exception:
                logger.error(f"❌ 表格 '{table_name}' 不存在或無法訪問。")
                return False
        logger.info("✅ 所有核心表格都存在")
        return True
    except Exception as e:
        logger.error(f"❌ 檢查表格時發生錯誤: {e}")
        return False

async def auto_init_database():
    """
    自動檢測並初始化 Supabase 資料庫

    檢查表格是否存在，如果不存在則提示使用者手動執行 SQL 腳本
    """
    logger.info("🔍 檢查 Supabase 資料庫表格狀態...")

    if await check_tables_exist():
        logger.info("✅ Supabase 資料庫表格已存在，跳過初始化")
        return

    logger.warning("🚧 偵測到缺失的表格")
    logger.warning("📋 請在 Supabase Dashboard 的 SQL Editor 中執行以下腳本：")
    logger.warning("   app/db/supabase_init.sql")
    logger.warning("💡 或參考 README.md 中的詳細設定指南")

    raise RuntimeError(
        "資料庫表格尚未建立。請在 Supabase Dashboard 中執行 app/db/supabase_init.sql 腳本。"
    )

# 為了兼容舊的命名，保留一個別名
get_supabase_client_safe = get_supabase_db

# 新增：回傳目前資料庫模式（Supabase 固定）

def get_database_mode() -> str:
    """取得目前資料庫連線模式。"""
    return "supabase"


async def get_database_stats() -> dict:
    """取得 Supabase 資料庫統計資訊（簡易占位實作）。"""
    # 在完整實作中可以呼叫 Supabase RPC 或資訊視圖
    return {
        "tables": "unknown",
        "status": "placeholder",
    }
