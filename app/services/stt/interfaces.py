"""
服務介面定義
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Any, Dict
from uuid import UUID


# ──────────────────────────────────────────────
# 1️⃣ 舊的 TranscriptionService（若別處還在用）
# ──────────────────────────────────────────────
class TranscriptionService(ABC):
    """轉錄服務抽象基礎類（舊）"""

    @abstractmethod
    async def process_audio_chunk(
        self, session_id: UUID, chunk_sequence: int, webm_data: bytes
    ) -> None:
        """處理一個音訊切片"""
        raise NotImplementedError

    @abstractmethod
    async def shutdown(self) -> None:
        """優雅地關閉服務"""
        raise NotImplementedError


# ──────────────────────────────────────────────
# 2️⃣ 新的 ISTTProvider：factory 與各 provider 使用
# ──────────────────────────────────────────────
class ISTTProvider(ABC):
    """
    Speech-to-Text Provider 介面。

    每個 provider（Whisper/GPT-4o/Gemini…）都要實作 `transcribe`。
    """

    # provider 的識別碼
    name: str  # 直接屬性，禁止再定義同名方法

    @abstractmethod
    async def transcribe(
        self, audio: bytes, session_id: UUID, chunk_seq: int
    ) -> Dict[str, Any] | None:
        """
        :param audio: 10s WebM/WAV bytes
        :return: 統一欄位 dict，若 `None` 代表無文字
        """
        raise NotImplementedError

    # 可選：每分鐘最大請求數，給排程器參考
    def max_rpm(self) -> int:
        return 60


__all__ = ["ISTTProvider", "TranscriptionService"]
