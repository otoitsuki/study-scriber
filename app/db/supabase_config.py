"""
StudyScriber Supabase 配置管理

整合 Supabase 資料庫與 SQLAlchemy ORM
"""

import os
import re
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# 載入環境變數
load_dotenv()

class SupabaseConfig:
    """Supabase 配置管理類別"""

    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_KEY")  # 可以是 anon key 或 service key
        self.db_mode = os.getenv("DB_MODE", "local")

    def is_configured(self) -> bool:
        """檢查 Supabase 是否已正確配置"""
        return (
            self.db_mode == "supabase" and
            bool(self.supabase_url) and
            bool(self.supabase_key)
        )

    def get_database_url(self) -> str:
        """
        根據設定模式回傳資料庫連接字串

        Returns:
            str: PostgreSQL 連接字串
        """
        if self.db_mode == "supabase":
            if not self.supabase_url or not self.supabase_key:
                raise ValueError("SUPABASE_URL 和 SUPABASE_KEY 是必須的")

            # 從 Supabase URL 提取 PostgreSQL 連接資訊
            # Supabase URL 格式: https://your-project-ref.supabase.co
            # PostgreSQL 連接格式: postgresql+asyncpg://postgres:[password]@db.your-project-ref.supabase.co:5432/postgres

            # 提取專案 ID
            url_match = re.match(r'https://([^.]+)\.supabase\.co', self.supabase_url)
            if not url_match:
                raise ValueError(f"無效的 Supabase URL 格式: {self.supabase_url}")

            project_ref = url_match.group(1)

            # 使用 service_role key 作為密碼（如果提供的是 service_role key）
            # 如果是 anon key，我們需要使用不同的方法
            if self.supabase_key.startswith('eyJ'):  # JWT token (anon key)
                # 對於 anon key，我們不能直接連接 PostgreSQL，必須使用 Supabase 客戶端
                # 這裡我們回傳一個特殊的標識符，讓 database.py 知道要使用 Supabase 客戶端
                return f"supabase+client://{project_ref}"
            else:
                # 假設是 service_role key，可以直接連接 PostgreSQL
                return f"postgresql+asyncpg://postgres:{self.supabase_key}@db.{project_ref}.supabase.co:5432/postgres"
        else:
            # 使用本地資料庫
            return os.getenv(
                "DATABASE_URL",
                "postgresql+asyncpg://postgres:password@localhost:5432/studyscriber"
            )

    def get_client(self) -> Optional[Client]:
        """
        建立 Supabase 客戶端連接

        Returns:
            Optional[Client]: Supabase 客戶端實例，如果是本地模式則回傳 None
        """
        if self.is_configured():
            return create_client(self.supabase_url, self.supabase_key)
        return None

    def is_supabase_mode(self) -> bool:
        """檢查是否為 Supabase 模式"""
        return self.db_mode == "supabase"


# 全域配置實例
supabase_config = SupabaseConfig()

# 便利函式
def get_supabase_client() -> Client:
    """獲取 Supabase 客戶端實例"""
    client = supabase_config.get_client()
    if client is None:
        raise ValueError("Supabase 客戶端無法初始化，請檢查環境配置")
    return client
