#!/usr/bin/env python3
"""
WebSocket 推送測試工具
用於測試後端是否正確推送逐字稿到前端
使用方法：在前端應用程式開啟錄音後，執行此腳本推送測試逐字稿
"""

import asyncio
import json
import websockets
from datetime import datetime
from typing import Dict, Any
import sys
import os

# 添加項目根目錄到 Python 路徑
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

class WebSocketPushTester:
    """WebSocket 推送測試器"""

    def __init__(self, base_url: str = "ws://localhost:8000"):
        self.base_url = base_url

    def create_test_transcript_message(self, segment_id: int, text: str, session_id: str) -> Dict[str, Any]:
        """建立測試逐字稿訊息"""
        return {
            "type": "transcript_segment",
            "session_id": session_id,
            "segment_id": f"seg_{segment_id:04d}",
            "text": text,
            "start_sequence": segment_id * 3,
            "end_sequence": (segment_id + 1) * 3 - 1,
            "start_time": segment_id * 10.0,
            "end_time": (segment_id + 1) * 10.0,
            "language": "zh-TW",
            "confidence": 0.95,
            "timestamp": datetime.now().isoformat()
        }

    def create_test_complete_message(self, session_id: str) -> Dict[str, Any]:
        """建立測試完成訊息"""
        return {
            "type": "transcript_complete",
            "session_id": session_id,
            "message": "轉錄完成",
            "timestamp": datetime.now().isoformat()
        }

    async def push_test_transcripts(self, session_id: str):
        """推送測試逐字稿到指定 session"""
        try:
            uri = f"{self.base_url}/ws/transcript_feed/{session_id}"
            print(f"🔗 連接到逐字稿 WebSocket: {uri}")

            # 測試逐字稿片段
            test_segments = [
                "歡迎使用 StudyScriber 雲端筆記應用程式",
                "這是一個支援即時語音轉錄的智慧筆記工具",
                "我們正在測試 WebSocket 推送功能是否正常運作",
                "如果你能在前端看到這些文字，表示推送功能正常",
                "接下來會測試更長的逐字稿內容",
                "包含標點符號、數字 123 和英文 Hello World",
                "最後我們會發送轉錄完成的訊息"
            ]

            async with websockets.connect(uri) as websocket:
                print("✅ WebSocket 連接成功")
                print("📤 開始推送測試逐字稿...")
                print("💡 請在前端應用程式中觀察是否收到逐字稿")
                print("-" * 50)

                # 發送測試逐字稿片段
                for i, text in enumerate(test_segments):
                    message = self.create_test_transcript_message(i + 1, text, session_id)
                    await websocket.send(json.dumps(message))
                    print(f"📤 [{i+1}/{len(test_segments)}] {text}")

                    # 等待一下模擬真實情況
                    await asyncio.sleep(3)

                print("-" * 50)

                # 發送完成訊息
                complete_message = self.create_test_complete_message(session_id)
                await websocket.send(json.dumps(complete_message))
                print("📤 發送轉錄完成訊息")

                print("✅ 所有測試訊息發送完成")
                print("💡 請檢查前端是否顯示完整逐字稿並轉為 finished 狀態")

        except Exception as e:
            print(f"❌ 推送測試失敗: {e}")
            print("💡 請確認:")
            print("   1. FastAPI 後端正在運行")
            print("   2. Session ID 正確")
            print("   3. WebSocket 端點可用")

def print_usage():
    """印出使用說明"""
    print("""
🧪 WebSocket 推送測試工具使用說明

📋 測試步驟:
1. 啟動後端服務: uv run python main.py
2. 開啟前端應用程式: http://localhost:3000
3. 在前端建立錄音 session (點擊錄音按鈕)
4. 從瀏覽器開發者工具的 Network 或 Console 中找到 session_id
5. 執行此測試腳本推送逐字稿

💻 執行命令:
   python test/websocket_push_test.py <session_id>

📝 範例:
   python test/websocket_push_test.py 12345678-1234-1234-1234-123456789abc

🔍 觀察重點:
- 前端 RecordingState 組件是否顯示逐字稿
- 逐字稿是否按順序出現
- 收到 transcript_complete 後是否轉為 finished 狀態
- 瀏覽器 Console 是否有錯誤訊息
""")

async def main():
    """主函數"""
    if len(sys.argv) < 2:
        print("❌ 請提供 session_id")
        print_usage()
        return

    session_id = sys.argv[1]

    # 驗證 session_id 格式
    if len(session_id) < 10:
        print("⚠️ Session ID 看起來不正確，但仍然嘗試...")

    print(f"🎯 目標 Session ID: {session_id}")
    print("📱 請確保前端應用程式已開啟該 session 的錄音畫面")

    # 等待用戶確認
    input("按 Enter 開始推送測試逐字稿...")

    tester = WebSocketPushTester()
    await tester.push_test_transcripts(session_id)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n⛔ 測試被用戶中斷")
    except Exception as e:
        print(f"\n❌ 測試執行錯誤: {e}")
        print_usage()
