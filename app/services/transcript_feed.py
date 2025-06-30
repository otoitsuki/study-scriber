"""
逐字稿 WebSocket 廣播服務 (簡化版 InMemoryHub)

維持 sid → set[WebSocket] 映射，支援多個客戶端連接
"""

import logging
import json
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class TranscriptHub:
    """
    逐字稿 WebSocket 廣播中心 (InMemoryHub 模式)

    功能：
    - 管理會話 ID 對應的 WebSocket 連接池
    - 支援一對多廣播
    - 自動清理斷開的連接
    """

    def __init__(self):
        """初始化廣播中心"""
        self._subscribers: Dict[str, Set[WebSocket]] = {}
        logger.info("🔌 TranscriptHub 初始化完成")

    async def subscribe(self, session_id: str, websocket: WebSocket):
        """
        訂閱會話的轉錄推送

        Args:
            session_id: 會話 ID
            websocket: WebSocket 連接
        """
        if session_id not in self._subscribers:
            self._subscribers[session_id] = set()

        self._subscribers[session_id].add(websocket)
        logger.info(f"📱 新訂閱者加入會話 {session_id} (目前訂閱者: {len(self._subscribers[session_id])})")

    async def unsubscribe(self, session_id: str, websocket: WebSocket):
        """
        取消訂閱

        Args:
            session_id: 會話 ID
            websocket: WebSocket 連接
        """
        if session_id in self._subscribers:
            self._subscribers[session_id].discard(websocket)

            # 如果沒有訂閱者了，清理會話記錄
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]
                logger.info(f"🗑️ 會話 {session_id} 無訂閱者，已清理")
            else:
                logger.info(f"📱 訂閱者離開會話 {session_id} (剩餘訂閱者: {len(self._subscribers[session_id])})")

    async def broadcast(self, session_id: str, message: dict):
        """
        廣播訊息到指定會話的所有訂閱者

        Args:
            session_id: 會話 ID
            message: 要廣播的訊息字典
        """
        if session_id not in self._subscribers:
            logger.debug(f"📡 會話 {session_id} 無訂閱者，跳過廣播")
            return

        # 獲取訂閱者副本，避免迭代時修改
        subscribers = self._subscribers[session_id].copy()
        successful_broadcasts = 0
        failed_connections = set()

        for websocket in subscribers:
            try:
                await websocket.send_json(message)
                successful_broadcasts += 1
            except Exception as e:
                logger.warning(f"⚠️ 廣播失敗，WebSocket 連接異常: {e}")
                failed_connections.add(websocket)

        # 清理失敗的連接
        if failed_connections:
            for failed_ws in failed_connections:
                await self.unsubscribe(session_id, failed_ws)

            logger.info(f"🗑️ 已清理 {len(failed_connections)} 個異常連接")

        if successful_broadcasts > 0:
            logger.debug(f"📡 成功廣播到會話 {session_id} ({successful_broadcasts} 個訂閱者)")

    async def broadcast_error(self, session_id: str, error_type: str, message: str, seq: int = None):
        """
        廣播錯誤訊息

        Args:
            session_id: 會話 ID
            error_type: 錯誤類型
            message: 錯誤訊息
            seq: 切片序號（可選）
        """
        error_message = {
            "type": "error",
            "error_type": error_type,
            "message": message,
            "session_id": session_id,
            "timestamp": self._get_timestamp()
        }

        if seq is not None:
            error_message["seq"] = seq

        await self.broadcast(session_id, error_message)
        logger.error(f"❌ 廣播錯誤到會話 {session_id}: {error_type} - {message}")

    async def broadcast_transcript_segment(self, session_id: str, seq: int, text: str, start_time: float = None, end_time: float = None, confidence: float = None):
        """
        廣播轉錄片段

        Args:
            session_id: 會話 ID
            seq: 切片序號
            text: 轉錄文字
            start_time: 開始時間（秒）
            end_time: 結束時間（秒）
            confidence: 信心度
        """
        transcript_message = {
            "type": "transcript_segment",
            "session_id": session_id,
            "seq": seq,
            "text": text,
            "timestamp": self._get_timestamp()
        }

        if start_time is not None:
            transcript_message["start_time"] = start_time

        if end_time is not None:
            transcript_message["end_time"] = end_time

        if confidence is not None:
            transcript_message["confidence"] = confidence

        await self.broadcast(session_id, transcript_message)
        logger.info(f"📝 廣播轉錄片段到會話 {session_id} seq={seq}: '{text[:50]}{'...' if len(text) > 50 else ''}'")

    async def broadcast_phase(self, session_id: str, phase: str):
        """
        廣播階段變更

        Args:
            session_id: 會話 ID
            phase: 階段名稱 (waiting, active, processing, completed)
        """
        phase_message = {
            "type": "phase",
            "phase": phase,
            "session_id": session_id,
            "timestamp": self._get_timestamp()
        }

        await self.broadcast(session_id, phase_message)
        logger.info(f"🔄 廣播階段變更到會話 {session_id}: {phase}")

    def get_subscriber_count(self, session_id: str) -> int:
        """
        獲取指定會話的訂閱者數量

        Args:
            session_id: 會話 ID

        Returns:
            int: 訂閱者數量
        """
        return len(self._subscribers.get(session_id, set()))

    def get_total_subscribers(self) -> int:
        """
        獲取總訂閱者數量

        Returns:
            int: 總訂閱者數量
        """
        return sum(len(subscribers) for subscribers in self._subscribers.values())

    def get_active_sessions(self) -> list:
        """
        獲取有訂閱者的活躍會話 ID 列表

        Returns:
            list: 活躍會話 ID 列表
        """
        return list(self._subscribers.keys())

    def _get_timestamp(self) -> str:
        """獲取當前時間戳"""
        from datetime import datetime
        return datetime.utcnow().isoformat()

    async def cleanup_session(self, session_id: str):
        """
        清理指定會話的所有連接

        Args:
            session_id: 會話 ID
        """
        if session_id in self._subscribers:
            subscribers = self._subscribers[session_id].copy()
            for websocket in subscribers:
                try:
                    await websocket.close()
                except:
                    pass  # 忽略關閉時的錯誤

            del self._subscribers[session_id]
            logger.info(f"🗑️ 已清理會話 {session_id} 的所有連接 ({len(subscribers)} 個)")


# 全域 Hub 實例
transcript_hub = TranscriptHub()


def get_transcript_hub() -> TranscriptHub:
    """獲取全域轉錄廣播中心實例"""
    return transcript_hub
