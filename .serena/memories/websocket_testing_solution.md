# FastAPI WebSocket 測試解決方案

## 問題分析
- Integration 測試使用 `AsyncClient` 無法測試 WebSocket，因為 `AsyncClient` 沒有 `websocket_connect` 方法
- 需要使用 FastAPI 的 `TestClient` 來進行 WebSocket 測試

## 正確的 WebSocket 測試方法

### 1. 使用 FastAPI TestClient
```python
from fastapi.testclient import TestClient

# 不是 AsyncClient，而是同步的 TestClient
client = TestClient(app)

# WebSocket 測試語法
with client.websocket_connect("/ws/upload_audio") as websocket:
    # 發送訊息
    websocket.send_json({"type": "heartbeat"})
    
    # 接收訊息
    data = websocket.receive_json()
    assert data["type"] == "heartbeat_ack"
```

### 2. 混合測試策略
- HTTP API 測試：使用 `AsyncClient` (支援 async/await)
- WebSocket 測試：使用 `TestClient` (同步，支援 websocket_connect)

### 3. 測試架構
```python
@pytest.mark.asyncio
async def test_mixed_api_and_websocket(mock_supabase_globally):
    # 1. HTTP API 測試部分 - 使用 AsyncClient
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        response = await client.post("/api/session", json={"type": "recording", "title": "Test"})
        assert response.status_code == 201
        
    # 2. WebSocket 測試部分 - 使用 TestClient
    sync_client = TestClient(app)
    with sync_client.websocket_connect("/ws/upload_audio") as websocket:
        websocket.send_json({"type": "heartbeat"})
        data = websocket.receive_json()
        assert data["type"] == "heartbeat_ack"
```

## 關鍵重點
- FastAPI 官方建議：WebSocket 測試必須使用 `TestClient`
- `AsyncClient` 主要用於 HTTP API 測試
- WebSocket 測試是同步的，不需要 async/await
- 可以在同一個測試中混合使用兩種 client