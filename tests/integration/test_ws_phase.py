import os
import pytest
import uuid
from datetime import datetime
from unittest.mock import MagicMock, patch
from httpx import AsyncClient
from fastapi.testclient import TestClient
from starlette.testclient import TestClient as StarletteTestClient
from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute, Route
from starlette.testclient import WebSocketTestSession
from httpx import ASGITransport

# 設置測試環境變數，避免真實 Supabase 連線
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_KEY"] = "test_key"
os.environ["DB_MODE"] = "supabase"

from main import app

@pytest.fixture(autouse=True)
def mock_supabase_globally():
    """全域 mock Supabase，確保在 app 初始化前就生效"""
    with patch('app.db.supabase_config.create_client') as mock_create_client:
        mock_client = MagicMock()
        mock_create_client.return_value = mock_client
        yield mock_client

@pytest.mark.asyncio
async def test_ws_phase_messages(mock_supabase_globally):
    session_id = "7025232d-a297-4b58-a478-3e80ecdefe47"  # 合法 UUID
    session_uuid = uuid.UUID(session_id)
    now_dt = datetime(2024, 1, 1, 0, 0, 0)
    # sessions table mock
    sessions_table = MagicMock()
    sessions_table.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    sessions_table.insert.return_value.execute.return_value.data = [{
        "id": session_uuid,
        "title": "Phase Test",
        "type": "recording",
        "status": "active",
        "language": "zh-TW",
        "created_at": now_dt,
        "updated_at": now_dt,
        "completed_at": None
    }]
    sessions_table.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
        'id': session_uuid, 'status': 'active', 'type': 'recording',
        'title': "Phase Test", 'language': 'zh-TW',
        'created_at': now_dt, 'updated_at': now_dt, 'completed_at': None
    }

    # notes table mock
    notes_table = MagicMock()
    notes_table.insert.return_value.execute.return_value.data = [{
        "session_id": session_uuid,
        "content": "",
        "updated_at": now_dt,
        "client_ts": None
    }]
    notes_table.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{
        "session_id": session_uuid,
        "content": "",
        "updated_at": now_dt,
        "client_ts": None
    }]

    def table_side_effect(name):
        if name == "sessions":
            return sessions_table
        elif name == "notes":
            return notes_table
        else:
            return MagicMock()

    mock_supabase_globally.table.side_effect = table_side_effect

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Create a session
        response = await client.post("/api/session", json={"type": "recording", "title": "Phase Test"})
        if response.status_code != 201:
            print(f"Error response: {response.status_code}")
            print(f"Response content: {response.content}")
            print(f"Response text: {response.text}")
        assert response.status_code == 201
        session_data = response.json()
        assert session_data['title'] == "Phase Test"
        assert session_data['type'] == "recording"
        assert session_data['status'] == "active"

        # 2. WebSocket 測試部分 - 使用 FastAPI TestClient
        sync_client = TestClient(app)
        
        # 測試 WebSocket 連線和基本訊息 (需要 session_id 路徑參數)
        with sync_client.websocket_connect(f"/ws/upload_audio/{session_id}") as websocket:
            # 1. 首先應該收到 connection_established 訊息
            response = websocket.receive_json()
            assert response["type"] == "connection_established"
            assert response["session_id"] == session_id
            
            # 2. 測試 heartbeat 訊息
            websocket.send_json({"type": "heartbeat"})
            response = websocket.receive_json()
            assert response["type"] == "heartbeat_ack"
            
            # 3. 測試 upload_complete 訊息
            websocket.send_json({
                "type": "upload_complete", 
                "session_id": session_id,
                "total_chunks": 1
            })
            
            # 會先收到 all_chunks_received
            response = websocket.receive_json()
            assert response["type"] == "all_chunks_received"
            
            # 然後收到 upload_complete_ack
            response = websocket.receive_json()
            assert response["type"] == "upload_complete_ack"
            assert response["total_chunks"] == 0  # 因為沒有實際上傳切片
            
        print("✅ Session creation and WebSocket tests passed!")
