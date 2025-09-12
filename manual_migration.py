#!/usr/bin/env python3
"""
手動為現有的 audio_files 記錄設置預設值
由於 Supabase REST API 無法執行 DDL，需要在 Supabase Dashboard 手動添加欄位後再執行此腳本
"""

import asyncio
from app.db.database import get_supabase_client
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def update_existing_records():
    """為現有記錄設置預設的處理狀態"""
    try:
        logger.info("🔄 開始更新現有 audio_files 記錄...")
        supabase = get_supabase_client()
        
        # 查詢所有現有的音檔記錄
        response = supabase.table('audio_files').select('id, session_id, chunk_sequence, created_at').execute()
        
        if response.data:
            records_count = len(response.data)
            logger.info(f"📋 找到 {records_count} 筆現有記錄，開始更新...")
            
            updated_count = 0
            for record in response.data:
                try:
                    # 將現有記錄設為已完成狀態（避免重新處理）
                    update_data = {
                        'processing_status': 'completed',
                        'transcription_completed_at': record['created_at'],
                        'updated_at': datetime.utcnow().isoformat()
                    }
                    
                    supabase.table('audio_files').update(update_data).eq('id', record['id']).execute()
                    updated_count += 1
                    
                    if updated_count % 10 == 0:
                        logger.info(f"🔄 已更新 {updated_count}/{records_count} 筆記錄")
                        
                except Exception as e:
                    logger.error(f"❌ 更新記錄 {record['id']} 失敗: {e}")
            
            logger.info(f"✅ 成功更新 {updated_count} 筆記錄")
        else:
            logger.info("✨ 沒有找到現有記錄需要更新")
            
    except Exception as e:
        logger.error(f"💥 更新過程發生錯誤: {e}")
        raise

async def test_new_columns():
    """測試新欄位是否可用"""
    try:
        logger.info("🧪 測試新欄位...")
        supabase = get_supabase_client()
        
        # 嘗試查詢新欄位
        response = supabase.table('audio_files').select('processing_status, error_message, transcription_started_at, transcription_completed_at, updated_at').limit(1).execute()
        logger.info("✅ 新欄位測試成功")
        
    except Exception as e:
        logger.error(f"❌ 新欄位測試失敗: {e}")
        logger.info("請確保已在 Supabase Dashboard 中手動添加以下欄位：")
        logger.info("- processing_status (text, default: 'uploaded')")
        logger.info("- error_message (text, nullable)")
        logger.info("- transcription_started_at (timestamptz, nullable)")
        logger.info("- transcription_completed_at (timestamptz, nullable)")
        logger.info("- updated_at (timestamptz, default: now())")
        raise

if __name__ == "__main__":
    async def main():
        await test_new_columns()
        await update_existing_records()
    
    asyncio.run(main())