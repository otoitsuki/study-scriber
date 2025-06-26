"""
測試 Azure OpenAI v2 轉錄服務

測試「一段一轉」架構的核心轉錄邏輯
"""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID

import pytest

from app.services.azure_openai_v2 import SimpleAudioTranscriptionService


class TestSimpleAudioTranscriptionService:
    """測試簡化的轉錄服務"""

    @pytest.fixture
    def service(self, mock_azure_client):
        """建立測試用的轉錄服務實例"""
        return SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

    def test_init(self, mock_azure_client):
        """測試服務初始化"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        assert service.client == mock_azure_client
        assert service.deployment_name == "whisper-test"
        assert service.processing_tasks == {}

    @pytest.mark.asyncio
    async def test_process_audio_chunk_new_task(self, service, session_id, sample_webm_data):
        """測試處理新的音訊切片"""
        with patch.object(service, '_process_chunk_async') as mock_process:
            mock_task = AsyncMock()
            mock_process.return_value = mock_task

            with patch('asyncio.create_task', return_value=mock_task) as mock_create_task:
                result = await service.process_audio_chunk(session_id, 0, sample_webm_data)

                assert result is True
                mock_create_task.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_audio_chunk_duplicate_task(self, service, session_id, sample_webm_data):
        """測試重複處理同一切片時的行為"""
        # 先添加一個正在處理的任務
        task_key = f"{session_id}_0"
        service.processing_tasks[task_key] = AsyncMock()

        result = await service.process_audio_chunk(session_id, 0, sample_webm_data)

        assert result is False

    def test_validate_webm_data_valid(self, service, sample_webm_data):
        """測試有效的 WebM 資料驗證"""
        result = service._validate_webm_data(sample_webm_data, 0)
        assert result is True

    def test_validate_webm_data_too_small(self, service):
        """測試過小的 WebM 資料"""
        small_data = b'\x00' * 10  # 只有 10 bytes
        result = service._validate_webm_data(small_data, 0)
        assert result is False

    def test_validate_webm_data_empty(self, service):
        """測試空的 WebM 資料"""
        result = service._validate_webm_data(b'', 0)
        assert result is False

    def test_validate_webm_data_none(self, service):
        """測試 None 資料"""
        result = service._validate_webm_data(None, 0)
        assert result is False

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_success(self, service, sample_webm_data, mock_ffmpeg_process):
        """測試成功的 WebM 到 WAV 轉換"""
        mock_wav_data = b'RIFF' + b'\x00' * 1000
        mock_ffmpeg_process.communicate.return_value = (mock_wav_data, b'')

        with patch('asyncio.create_subprocess_exec', return_value=mock_ffmpeg_process):
            with patch('asyncio.wait_for', return_value=(mock_wav_data, b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0)

                assert result == mock_wav_data

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_ffmpeg_error(self, service, sample_webm_data):
        """測試 FFmpeg 轉換錯誤"""
        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = (b'', b'FFmpeg error')

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'', b'FFmpeg error')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0)

                assert result is None

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_timeout(self, service, sample_webm_data):
        """測試 FFmpeg 轉換超時"""
        with patch('asyncio.create_subprocess_exec'):
            with patch('asyncio.wait_for', side_effect=asyncio.TimeoutError):
                result = await service._convert_webm_to_wav(sample_webm_data, 0)

                assert result is None

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_insufficient_output(self, service, sample_webm_data):
        """測試 FFmpeg 輸出不足"""
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (b'small', b'')  # 太小的輸出

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'small', b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0)

                assert result is None

    @pytest.mark.asyncio
    async def test_transcribe_audio_success(self, service, sample_wav_data, session_id, mock_azure_client):
        """測試成功的音訊轉錄"""
        mock_azure_client.audio.transcriptions.create.return_value = "測試轉錄結果"

        with patch('tempfile.NamedTemporaryFile') as mock_temp:
            mock_file = Mock()
            mock_file.name = '/tmp/test.wav'
            mock_temp.return_value.__enter__.return_value = mock_file

            with patch('builtins.open', mock_file):
                with patch('pathlib.Path.unlink'):
                    result = await service._transcribe_audio(sample_wav_data, session_id, 0)

                    assert result is not None
                    assert result['text'] == "測試轉錄結果"
                    assert result['chunk_sequence'] == 0
                    assert result['session_id'] == str(session_id)
                    assert result['language'] == 'zh-TW'

    @pytest.mark.asyncio
    async def test_transcribe_audio_empty_result(self, service, sample_wav_data, session_id, mock_azure_client):
        """測試空的轉錄結果"""
        mock_azure_client.audio.transcriptions.create.return_value = ""

        with patch('tempfile.NamedTemporaryFile') as mock_temp:
            mock_file = Mock()
            mock_file.name = '/tmp/test.wav'
            mock_temp.return_value.__enter__.return_value = mock_file

            with patch('builtins.open', mock_file):
                with patch('pathlib.Path.unlink'):
                    result = await service._transcribe_audio(sample_wav_data, session_id, 0)

                    assert result is None

    @pytest.mark.asyncio
    async def test_transcribe_audio_api_error(self, service, sample_wav_data, session_id, mock_azure_client):
        """測試 API 呼叫錯誤"""
        mock_azure_client.audio.transcriptions.create.side_effect = Exception("API Error")

        with patch('tempfile.NamedTemporaryFile') as mock_temp:
            mock_file = Mock()
            mock_file.name = '/tmp/test.wav'
            mock_temp.return_value.__enter__.return_value = mock_file

            with patch('pathlib.Path.unlink'):
                result = await service._transcribe_audio(sample_wav_data, session_id, 0)

                assert result is None

    @pytest.mark.asyncio
    async def test_save_and_push_result_success(self, service, session_id, transcript_result, mock_supabase_client):
        """測試成功儲存和推送轉錄結果"""
        with patch('app.services.azure_openai_v2.get_supabase_client', return_value=mock_supabase_client):
            with patch('app.ws.transcript_feed.manager') as mock_manager:
                mock_manager.broadcast_to_session = AsyncMock()

                await service._save_and_push_result(session_id, 0, transcript_result)

                # 驗證資料庫儲存
                mock_supabase_client.table.assert_called_with("transcript_segments")

                # 驗證 WebSocket 推送
                mock_manager.broadcast_to_session.assert_called_once()

    @pytest.mark.asyncio
    async def test_save_and_push_result_database_error(self, service, session_id, transcript_result):
        """測試資料庫儲存錯誤"""
        mock_supabase_client = Mock()
        mock_supabase_client.table.side_effect = Exception("Database Error")

        with patch('app.services.azure_openai_v2.get_supabase_client', return_value=mock_supabase_client):
            # 應該不會拋出異常，只是記錄錯誤
            await service._save_and_push_result(session_id, 0, transcript_result)

    @pytest.mark.asyncio
    async def test_process_chunk_async_full_flow(self, service, session_id, sample_webm_data):
        """測試完整的切片處理流程"""
        mock_wav_data = b'RIFF' + b'\x00' * 1000
        mock_transcript = {
            'text': '完整流程測試',
            'chunk_sequence': 0,
            'session_id': str(session_id),
            'timestamp': '2024-01-01T00:00:00Z',
            'language': 'zh-TW',
            'duration': 12
        }

        with patch.object(service, '_validate_webm_data', return_value=True):
            with patch.object(service, '_convert_webm_to_wav', return_value=mock_wav_data):
                with patch.object(service, '_transcribe_audio', return_value=mock_transcript):
                    with patch.object(service, '_save_and_push_result') as mock_save:

                        await service._process_chunk_async(session_id, 0, sample_webm_data)

                        mock_save.assert_called_once_with(session_id, 0, mock_transcript)

    @pytest.mark.asyncio
    async def test_process_chunk_async_validation_failure(self, service, session_id, sample_webm_data):
        """測試驗證失敗的情況"""
        with patch.object(service, '_validate_webm_data', return_value=False):
            with patch.object(service, '_convert_webm_to_wav') as mock_convert:

                await service._process_chunk_async(session_id, 0, sample_webm_data)

                # 驗證失敗後不應該呼叫轉換
                mock_convert.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_chunk_async_conversion_failure(self, service, session_id, sample_webm_data):
        """測試轉換失敗的情況"""
        with patch.object(service, '_validate_webm_data', return_value=True):
            with patch.object(service, '_convert_webm_to_wav', return_value=None):
                with patch.object(service, '_transcribe_audio') as mock_transcribe:

                    await service._process_chunk_async(session_id, 0, sample_webm_data)

                    # 轉換失敗後不應該呼叫轉錄
                    mock_transcribe.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_chunk_async_transcription_failure(self, service, session_id, sample_webm_data):
        """測試轉錄失敗的情況"""
        mock_wav_data = b'RIFF' + b'\x00' * 1000

        with patch.object(service, '_validate_webm_data', return_value=True):
            with patch.object(service, '_convert_webm_to_wav', return_value=mock_wav_data):
                with patch.object(service, '_transcribe_audio', return_value=None):
                    with patch.object(service, '_save_and_push_result') as mock_save:

                        await service._process_chunk_async(session_id, 0, sample_webm_data)

                        # 轉錄失敗後不應該呼叫儲存
                        mock_save.assert_not_called()


class TestServiceFactoryFunctions:
    """測試服務工廠函數"""

    def test_get_azure_openai_client_success(self):
        """測試成功取得 Azure OpenAI 客戶端"""
        with patch.dict('os.environ', {
            'AZURE_OPENAI_API_KEY': 'test-key',
            'AZURE_OPENAI_ENDPOINT': 'https://test.openai.azure.com/',
            'AZURE_OPENAI_API_VERSION': '2024-06-01'
        }):
            from app.services.azure_openai_v2 import get_azure_openai_client

            client = get_azure_openai_client()
            assert client is not None

    def test_get_azure_openai_client_missing_credentials(self):
        """測試缺少認證資訊"""
        with patch.dict('os.environ', {}, clear=True):
            from app.services.azure_openai_v2 import get_azure_openai_client

            client = get_azure_openai_client()
            assert client is None

    def test_get_whisper_deployment_name(self):
        """測試取得 Whisper 部署名稱"""
        with patch.dict('os.environ', {'WHISPER_DEPLOYMENT_NAME': 'test-whisper'}):
            from app.services.azure_openai_v2 import get_whisper_deployment_name

            name = get_whisper_deployment_name()
            assert name == 'test-whisper'

    @pytest.mark.asyncio
    async def test_get_transcription_service_v2_success(self):
        """測試成功取得轉錄服務"""
        with patch('app.services.azure_openai_v2.get_azure_openai_client') as mock_get_client:
            with patch('app.services.azure_openai_v2.get_whisper_deployment_name', return_value='test-whisper'):
                mock_client = Mock()
                mock_get_client.return_value = mock_client

                from app.services.azure_openai_v2 import get_transcription_service_v2

                service = await get_transcription_service_v2()
                assert service is not None
                assert service.client == mock_client
                assert service.deployment_name == 'test-whisper'

    @pytest.mark.asyncio
    async def test_get_transcription_service_v2_missing_config(self):
        """測試缺少配置時的行為"""
        with patch('app.services.azure_openai_v2.get_azure_openai_client', return_value=None):
            from app.services.azure_openai_v2 import get_transcription_service_v2

            service = await get_transcription_service_v2()
            assert service is None

    def test_cleanup_transcription_service_v2(self):
        """測試清理轉錄服務"""
        from app.services.azure_openai_v2 import cleanup_transcription_service_v2, _transcription_service_v2

        # 模擬有進行中的任務
        mock_service = Mock()
        mock_task = Mock()
        mock_task.done.return_value = False
        mock_service.processing_tasks = {'task1': mock_task}

        with patch('app.services.azure_openai_v2._transcription_service_v2', mock_service):
            cleanup_transcription_service_v2()
            mock_task.cancel.assert_called_once()
