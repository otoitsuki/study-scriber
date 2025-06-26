"""
「一段一轉」架構整合測試

測試從音檔切片上傳到轉錄結果推送的完整流程
"""

import asyncio
import json
import struct
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
from app.ws.upload_audio import AudioUploadManager


class TestOneChunkOneTranscription:
    """測試一段一轉的完整流程"""

    @pytest.fixture
    def session_id(self):
        """測試會話 ID"""
        return uuid4()

    @pytest.fixture
    def sample_chunk_data(self):
        """樣本音檔切片資料"""
        chunk_sequence = 0
        audio_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000  # WebM header + data
        return struct.pack('<I', chunk_sequence) + audio_data

    @pytest.fixture
    def mock_transcription_service(self):
        """模擬轉錄服務"""
        service = Mock(spec=SimpleAudioTranscriptionService)
        service.process_audio_chunk = AsyncMock(return_value=True)
        return service

    @pytest.fixture
    def mock_upload_manager(self, mock_websocket, session_id, mock_supabase_client):
        """模擬上傳管理器"""
        manager = AudioUploadManager(
            websocket=mock_websocket,
            session_id=session_id,
            supabase_client=mock_supabase_client
        )
        manager.is_connected = True
        return manager

    @pytest.mark.asyncio
    async def test_complete_flow_success(self, mock_upload_manager, sample_chunk_data, mock_transcription_service):
        """測試成功的完整流程"""
        # 模擬 R2 上傳成功
        mock_r2_result = {'success': True}
        mock_upload_manager.r2_client.store_chunk_blob = AsyncMock(return_value=mock_r2_result)

        # 模擬轉錄服務
        with patch('app.services.azure_openai_v2.get_transcription_service_v2', return_value=mock_transcription_service):
            with patch.object(mock_upload_manager, '_send_ack') as mock_ack:
                # 處理音檔切片
                await mock_upload_manager._handle_audio_chunk(sample_chunk_data)

                # 等待上傳任務完成
                if mock_upload_manager.upload_tasks:
                    await asyncio.gather(*mock_upload_manager.upload_tasks.values())

                # 驗證流程
                assert 0 in mock_upload_manager.received_chunks
                mock_ack.assert_called_once_with(0)
                mock_transcription_service.process_audio_chunk.assert_called_once()

    @pytest.mark.asyncio
    async def test_transcription_service_full_process(self, mock_azure_client, session_id):
        """測試轉錄服務的完整處理過程"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        # 準備測試資料
        webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000
        chunk_sequence = 0

        # 模擬 FFmpeg 轉換
        mock_wav_data = b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000

        with patch.object(service, '_convert_webm_to_wav', return_value=mock_wav_data) as mock_convert:
            with patch.object(service, '_transcribe_audio', return_value={
                'text': '測試轉錄結果',
                'chunk_sequence': chunk_sequence,
                'session_id': str(session_id),
                'timestamp': '2024-01-01T00:00:00Z',
                'language': 'zh-TW',
                'duration': 12
            }) as mock_transcribe:
                with patch.object(service, '_save_and_push_result') as mock_save:
                    # 處理切片
                    await service._process_chunk_async(session_id, chunk_sequence, webm_data)

                    # 驗證各步驟都被呼叫
                    mock_convert.assert_called_once_with(webm_data, chunk_sequence)
                    mock_transcribe.assert_called_once_with(mock_wav_data, session_id, chunk_sequence)
                    mock_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_ffmpeg_conversion_with_genpts(self, mock_azure_client, session_id):
        """測試帶有 -fflags +genpts 的 FFmpeg 轉換"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000
        expected_wav = b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000

        # 模擬 FFmpeg 程序
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (expected_wav, b'')

        with patch('asyncio.create_subprocess_exec', return_value=mock_process) as mock_exec:
            with patch('asyncio.wait_for', return_value=(expected_wav, b'')):
                result = await service._convert_webm_to_wav(webm_data, 0)

                # 驗證 FFmpeg 命令包含 -fflags +genpts
                mock_exec.assert_called_once()
                cmd_args = mock_exec.call_args[1]['args'] if 'args' in mock_exec.call_args[1] else mock_exec.call_args[0]

                # 檢查命令參數
                assert 'ffmpeg' in cmd_args
                assert '-fflags' in cmd_args
                assert '+genpts' in cmd_args

                assert result == expected_wav

    @pytest.mark.asyncio
    async def test_websocket_message_flow(self, mock_upload_manager, sample_chunk_data):
        """測試 WebSocket 消息流程"""
        # 模擬成功的處理流程
        mock_upload_manager.r2_client.store_chunk_blob = AsyncMock(return_value={'success': True})

        with patch('app.services.azure_openai_v2.get_transcription_service_v2') as mock_get_service:
            mock_service = AsyncMock()
            mock_service.process_audio_chunk = AsyncMock(return_value=True)
            mock_get_service.return_value = mock_service

            with patch.object(mock_upload_manager, '_send_ack') as mock_ack:
                # 處理音檔切片
                await mock_upload_manager._handle_audio_chunk(sample_chunk_data)

                # 等待處理完成
                if mock_upload_manager.upload_tasks:
                    await asyncio.gather(*mock_upload_manager.upload_tasks.values())

                # 驗證 ACK 被發送
                mock_ack.assert_called_once_with(0)

    @pytest.mark.asyncio
    async def test_duplicate_chunk_handling(self, mock_upload_manager, sample_chunk_data):
        """測試重複切片的處理"""
        # 先處理一次
        mock_upload_manager.received_chunks.add(0)

        with patch.object(mock_upload_manager, '_send_ack') as mock_ack:
            with patch.object(mock_upload_manager, '_upload_chunk_to_r2') as mock_upload:
                # 再次處理同一切片
                await mock_upload_manager._handle_audio_chunk(sample_chunk_data)

                # 應該發送 ACK 但不上傳
                mock_ack.assert_called_once_with(0)
                mock_upload.assert_not_called()

    @pytest.mark.asyncio
    async def test_error_handling_in_flow(self, mock_upload_manager, sample_chunk_data):
        """測試流程中的錯誤處理"""
        # 模擬 R2 上傳失敗
        mock_upload_manager.r2_client.store_chunk_blob = AsyncMock(
            return_value={'success': False, 'error': 'Upload failed'}
        )

        # 先添加到已收到列表
        mock_upload_manager.received_chunks.add(0)

        with patch.object(mock_upload_manager, '_send_upload_error') as mock_error:
            # 處理切片上傳
            await mock_upload_manager._upload_chunk_to_r2(0, sample_chunk_data[4:])

            # 驗證錯誤處理
            mock_error.assert_called_once_with(0, 'Upload failed')
            assert 0 not in mock_upload_manager.received_chunks

    @pytest.mark.asyncio
    async def test_transcription_service_error_recovery(self, mock_azure_client, session_id):
        """測試轉錄服務的錯誤恢復"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000

        # 模擬 FFmpeg 轉換失敗
        with patch.object(service, '_convert_webm_to_wav', return_value=None):
            with patch.object(service, '_transcribe_audio') as mock_transcribe:
                # 處理切片
                await service._process_chunk_async(session_id, 0, webm_data)

                # 轉換失敗後不應該呼叫轉錄
                mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_performance_timing(self, mock_azure_client, session_id):
        """測試性能計時"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000

        # 模擬快速處理
        with patch.object(service, '_convert_webm_to_wav', return_value=b'mock_wav'):
            with patch.object(service, '_transcribe_audio', return_value={
                'text': '快速測試',
                'chunk_sequence': 0,
                'session_id': str(session_id),
                'timestamp': '2024-01-01T00:00:00Z',
                'language': 'zh-TW',
                'duration': 12
            }):
                with patch.object(service, '_save_and_push_result'):
                    # 測量處理時間
                    import time
                    start_time = time.time()

                    await service._process_chunk_async(session_id, 0, webm_data)

                    end_time = time.time()
                    processing_time = end_time - start_time

                    # 驗證處理時間合理（應該很快，因為都是 mock）
                    assert processing_time < 1.0  # 少於 1 秒

    @pytest.mark.asyncio
    async def test_concurrent_chunk_processing(self, mock_azure_client, session_id):
        """測試並行切片處理"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        # 準備多個切片
        chunks = []
        for i in range(3):
            webm_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000
            chunks.append((i, webm_data))

        with patch.object(service, '_convert_webm_to_wav', return_value=b'mock_wav'):
            with patch.object(service, '_transcribe_audio', return_value={
                'text': f'並行測試',
                'chunk_sequence': 0,
                'session_id': str(session_id),
                'timestamp': '2024-01-01T00:00:00Z',
                'language': 'zh-TW',
                'duration': 12
            }):
                with patch.object(service, '_save_and_push_result'):
                    # 並行處理多個切片
                    tasks = []
                    for chunk_seq, webm_data in chunks:
                        result = await service.process_audio_chunk(session_id, chunk_seq, webm_data)
                        assert result is True

                    # 等待所有任務完成
                    if service.processing_tasks:
                        await asyncio.gather(*service.processing_tasks.values(), return_exceptions=True)

                    # 驗證所有任務都被處理
                    assert len(service.processing_tasks) == 0  # 任務完成後會被清理
