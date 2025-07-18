"""
StudyScriber 匯出工具模組

包含匯出相關的共用函數和工具
"""

from datetime import datetime
from uuid import UUID
from typing import Optional


def format_export_filename(session_id: UUID, stt_provider: Optional[str], created_at: str) -> str:
    """
    建立匯出檔名格式: studyscriber_{provider}_{YYYYMMDD}_{last4digits}.zip

    Args:
        session_id: Session UUID
        stt_provider: STT 提供者名稱 (whisper, gemini, gpt4o) 或 None
        created_at: Session 建立時間的 ISO 字串

    Returns:
        格式化的檔名字串
    """
    # 轉換日期格式為 YYYYMMDD
    try:
        # 處理不同可能的日期格式
        if 'T' in created_at:
            # ISO 格式: 2024-07-18T12:30:00.000Z
            dt = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        else:
            # 其他格式嘗試
            dt = datetime.fromisoformat(created_at)
        date_str = dt.strftime('%Y%m%d')
    except (ValueError, TypeError):
        # 如果日期解析失敗，使用當前日期
        date_str = datetime.now().strftime('%Y%m%d')

    # 取得 session ID 的最後4碼
    session_str = str(session_id).replace('-', '')
    last4_digits = session_str[-4:]

    # 處理 stt_provider 為 None 的情況
    provider = stt_provider or 'whisper'

    return f"studyscriber_{provider}_{date_str}_{last4_digits}.zip"
