#!/usr/bin/env python3
"""
簡單的 WebSocket 測試工具
直接發送逐字稿訊息到指定 session
"""

import asyncio
import json
import websockets
import sys
from datetime import datetime

async def send_simple_transcript(session_id: str):
    """發送簡單的逐字稿訊息"""

    # 連接到 transcript feed WebSocket
    uri = f"ws://localhost:8000/ws/transcript_feed/{session_id}"

    print(f"🔗 連接到: {uri}")

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ WebSocket 連接成功")

            # 等待連接建立
            await asyncio.sleep(1)

            # 發送測試逐字稿
            test_message = {
                "type": "transcript_segment",
                "session_id": session_id,
                "segment_id": "test_001",
                "text": "這是一個測試逐字稿訊息",
                "start_time": 0.0,
                "end_time": 3.0,
                "language": "zh-TW",
                "confidence": 0.95,
                "start_sequence": 1,
                "end_sequence": 1
            }

            print(f"📤 發送訊息: {test_message['text']}")
            await websocket.send(json.dumps(test_message))

            # 等待 2 秒
            await asyncio.sleep(2)

            # 發送第二個訊息
            test_message2 = {
                "type": "transcript_segment",
                "session_id": session_id,
                "segment_id": "test_002",
                "text": "第二段測試文字",
                "start_time": 3.0,
                "end_time": 6.0,
                "language": "zh-TW",
                "confidence": 0.93,
                "start_sequence": 2,
                "end_sequence": 2
            }

            print(f"📤 發送訊息: {test_message2['text']}")
            await websocket.send(json.dumps(test_message2))

            # 等待一段時間
            await asyncio.sleep(3)

            print("✅ 測試完成")

    except Exception as e:
        print(f"❌ 錯誤: {e}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("用法: python test/simple_websocket_test.py <session_id>")
        sys.exit(1)

    session_id = sys.argv[1]
    print(f"🎯 測試 Session ID: {session_id}")

    asyncio.run(send_simple_transcript(session_id))
