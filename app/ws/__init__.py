"""
WebSocket 模組

提供即時音訊上傳和逐字稿推送功能
"""

"""app.ws package 初始化檔

避免在 import 時造成循環依賴，暫不主動載入 upload_audio。需要時請直接從 `app.ws.upload_audio` 導入目標。"""

__all__ = []
