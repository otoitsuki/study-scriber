#!/usr/bin/env python3
"""
執行資料庫遷移：添加 audio_files 表的處理狀態欄位
"""

import asyncio
from app.db.database import get_supabase_client
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_migration():
    """執行資料庫遷移"""
    try:
        logger.info("🚀 開始執行資料庫遷移...")
        supabase = get_supabase_client()
        
        # 讀取遷移 SQL
        with open('migration_add_processing_status.sql', 'r', encoding='utf-8') as f:
            migration_sql = f.read()
        
        # 分割並執行 SQL 語句
        sql_statements = [stmt.strip() for stmt in migration_sql.split(';') if stmt.strip() and not stmt.strip().startswith('--')]
        
        success_count = 0
        for i, statement in enumerate(sql_statements, 1):
            try:
                logger.info(f"📝 執行第 {i} 條語句...")
                # 使用 rpc 來執行 DDL 語句
                result = supabase.rpc('exec_sql', {'sql': statement}).execute()
                success_count += 1
                logger.info(f"✅ 語句 {i} 執行成功")
            except Exception as e:
                logger.error(f"❌ 語句 {i} 執行失敗: {e}")
                logger.info(f"失敗的語句: {statement[:100]}...")
                
                # 如果是已存在欄位的錯誤，可以忽略
                if 'already exists' in str(e) or 'IF NOT EXISTS' in statement:
                    logger.info("⚠️ 欄位已存在，跳過此語句")
                    success_count += 1
                else:
                    raise
        
        logger.info(f"🎉 遷移完成！成功執行 {success_count}/{len(sql_statements)} 條語句")
        
        # 驗證遷移結果
        try:
            # 測試查詢新欄位
            test_result = supabase.table('audio_files').select('processing_status').limit(1).execute()
            logger.info("✅ 遷移驗證成功：processing_status 欄位可正常查詢")
        except Exception as e:
            logger.error(f"❌ 遷移驗證失敗: {e}")
            
    except Exception as e:
        logger.error(f"💥 遷移過程發生錯誤: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(run_migration())