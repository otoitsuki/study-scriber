"""
資料庫相容性工具
提供向後相容的資料庫操作，優雅處理欄位不存在的情況
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional
from supabase import Client

logger = logging.getLogger(__name__)

def safe_insert_audio_file(supabase: Client, basic_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    安全插入音檔記錄，自動降級到相容模式
    
    Args:
        supabase: Supabase 客戶端
        basic_data: 基本音檔資料（必須包含所有必要欄位）
    
    Returns:
        插入成功的記錄資料
    """
    try:
        # 嘗試使用增強格式（包含處理狀態欄位）
        enhanced_data = basic_data.copy()
        enhanced_data.update({
            "processing_status": "uploaded",
            "updated_at": datetime.utcnow().isoformat()
        })
        
        response = supabase.table("audio_files").insert(enhanced_data).execute()
        logger.debug("✅ 使用增強格式插入音檔記錄")
        return response
        
    except Exception as enhanced_error:
        logger.debug(f"⚠️ 增強格式插入失敗，降級使用基本格式: {enhanced_error}")
        
        # 降級使用基本格式
        response = supabase.table("audio_files").insert(basic_data).execute()
        logger.debug("✅ 使用基本格式插入音檔記錄")
        return response

def safe_update_processing_status(
    supabase: Client, 
    session_id: str, 
    chunk_sequence: int, 
    status: str,
    error_message: Optional[str] = None
) -> bool:
    """
    安全更新音檔處理狀態，如果欄位不存在則靜默跳過
    
    Args:
        supabase: Supabase 客戶端
        session_id: 會話 ID
        chunk_sequence: 切片序號
        status: 處理狀態 ('uploaded', 'transcribing', 'completed', 'failed')
        error_message: 錯誤訊息（當 status='failed' 時）
    
    Returns:
        True 如果更新成功，False 如果降級處理
    """
    try:
        update_data = {
            "processing_status": status,
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # 根據狀態添加相應的時間戳
        if status == "transcribing":
            update_data["transcription_started_at"] = datetime.utcnow().isoformat()
        elif status in ["completed", "failed"]:
            update_data["transcription_completed_at"] = datetime.utcnow().isoformat()
            
        if error_message and status == "failed":
            update_data["error_message"] = error_message
        
        supabase.table("audio_files").update(update_data)\
            .eq("session_id", session_id)\
            .eq("chunk_sequence", chunk_sequence)\
            .execute()
            
        logger.debug(f"✅ 更新切片 {session_id}/{chunk_sequence} 狀態為 {status}")
        return True
        
    except Exception as update_error:
        logger.debug(f"⚠️ 無法更新處理狀態（可能欄位不存在）: {update_error}")
        return False

def safe_cleanup_transcribing_segments(supabase: Client) -> int:
    """
    安全清理正在轉錄的切片，如果欄位不存在則跳過
    
    Args:
        supabase: Supabase 客戶端
        
    Returns:
        清理的記錄數量，-1 表示欄位不存在
    """
    try:
        # 查詢正在轉錄的切片
        response = supabase.table("audio_files")\
            .select("id, session_id, chunk_sequence")\
            .eq("processing_status", "transcribing")\
            .execute()
        
        if response.data:
            count = len(response.data)
            logger.info(f"🎵 發現 {count} 個正在轉錄的音檔切片，正在重置...")
            
            # 將它們標記為失敗狀態
            supabase.table("audio_files").update({
                "processing_status": "failed",
                "error_message": "Processing interrupted by server restart",
                "updated_at": datetime.utcnow().isoformat()
            }).eq("processing_status", "transcribing").execute()
            
            logger.info(f"✅ 成功重置 {count} 個音檔切片的處理狀態")
            return count
        else:
            logger.info("✨ 沒有發現正在處理的音檔切片")
            return 0
            
    except Exception as cleanup_error:
        logger.debug(f"⚠️ 無法清理音檔處理狀態（可能欄位不存在）: {cleanup_error}")
        return -1

def check_processing_status_support(supabase: Client) -> bool:
    """
    檢查資料庫是否支援處理狀態欄位
    
    Args:
        supabase: Supabase 客戶端
        
    Returns:
        True 如果支援，False 如果不支援
    """
    try:
        # 嘗試查詢處理狀態欄位
        supabase.table("audio_files").select("processing_status").limit(1).execute()
        return True
    except Exception:
        return False