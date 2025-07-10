from __future__ import annotations

import abc
from typing import Dict, Any
from uuid import UUID


class ISTTProvider(abc.ABC):
    """語音轉文字 Provider 介面。所有轉錄服務需實作此介面。"""

    @abc.abstractmethod
    async def transcribe(self, webm: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any]:
        """轉錄指定 WebM 音訊。

        Args:
            webm: 原始 WebM 音訊二進位資料。
            session_id: 會話 ID。
            chunk_seq: 切片序號。

        Returns:
            dict: 需包含 text, start_offset, end_offset 等欄位，前端保持一致。"""

    @abc.abstractmethod
    def name(self) -> str:
        """回傳 Provider 名稱 (例如 'whisper', 'gemini')"""

    @abc.abstractmethod
    def max_rpm(self) -> int:
        """API 速率限制：每分鐘最大請求數 (RateLimiter 用)"""
