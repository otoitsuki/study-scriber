#!/usr/bin/env python3
"""
簡單的 WebSocket 測試腳本

測試 transcript_feed WebSocket 端點是否正常工作
"""

import asyncio
import websockets
import json
import uuid
from datetime import datetime

async def test_websocket_connection():
    """測試 WebSocket 連接"""
    session_id = str(uuid.uuid4())
    uri = f"ws://localhost:8000/ws/transcript_feed/{session_id}"

    print(f"🔗 正在連接到: {uri}")
    print(f"📋 Session ID: {session_id}")

    try:
        # 設定連接超時為 10 秒
        async with websockets.connect(uri, ping_timeout=10, ping_interval=5) as websocket:
            print("✅ WebSocket 連接成功！")

            # 等待初始消息
            try:
                initial_message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"📥 收到初始訊息: {initial_message}")

                # 解析訊息
                try:
                    parsed = json.loads(initial_message)
                    if parsed.get('phase') == 'waiting':
                        print("✅ 收到正確的等待階段訊息")
                    else:
                        print(f"⚠️ 收到意外的訊息格式: {parsed}")
                except json.JSONDecodeError:
                    print(f"⚠️ 無法解析 JSON: {initial_message}")

            except asyncio.TimeoutError:
                print("⏰ 等待初始訊息超時")

            # 發送測試訊息
            test_message = json.dumps({
                "type": "test",
                "message": "Hello from client",
                "timestamp": datetime.now().isoformat()
            })

            await websocket.send(test_message)
            print(f"📤 發送測試訊息: {test_message}")

            # 保持連接一段時間
            print("⏳ 保持連接 5 秒...")
            await asyncio.sleep(5)

            print("✅ WebSocket 測試完成")

    except asyncio.TimeoutError:
        print("❌ WebSocket 連接超時")
        return False
    except websockets.exceptions.ConnectionClosed as e:
        print(f"❌ WebSocket 連接被關閉: {e}")
        return False
    except websockets.exceptions.InvalidURI:
        print("❌ 無效的 WebSocket URI")
        return False
    except Exception as e:
        print(f"❌ WebSocket 連接錯誤: {e}")
        return False

    return True

async def main():
    """主函數"""
    print("🚀 開始 WebSocket 連接測試...")
    print(f"⏰ 測試時間: {datetime.now().isoformat()}")
    print("-" * 50)

    success = await test_websocket_connection()

    print("-" * 50)
    if success:
        print("✅ WebSocket 測試成功！")
    else:
        print("❌ WebSocket 測試失敗！")

    return success

if __name__ == "__main__":
    try:
        result = asyncio.run(main())
        exit(0 if result else 1)
    except KeyboardInterrupt:
        print("\n⏹️ 測試被用戶中斷")
        exit(1)
    except Exception as e:
        print(f"\n💥 測試過程中發生未預期的錯誤: {e}")
        exit(1)
