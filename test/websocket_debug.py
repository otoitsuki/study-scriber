#!/usr/bin/env python3
"""
WebSocket 除錯工具
快速檢測 WebSocket 推送問題
"""

import asyncio
import json
import websockets
import sys
from datetime import datetime

async def test_websocket_endpoint(session_id: str, base_url: str = "ws://localhost:8000"):
    """測試 WebSocket 端點是否可用"""
    uri = f"{base_url}/ws/transcript_feed/{session_id}"

    print(f"🔗 測試連接: {uri}")

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ WebSocket 連接成功")

            # 發送測試訊息
            test_message = {
                "type": "transcript_segment",
                "session_id": session_id,
                "segment_id": "test_001",
                "text": "這是一個測試訊息",
                "start_time": 0.0,
                "end_time": 5.0,
                "language": "zh-TW",
                "confidence": 0.95,
                "timestamp": datetime.now().isoformat()
            }

            await websocket.send(json.dumps(test_message))
            print("📤 發送測試訊息")

            # 等待 2 秒
            await asyncio.sleep(2)

            # 發送完成訊息
            complete_message = {
                "type": "transcript_complete",
                "session_id": session_id,
                "message": "測試完成",
                "timestamp": datetime.now().isoformat()
            }

            await websocket.send(json.dumps(complete_message))
            print("📤 發送完成訊息")

            print("✅ 測試完成，請檢查前端是否收到訊息")

    except Exception as e:
        print(f"❌ 連接失敗: {e}")
        return False

    return True

def main():
    if len(sys.argv) < 2:
        print("使用方法: python test/websocket_debug.py <session_id>")
        print("範例: python test/websocket_debug.py 12345678-1234-1234-1234-123456789abc")
        return

    session_id = sys.argv[1]
    print(f"🎯 測試 Session ID: {session_id}")

    asyncio.run(test_websocket_endpoint(session_id))

if __name__ == "__main__":
    main()
