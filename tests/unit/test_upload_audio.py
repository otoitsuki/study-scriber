"""
測試音檔上傳 WebSocket 服務

測試「一段一轉」架構的音檔上傳和即時處理邏輯
"""

import asyncio
import json
import struct
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID

import pytest
from fastapi import WebSocketDisconnect
from fastapi import HTTPException

from app.ws.upload_audio import AudioUploadManager

@pytest.fixture
def mock_websocket():
    """一個功能更完整的 WebSocket mock"""
    ws = AsyncMock()
    ws.receive = AsyncMock()
    ws.send_text = AsyncMock()
    ws.send_bytes = AsyncMock()
    ws.close = AsyncMock()
    # 模擬 accept() 協程
    ws.accept = AsyncMock()
    return ws


class TestAudioUploadManager:
    """測試音檔上傳管理器"""

    @pytest.fixture
    def manager(self, mock_websocket, session_id, mock_supabase_client):
        """建立測試用的上傳管理器"""
        m = AudioUploadManager(
            websocket=mock_websocket,
            session_id=session_id,
            supabase_client=mock_supabase_client
        )
        # 手動 patch r2_client 因為 get_r2_client 不容易 mock
        m.r2_client = AsyncMock()
        return m

    def test_init(self, mock_websocket, session_id, mock_supabase_client):
        """測試管理器初始化"""
        manager = AudioUploadManager(
            websocket=mock_websocket,
            session_id=session_id,
            supabase_client=mock_supabase_client
        )
        assert manager.websocket == mock_websocket
        assert manager.session_id == session_id
        assert manager.supabase_client == mock_supabase_client
        assert manager.is_connected is False
        assert manager.received_chunks == set()
        assert manager.upload_tasks == {}
        assert manager.last_heartbeat is not None

    @pytest.mark.asyncio
    async def test_initialize_received_chunks_success(self, manager):
        """測試成功初始化已收到的切片"""
        mock_response = Mock()
        mock_response.data = [{'chunk_sequence': i} for i in range(3)]
        manager.supabase_client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response
        await manager._initialize_received_chunks()
        assert manager.received_chunks == {0, 1, 2}

    @pytest.mark.asyncio
    async def test_initialize_received_chunks_empty(self, manager):
        """測試初始化空的切片列表"""
        mock_response = Mock()
        mock_response.data = []
        manager.supabase_client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response

        await manager._initialize_received_chunks()

        assert manager.received_chunks == set()

    @pytest.mark.asyncio
    async def test_initialize_received_chunks_error(self, manager):
        """測試初始化時的錯誤處理"""
        manager.supabase_client.table.side_effect = Exception("Database error")

        await manager._initialize_received_chunks()

        # 錯誤時應該使用空集合
        assert manager.received_chunks == set()

    @pytest.mark.asyncio
    async def test_validate_session_success(self, manager):
        """測試成功的會話驗證"""
        mock_response = Mock()
        mock_response.data = {'id': str(manager.session_id), 'type': 'recording', 'status': 'active'}
        manager.supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = mock_response
        result = await manager._validate_session()
        assert result is True

    @pytest.mark.asyncio
    async def test_validate_session_wrong_type(self, manager):
        """測試錯誤的會話類型"""
        mock_response = Mock()
        mock_response.data = {'id': str(manager.session_id), 'type': 'note_only', 'status': 'active'}
        manager.supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = mock_response
        result = await manager._validate_session()
        assert result is False

    @pytest.mark.asyncio
    async def test_validate_session_http_exception(self, manager):
        """測試會話驗證 HTTP 異常"""
        manager.supabase_client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = HTTPException(404, "Not Found")
        result = await manager._validate_session()
        assert result is False

    @pytest.mark.asyncio
    async def test_handle_audio_chunk_new_chunk(self, manager):
        """測試處理新的音訊切片"""
        chunk_sequence = 0
        audio_data = b'\x00' * 1000
        chunk_data = struct.pack('<I', chunk_sequence) + audio_data

        with patch.object(manager, '_upload_chunk_to_r2') as mock_upload:
            mock_task = AsyncMock()

            with patch('asyncio.create_task', return_value=mock_task):
                await manager._handle_audio_chunk(chunk_data)

                assert chunk_sequence in manager.received_chunks
                assert chunk_sequence in manager.upload_tasks

    @pytest.mark.asyncio
    async def test_handle_audio_chunk_duplicate(self, manager):
        """測試處理重複的音訊切片"""
        chunk_sequence = 0
        audio_data = b'\x00' * 1000
        chunk_data = struct.pack('<I', chunk_sequence) + audio_data

        # 先添加到已收到列表
        manager.received_chunks.add(chunk_sequence)

        with patch.object(manager, '_send_ack') as mock_ack:
            await manager._handle_audio_chunk(chunk_data)

            # 應該發送 ACK 但不處理
            mock_ack.assert_called_once_with(chunk_sequence)

    @pytest.mark.asyncio
    async def test_handle_audio_chunk_invalid_format(self, manager):
        """測試處理無效格式的切片"""
        # 太短的資料
        chunk_data = b'\x00\x01'

        with patch.object(manager, '_send_error') as mock_error:
            await manager._handle_audio_chunk(chunk_data)

            mock_error.assert_called_once_with("Invalid chunk format: too short")

    @pytest.mark.asyncio
    async def test_handle_audio_chunk_empty_audio(self, manager):
        """測試處理空音訊資料的切片"""
        chunk_sequence = 0
        chunk_data = struct.pack('<I', chunk_sequence)  # 只有序號，沒有音訊資料

        with patch.object(manager, '_send_error') as mock_error:
            await manager._handle_audio_chunk(chunk_data)

            mock_error.assert_called_once_with(f"Empty audio data for chunk {chunk_sequence}")

    @pytest.mark.asyncio
    async def test_upload_chunk_to_r2_success(self, manager):
        """測試成功上傳切片到 R2"""
        chunk_sequence = 0
        audio_data = b'\x00' * 1000
        manager.r2_client.store_chunk_blob = AsyncMock(return_value={'success': True})

        mock_service = AsyncMock()
        with patch('app.core.container.container.resolve', return_value=mock_service):
            await manager._upload_chunk_to_r2(chunk_sequence, audio_data)

            manager.r2_client.store_chunk_blob.assert_called_once()
            manager.websocket.send_text.assert_called_once() # ACK
            mock_service.process_audio_chunk.assert_called_once()

    @pytest.mark.asyncio
    async def test_upload_chunk_to_r2_failure(self, manager):
        """測試上傳切片到 R2 失敗"""
        chunk_sequence = 0
        audio_data = b'\x00' * 1000

        # 模擬 R2 上傳失敗
        mock_r2_result = {'success': False, 'error': 'Upload failed'}
        manager.r2_client.store_chunk_blob = AsyncMock(return_value=mock_r2_result)

        # 先添加到已收到列表
        manager.received_chunks.add(chunk_sequence)

        with patch.object(manager, '_send_upload_error') as mock_error:
            await manager._upload_chunk_to_r2(chunk_sequence, audio_data)

            # 驗證錯誤被發送
            mock_error.assert_called_once_with(chunk_sequence, 'Upload failed')

            # 驗證切片從已收到列表中移除
            assert chunk_sequence not in manager.received_chunks

    @pytest.mark.asyncio
    async def test_upload_chunk_to_r2_exception(self, manager):
        """測試上傳切片時的異常處理"""
        chunk_sequence = 0
        audio_data = b'\x00' * 1000

        # 模擬異常
        manager.r2_client.store_chunk_blob = AsyncMock(side_effect=Exception("Network error"))

        # 先添加到已收到列表
        manager.received_chunks.add(chunk_sequence)

        with patch.object(manager, '_send_upload_error') as mock_error:
            await manager._upload_chunk_to_r2(chunk_sequence, audio_data)

            # 驗證錯誤被發送
            mock_error.assert_called_once_with(chunk_sequence, "Network error")

            # 驗證切片從已收到列表中移除
            assert chunk_sequence not in manager.received_chunks

    @pytest.mark.asyncio
    async def test_handle_text_message_heartbeat(self, manager):
        """測試處理心跳消息"""
        message = json.dumps({"type": "heartbeat"})

        with patch.object(manager, '_send_message') as mock_send:
            await manager._handle_text_message(message)

            # 驗證心跳回應
            mock_send.assert_called_once_with({"type": "heartbeat_ack"})

            # 驗證心跳時間更新
            assert manager.last_heartbeat is not None

    @pytest.mark.asyncio
    async def test_handle_text_message_request_missing(self, manager):
        """測試處理請求缺失切片消息"""
        message = json.dumps({"type": "request_missing"})

        with patch.object(manager, '_send_missing_chunks') as mock_send:
            await manager._handle_text_message(message)

            mock_send.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_text_message_upload_complete(self, manager):
        """測試處理上傳完成消息"""
        message = json.dumps({"type": "upload_complete"})

        with patch.object(manager, '_handle_upload_complete') as mock_handle:
            await manager._handle_text_message(message)

            mock_handle.assert_called_once()

    @pytest.mark.asyncio
    async def test_handle_text_message_invalid_json(self, manager):
        """測試處理無效 JSON 消息"""
        message = "invalid json"

        with patch.object(manager, '_send_error') as mock_error:
            await manager._handle_text_message(message)

            mock_error.assert_called_once_with("Invalid JSON message")

    @pytest.mark.asyncio
    async def test_handle_text_message_unknown_type(self, manager):
        """測試處理未知類型消息"""
        message = json.dumps({"type": "unknown_type"})

        # 應該記錄警告但不發送錯誤
        await manager._handle_text_message(message)

    @pytest.mark.asyncio
    async def test_send_ack(self, manager):
        """測試發送 ACK 消息"""
        chunk_sequence = 0

        with patch.object(manager, '_send_message') as mock_send:
            await manager._send_ack(chunk_sequence)

            expected_message = {
                "type": "ack",
                "chunk_sequence": chunk_sequence,
                "timestamp": mock_send.call_args[0][0]["timestamp"]
            }

            mock_send.assert_called_once()
            sent_message = mock_send.call_args[0][0]
            assert sent_message["type"] == "ack"
            assert sent_message["chunk_sequence"] == chunk_sequence

    @pytest.mark.asyncio
    async def test_send_upload_error(self, manager):
        """測試發送上傳錯誤消息"""
        chunk_sequence = 0
        error_msg = "Upload failed"

        with patch.object(manager, '_send_message') as mock_send:
            await manager._send_upload_error(chunk_sequence, error_msg)

            mock_send.assert_called_once()
            sent_message = mock_send.call_args[0][0]
            assert sent_message["type"] == "upload_error"
            assert sent_message["chunk_sequence"] == chunk_sequence
            assert sent_message["error"] == error_msg

    @pytest.mark.asyncio
    async def test_send_missing_chunks(self, manager):
        """測試發送缺失切片列表"""
        manager.received_chunks = {0, 2, 4}

        with patch.object(manager, '_send_message') as mock_send:
            await manager._send_missing_chunks()

            mock_send.assert_called_once()
            sent_message = mock_send.call_args[0][0]
            assert sent_message["type"] == "chunk_status"
            assert sent_message["received_chunks"] == [0, 2, 4]
            assert sent_message["total_received"] == 3

    @pytest.mark.asyncio
    async def test_handle_upload_complete(self, manager):
        """測試處理上傳完成"""
        # 添加一些模擬的上傳任務
        mock_task1 = asyncio.create_task(asyncio.sleep(0.01))
        mock_task2 = asyncio.create_task(asyncio.sleep(0.01))
        manager.upload_tasks = {0: mock_task1, 1: mock_task2}
        manager.received_chunks = {0, 1}

        with patch.object(manager, '_send_message') as mock_send:
            await manager._handle_upload_complete()
            # 等待任務完成
            await asyncio.gather(mock_task1, mock_task2)
            mock_send.assert_any_call({"type": "all_chunks_received"})

            # 這裡我們不再 mock `asyncio.gather`，而是讓它實際執行
            # 然後我們可以驗證最終的結果

    @pytest.mark.asyncio
    async def test_heartbeat_monitor_normal(self, manager):
        """測試正常的心跳監控"""
        manager.is_connected = True
        manager.last_heartbeat = datetime.now(timezone.utc)

        # 模擬短時間後停止監控
        async def stop_monitoring():
            await asyncio.sleep(0.1)
            manager.is_connected = False

        monitor_task = asyncio.create_task(manager._heartbeat_monitor())
        stop_task = asyncio.create_task(stop_monitoring())

        await asyncio.gather(monitor_task, stop_task, return_exceptions=True)

    @pytest.mark.asyncio
    async def test_heartbeat_monitor_timeout(self, manager):
        """測試心跳超時"""
        manager.is_connected = True
        # 設定過期的心跳時間
        manager.last_heartbeat = datetime.now(timezone.utc) - timedelta(seconds=100)

        with patch.object(manager, '_send_error') as mock_error:
            with patch.object(manager.websocket, 'close') as mock_close:
                # 啟動監控，但很快就會超時
                monitor_task = asyncio.create_task(manager._heartbeat_monitor())

                # 等待一小段時間讓監控檢測到超時
                await asyncio.sleep(0.1)

                # 停止任務
                monitor_task.cancel()

                try:
                    await monitor_task
                except asyncio.CancelledError:
                    pass

    @pytest.mark.asyncio
    async def test_send_message_success(self, manager):
        """測試成功發送消息"""
        manager.is_connected = True
        message = {"type": "test", "data": "hello"}

        await manager._send_message(message)

        manager.websocket.send_text.assert_called_once_with(json.dumps(message))

    @pytest.mark.asyncio
    async def test_send_message_disconnected(self, manager):
        """測試在連接斷開時發送消息"""
        manager.is_connected = False
        message = {"type": "test", "data": "hello"}

        await manager._send_message(message)

        # 仍應嘗試呼叫 send_text
        manager.websocket.send_text.assert_called_once_with(json.dumps(message))

    @pytest.mark.asyncio
    async def test_send_message_websocket_error(self, manager):
        """測試發送消息時的 WebSocket 錯誤"""
        manager.is_connected = True
        manager.websocket.send_text.side_effect = WebSocketDisconnect()
        message = {"type": "test", "data": "hello"}

        await manager._send_message(message)

        # 連接狀態應該被標記為斷開
        assert manager.is_connected is False

    @pytest.mark.asyncio
    async def test_send_error(self, manager):
        """測試發送錯誤消息"""
        error_msg = "Test error"

        with patch.object(manager, '_send_message') as mock_send:
            await manager._send_error(error_msg)

            mock_send.assert_called_once_with({
                "type": "error",
                "message": error_msg
            })

    @pytest.mark.asyncio
    async def test_cleanup_with_tasks(self, manager):
        """測試清理時等待上傳任務完成"""
        # 使用 AsyncMock 來建立可等待的 mock task
        mock_task1 = asyncio.create_task(asyncio.sleep(0))
        mock_task2 = asyncio.create_task(asyncio.sleep(0))
        manager.upload_tasks = {0: mock_task1, 1: mock_task2}

        await manager._cleanup()
        # 這裡我們只確認 gather 被呼叫，因為 task 的完成是 asyncio 的事
        # 在這個測試中，我們可以假設它們會完成
        assert mock_task1.done()
        assert mock_task2.done()

    @pytest.mark.asyncio
    async def test_cleanup_no_tasks(self, manager):
        """測試沒有任務時的清理"""
        manager.upload_tasks = {}

        with patch('asyncio.gather') as mock_gather:
            await manager._cleanup()

            # 沒有任務時不應該呼叫 gather
            mock_gather.assert_not_called()


class TestMessageLoop:
    """測試消息循環處理"""

    @pytest.fixture
    def manager(self, mock_websocket, session_id, mock_supabase_client):
        """建立測試用的管理器"""
        manager = AudioUploadManager(
            websocket=mock_websocket,
            session_id=session_id,
            supabase_client=mock_supabase_client
        )
        manager.is_connected = True
        return manager

    @pytest.mark.asyncio
    async def test_message_loop_binary_data(self, manager):
        """測試處理二進制資料"""
        audio_data = b'\x00' * 1000
        chunk_data = struct.pack('<I', 0) + audio_data

        # 模擬接收二進制資料後斷開
        manager.websocket.receive.side_effect = [
            {"bytes": chunk_data},
            WebSocketDisconnect()
        ]

        with patch.object(manager, '_handle_audio_chunk') as mock_handle:
            await manager._message_loop()

            mock_handle.assert_called_once_with(chunk_data)

    @pytest.mark.asyncio
    async def test_message_loop_text_data(self, manager):
        """測試處理文本資料"""
        text_message = json.dumps({"type": "heartbeat"})

        # 模擬接收文本資料後斷開
        manager.websocket.receive.side_effect = [
            {"text": text_message},
            WebSocketDisconnect()
        ]

        with patch.object(manager, '_handle_text_message') as mock_handle:
            await manager._message_loop()

            mock_handle.assert_called_once_with(text_message)

    @pytest.mark.asyncio
    async def test_message_loop_websocket_disconnect(self, manager):
        """測試 WebSocket 正常斷開"""
        manager.websocket.receive.side_effect = WebSocketDisconnect()

        await manager._message_loop()

        # 連接狀態應該被標記為斷開
        assert manager.is_connected is False

    @pytest.mark.asyncio
    async def test_message_loop_runtime_error(self, manager):
        """測試運行時錯誤"""
        manager.websocket.receive.side_effect = RuntimeError('Cannot call "receive" once a disconnect message has been received')

        await manager._message_loop()

        # 連接狀態應該被標記為斷開
        assert manager.is_connected is False

    @pytest.mark.asyncio
    async def test_message_loop_unexpected_error(self, manager):
        """測試未預期的錯誤"""
        manager.websocket.receive.side_effect = Exception("Unexpected error")

        with patch.object(manager, '_send_error') as mock_error:
            await manager._message_loop()

            mock_error.assert_called_once_with("Message processing error: Unexpected error")
            assert manager.is_connected is False
