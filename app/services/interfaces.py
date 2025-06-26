"""
服務介面定義
"""
from abc import ABC, abstractmethod
from uuid import UUID

class TranscriptionService(ABC):
    """轉錄服務的抽象基礎類別"""

    @abstractmethod
    async def process_audio_chunk(self, session_id: UUID, chunk_sequence: int, webm_data: bytes):
        """處理一個音訊切片"""
        pass

    @abstractmethod
    async def shutdown(self):
        """優雅地關閉服務"""
        pass
