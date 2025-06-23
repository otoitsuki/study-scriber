"""
StudyScriber Supabase 資料庫連接配置

專為 Supabase PostgreSQL 設計的資料庫連接模組
使用 Supabase 客戶端 API 進行資料庫操作
"""

import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.pool import NullPool
from typing import AsyncGenerator

from .supabase_config import supabase_config, get_supabase_client

# 基底模型類別
Base = declarative_base()

# 從 Supabase 配置取得資料庫 URL
DATABASE_URL = supabase_config.get_database_url()

print(f"🔗 使用 Supabase PostgreSQL 資料庫")
print(f"🔗 連接模式: {'客戶端 API' if 'supabase+client' in DATABASE_URL else 'PostgreSQL 直連'}")

# 只有在非客戶端模式下才建立 SQLAlchemy 引擎
if not DATABASE_URL.startswith("supabase+client://"):
    # 建立非同步引擎 (用於 service_role key)
    async_engine = create_async_engine(
        DATABASE_URL,
        poolclass=NullPool,
        pool_size=10,
        max_overflow=20,
        echo=False,  # Supabase 模式下關閉 SQL 日誌以避免干擾
        future=True,
        pool_pre_ping=True,  # 檢查連接有效性
        pool_recycle=3600,   # 每小時回收連接
    )

    # 建立會話製造器
    AsyncSessionLocal = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False
    )

    # 同步引擎（用於初始化資料庫）
    sync_engine = create_engine(
        DATABASE_URL.replace("+asyncpg", ""),  # 移除 asyncpg 使用 psycopg2
        poolclass=NullPool,
        echo=False
    )
else:
    # 客戶端模式 - 不使用 SQLAlchemy 引擎
    async_engine = None
    AsyncSessionLocal = None
    sync_engine = None
    print("💡 使用 Supabase 客戶端 API 模式，不建立 SQLAlchemy 引擎")


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """
    取得非同步資料庫會話的依賴注入函式

    用於 FastAPI 的 Depends()
    """
    if AsyncSessionLocal is None:
        raise RuntimeError("使用 anon key 時不支援 SQLAlchemy 會話，請使用 Supabase 客戶端")

    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def check_tables_exist() -> bool:
    """
    檢查所有必要的 Supabase 資料庫表格是否存在

    Returns:
        bool: 如果所有表格都存在則回傳 True，否則回傳 False
    """
    # 定義需要檢查的核心表格
    required_tables = [
        'sessions',
        'audio_files',
        'transcript_segments',
        'transcripts',
        'notes'
    ]

    try:
        # 使用 Supabase 客戶端檢查表格
        client = get_supabase_client()

        for table_name in required_tables:
            try:
                # 嘗試查詢表格的第一筆記錄來檢查表格是否存在
                response = client.table(table_name).select("*").limit(1).execute()
                # 如果沒有拋出錯誤，表格存在
                print(f"✅ 表格 '{table_name}' 存在且可訪問")
            except Exception as e:
                print(f"❌ 表格 '{table_name}' 不存在或無法訪問: {e}")
                return False

        print("✅ 所有核心表格都存在")
        return True

    except Exception as e:
        print(f"❌ 檢查表格時發生錯誤: {e}")
        return False


async def auto_init_database():
    """
    自動檢測並初始化 Supabase 資料庫

    檢查表格是否存在，如果不存在則提示使用者手動執行 SQL 腳本
    """
    print("🔍 檢查 Supabase 資料庫表格狀態...")

    # 檢查表格是否存在
    tables_exist = await check_tables_exist()

    if tables_exist:
        print("✅ Supabase 資料庫表格已存在，跳過初始化")
        return

    print("🚧 偵測到缺失的表格")
    print("📋 請在 Supabase Dashboard 的 SQL Editor 中執行以下腳本：")
    print("   app/db/supabase_init.sql")
    print("💡 或參考 README.md 中的詳細設定指南")

    # 不自動初始化，讓使用者透過 Supabase Dashboard 執行
    raise RuntimeError(
        "資料庫表格尚未建立。請在 Supabase Dashboard 中執行 app/db/supabase_init.sql 腳本。"
    )


async def init_database():
    """
    使用 SQLAlchemy 初始化 Supabase 資料庫架構

    注意：推薦使用 Supabase Dashboard 執行 SQL 腳本，
    這個方法作為程式化初始化的備選方案
    """
    if async_engine is None:
        print("⚠️  客戶端模式不支援 SQLAlchemy 初始化，請使用 Supabase Dashboard")
        return

    from app.db.models import Base

    try:
        print("🔄 正在 Supabase 中建立表格（使用 SQLAlchemy）...")
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("✅ Supabase 資料庫初始化完成")

    except Exception as e:
        print(f"❌ Supabase 資料庫初始化失敗: {e}")
        print("💡 建議使用 Supabase Dashboard 執行 app/db/supabase_init.sql 腳本")
        raise


async def check_database_connection():
    """
    檢查 Supabase 資料庫連接狀態
    """
    try:
        # 使用 Supabase 客戶端測試連接
        client = get_supabase_client()

        # 嘗試執行一個簡單的查詢
        response = client.table('sessions').select("id").limit(1).execute()

        print("✅ Supabase 資料庫連接正常")
        return True
    except Exception as e:
        print(f"❌ Supabase 資料庫連接失敗: {e}")
        print("💡 請檢查 SUPABASE_URL 和 SUPABASE_KEY 環境變數")
        return False


async def get_database_stats():
    """
    取得 Supabase 資料庫統計資訊
    """
    try:
        client = get_supabase_client()

        # 檢查各表格的記錄數
        tables = ['sessions', 'notes', 'audio_files', 'transcript_segments', 'transcripts']
        stats = {}

        for table in tables:
            try:
                # 使用 Supabase 客戶端計算記錄數
                response = client.table(table).select("*", count="exact").execute()
                count = response.count if hasattr(response, 'count') else len(response.data)
                stats[table] = count
            except Exception:
                # 如果表格不存在或無法訪問，設為 0
                stats[table] = 0

        return stats
    except Exception as e:
        print(f"❌ 無法取得資料庫統計: {e}")
        return None
