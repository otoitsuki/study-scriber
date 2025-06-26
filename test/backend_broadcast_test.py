import asyncio
import websockets
import json
import sys
import threading
import time
from uuid import uuid4

# 測試用的 Session ID
SESSION_ID = str(uuid4())

async def listener(uri):
    """
    監聽者：連接到 WebSocket 並等待接收訊息。
    """
    try:
        async with websockets.connect(uri) as websocket:
            print(f"[Listener] Connected to {uri}")
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                print(f"[Listener] Received message: {message}")
            except asyncio.TimeoutError:
                print("[Listener] Timed out waiting for a message.")
    except Exception as e:
        print(f"[Listener] Error: {e}")

def run_listener_in_thread(uri):
    """在新執行緒中運行監聽者"""
    asyncio.run(listener(uri))

async def sender(uri):
    """
    發送者：連接，發送一條訊息，然後斷開。
    """
    try:
        async with websockets.connect(uri) as websocket:
            print(f"[Sender] Connected to {uri}")
            test_message = {
                "type": "transcript_segment",
                "text": "Hello from the broadcast test!",
                "start_time": 0,
                "end_time": 1,
                "timestamp": time.time()
            }
            await websocket.send(json.dumps(test_message))
            print(f"[Sender] Sent message: {test_message['text']}")
            # 短暫等待以確保伺服器處理了訊息
            await asyncio.sleep(1)
    except Exception as e:
        print(f"[Sender] Error: {e}")

def main():
    """
    主函數：協調監聽者和發送者。
    """
    if len(sys.argv) > 1:
        session_id = sys.argv[1]
        print(f"Using provided Session ID: {session_id}")
    else:
        session_id = SESSION_ID
        print(f"Using generated Session ID: {session_id}")

    uri = f"ws://localhost:8000/ws/transcript_feed/{session_id}"

    # 在背景執行緒中啟動監聽者
    listener_thread = threading.Thread(target=run_listener_in_thread, args=(uri,))
    listener_thread.start()

    # 給監聽者一點時間去連接
    print("[Main] Waiting for listener to connect...")
    time.sleep(3)

    # 在主執行緒中運行發送者
    print("[Main] Starting sender...")
    asyncio.run(sender(uri))

    # 等待監聽者執行緒結束
    listener_thread.join()
    print("[Main] Test finished.")

if __name__ == "__main__":
    main()
