import asyncio
import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, List

logger = logging.getLogger(__name__)
router = APIRouter()

class ConnectionManager:
    def __init__(self):
        # 將活躍連接儲存在字典中，以 session_id 為鍵
        self.active_connections: Dict[str, List[WebSocket]] = {}
        logger.info("ConnectionManager (In-Memory) 已初始化")

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)
        logger.info(f"WebSocket 客戶端已連接到 session_id: {session_id}。目前該 session 有 {len(self.active_connections[session_id])} 個連接。")

    def disconnect(self, websocket: WebSocket, session_id: str):
        if session_id in self.active_connections:
            try:
                self.active_connections[session_id].remove(websocket)
                logger.info(f"WebSocket 客戶端已從 session_id: {session_id} 斷開。")
                if not self.active_connections[session_id]:
                    del self.active_connections[session_id]
                    logger.info(f"Session_id: {session_id} 已無連接，從管理器中移除。")
            except ValueError:
                logger.warning(f"嘗試斷開一個不存在於 session_id: {session_id} 的 WebSocket 連接。")
        else:
            logger.warning(f"嘗試從一個不存在的 session_id: {session_id} 斷開連接。")

    async def broadcast(self, message: str, session_id: str):
        if session_id in self.active_connections and self.active_connections[session_id]:
            client_count = len(self.active_connections[session_id])
            logger.info(f"📡 [ConnectionManager] 正在向 session_id: {session_id} 的 {client_count} 個客戶端廣播訊息")

            # 記錄訊息內容（簡化版）
            try:
                import json
                parsed_msg = json.loads(message)
                msg_type = parsed_msg.get('type', parsed_msg.get('phase', 'unknown'))
                logger.info(f"📡 [ConnectionManager] 訊息類型: {msg_type}")
                if 'text' in parsed_msg:
                    text_preview = parsed_msg['text'][:30] + ('...' if len(parsed_msg['text']) > 30 else '')
                    logger.info(f"📡 [ConnectionManager] 文字預覽: '{text_preview}'")
            except:
                logger.info(f"📡 [ConnectionManager] 原始訊息: {message[:100]}...")

            # 建立一個任務列表以併發發送
            tasks = [connection.send_text(message) for connection in self.active_connections[session_id]]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # 檢查發送結果
            success_count = sum(1 for r in results if not isinstance(r, Exception))
            error_count = len(results) - success_count

            if error_count > 0:
                logger.warning(f"📡 [ConnectionManager] 廣播結果: {success_count} 成功, {error_count} 失敗")
                for i, result in enumerate(results):
                    if isinstance(result, Exception):
                        logger.error(f"📡 [ConnectionManager] 客戶端 {i} 發送失敗: {result}")
            else:
                logger.info(f"✅ [ConnectionManager] 廣播成功: 所有 {client_count} 個客戶端都收到訊息")
        else:
            logger.warning(f"⚠️ [ConnectionManager] 廣播失敗：找不到 session_id: {session_id} 的活躍連接")
            logger.info(f"📊 [ConnectionManager] 目前活躍 sessions: {list(self.active_connections.keys())}")

# 建立一個全域的 ConnectionManager 實例
manager = ConnectionManager()

@router.websocket("/ws/transcript_feed/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    用於接收即時逐字稿的 WebSocket 端點。

    - 每个 session_id 建立一個獨立的廣播頻道。
    - 客戶端連接後，會加入對應 session_id 的頻道並監聽訊息。
    - 後端轉錄服務完成後，會將結果發布到此頻道。
    """
    await manager.connect(websocket, session_id)
    # 新增：告知前端等待階段
    await websocket.send_text(json.dumps({"phase": "waiting"}))
    try:
        # 保持連線開啟以接收廣播
        while True:
            # 這個迴圈主要是為了維持連線狀態，
            # receive_text() 會等待客戶端發送訊息。
            # 我們可以設定一個 timeout 來定期檢查連線或進行清理。
            await websocket.receive_text()

    except WebSocketDisconnect:
        logger.info(f"WebSocket for session {session_id} 主動斷開連接。")
        manager.disconnect(websocket, session_id)
    except Exception as e:
        logger.error(f"WebSocket for session {session_id} 發生意外錯誤: {e}")
        manager.disconnect(websocket, session_id)