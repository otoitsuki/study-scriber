"""
StudyScriber Supabase 資料庫連接配置

專為 Supabase PostgreSQL 設計的資料庫連接模組
使用 Supabase 客戶端 API 進行資料庫操作
"""

import os
from sqlalchemy import create_engine, NullPool, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
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
        error_msg = (
            "使用 Supabase 客戶端模式時不支援 SQLAlchemy 會話。\n"
            "請在您的程式碼中使用 get_supabase_client() 取代 Depends(get_async_session)。\n"
            "範例: client = get_supabase_client()\n"
            "      response = client.table('your_table').select('*').execute()"
        )
        raise RuntimeError(error_msg)

    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise
        finally:
            await session.close()


def get_database_mode() -> str:
    """
    取得目前的資料庫連接模式

    Returns:
        str: 'client' 或 'direct'
    """
    return 'client' if AsyncSessionLocal is None else 'direct'


def is_client_mode() -> bool:
    """
    檢查是否為客戶端模式

    Returns:
        bool: True 如果是客戶端模式
    """
    return AsyncSessionLocal is None


async def get_database_session_safe():
    """
    安全地取得資料庫會話 - 自動根據模式選擇適當的方法

    Returns:
        AsyncSession 或 Client: 根據模式回傳適當的資料庫連接
    """
    if is_client_mode():
        from .supabase_config import get_supabase_client
        return get_supabase_client()
    else:
        async for session in get_async_session():
            return session


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
    connection_mode = get_database_mode()

    try:
        # 使用 Supabase 客戶端測試連接
        client = get_supabase_client()

        # 嘗試執行一個簡單的查詢
        response = client.table('sessions').select("id").limit(1).execute()

        print(f"✅ Supabase 資料庫連接正常 (模式: {connection_mode.upper()})")

        # 如果是直連模式，額外測試 SQLAlchemy 連接
        if connection_mode == 'direct' and AsyncSessionLocal is not None:
            try:
                async for session in get_async_session():
                    # 執行簡單查詢測試 SQLAlchemy 連接
                    result = await session.execute(text("SELECT 1"))
                    await session.close()
                    print("✅ SQLAlchemy 連接也正常")
                    break
            except Exception as e:
                print(f"⚠️  SQLAlchemy 連接異常: {e}")
                print("   將降級使用 Supabase 客戶端模式")

        return True

    except Exception as e:
        print(f"❌ Supabase 資料庫連接失敗: {e}")
        print("💡 請檢查 SUPABASE_URL 和 SUPABASE_KEY 環境變數")

        # 提供模式特定的診斷建議
        if connection_mode == 'client':
            print("💡 客戶端模式診斷建議:")
            print("   - 確認 SUPABASE_KEY 為 anon key 或 service_role key")
            print("   - 檢查 RLS (Row Level Security) 設定")
        else:
            print("💡 直連模式診斷建議:")
            print("   - 確認 SUPABASE_KEY 為 service_role key")
            print("   - 檢查資料庫連接字串格式")
            print("   - 確認網路防火牆設定")

        return False


async def get_database_stats():
    """
    取得 Supabase 資料庫統計資訊
    """
    connection_mode = get_database_mode()

    try:
        client = get_supabase_client()

        # 檢查各表格的記錄數
        tables = ['sessions', 'notes', 'audio_files', 'transcript_segments', 'transcripts']
        stats = {
            'connection_mode': connection_mode,
            'table_counts': {},
            'total_records': 0
        }

        for table in tables:
            try:
                # 使用 Supabase 客戶端計算記錄數
                response = client.table(table).select("*", count="exact").execute()
                count = response.count if hasattr(response, 'count') else len(response.data)
                stats['table_counts'][table] = count
                stats['total_records'] += count
            except Exception as e:
                # 如果表格不存在或無法訪問，設為 0
                stats['table_counts'][table] = 0
                print(f"⚠️  無法取得表格 '{table}' 統計: {e}")

        # 增加連接模式特定的資訊
        if connection_mode == 'direct':
            stats['sqlalchemy_available'] = AsyncSessionLocal is not None
            stats['engine_info'] = {
                'pool_size': 10,
                'max_overflow': 20,
                'pool_recycle': 3600
            } if AsyncSessionLocal is not None else None
        else:
            stats['client_mode_info'] = {
                'using_supabase_client': True,
                'rls_enabled': True  # 客戶端模式通常啟用 RLS
            }

        return stats

    except Exception as e:
        print(f"❌ 無法取得資料庫統計: {e}")
        return {
            'connection_mode': connection_mode,
            'error': str(e),
            'table_counts': {},
            'total_records': 0
        }
