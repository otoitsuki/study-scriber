"""
測試 Azure OpenAI v2 轉錄服務

測試「一段一轉」架構的核心轉錄邏輯
"""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID
import io

import pytest
from types import SimpleNamespace

from app.services.azure_openai_v2 import SimpleAudioTranscriptionService, get_azure_openai_client, get_whisper_deployment_name, initialize_transcription_service_v2, cleanup_transcription_service_v2, _transcription_service_v2
from openai import AzureOpenAI


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
    async def test_convert_webm_to_wav_success(self, service, sample_webm_data, mock_ffmpeg_process, session_id):
        """測試成功的 WebM 到 WAV 轉換"""
        mock_wav_data = b'RIFF' + b'\x00' * 1000
        mock_ffmpeg_process.communicate.return_value = (mock_wav_data, b'')

        with patch('asyncio.create_subprocess_exec', return_value=mock_ffmpeg_process):
            with patch('asyncio.wait_for', return_value=(mock_wav_data, b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result == mock_wav_data

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_ffmpeg_error(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 轉換錯誤"""
        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = (b'', b'FFmpeg error')

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'', b'FFmpeg error')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_timeout(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 轉換超時"""
        with patch('asyncio.create_subprocess_exec'):
            with patch('asyncio.wait_for', side_effect=asyncio.TimeoutError):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav_insufficient_output(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 輸出不足"""
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (b'small', b'')  # 太小的輸出

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'small', b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    @pytest.mark.asyncio
    async def test_transcribe_audio_success(self, service, sample_wav_data, session_id, mock_writable_tempfile):
        """測試成功的音訊轉錄"""
        # Azure OpenAI API 直接回傳字串，不是物件
        service.client.audio.transcriptions.create.return_value = "  測試轉錄結果  "

        # 建立 mock 檔案物件
        mock_file = io.BytesIO(sample_wav_data)

        with patch('tempfile.NamedTemporaryFile', new_callable=mock_writable_tempfile):
            with patch('pathlib.Path.unlink'):
                with patch('builtins.open', return_value=mock_file):
                    result = await service._transcribe_audio(sample_wav_data, session_id, 0)
                    assert result is not None
                    assert result['text'] == "測試轉錄結果"
                    assert result['chunk_sequence'] == 0
                    assert result['session_id'] == str(session_id)

    @pytest.mark.asyncio
    async def test_transcribe_audio_empty_result(self, service, sample_wav_data, session_id):
        """測試空的轉錄結果"""
        mock_response = SimpleNamespace(text="  ") # 只有空白
        service.client.audio.transcriptions.create.return_value = mock_response

        with patch('tempfile.NamedTemporaryFile') as mock_temp:
            mock_file = Mock()
            mock_file.name = '/tmp/test.wav'
            mock_temp.return_value.__enter__.return_value = mock_file

            with patch('builtins.open', mock_file):
                with patch('pathlib.Path.unlink'):
                    result = await service._transcribe_audio(sample_wav_data, session_id, 0)

                    assert result is None

    @pytest.mark.asyncio
    async def test_transcribe_audio_api_error(self, service, sample_wav_data, session_id):
        """測試 API 呼叫錯誤"""
        service.client.audio.transcriptions.create.side_effect = Exception("API Error")

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
            # broadcast 是同步函式，用 Mock
            with patch('app.ws.transcript_feed.manager.broadcast', new_callable=Mock) as mock_broadcast:

                await service._save_and_push_result(session_id, 0, transcript_result)

                # 驗證資料庫儲存
                mock_supabase_client.table.assert_called_with("transcript_segments")

                # 驗證 WebSocket 推送
                mock_broadcast.assert_called_once()

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
    """測試服務工廠函式"""

    def test_get_azure_openai_client_success(self, monkeypatch):
        """測試成功獲取 Azure OpenAI 客戶端"""
        monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-key")
        monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://test.openai.azure.com/")
        monkeypatch.setenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
        client = get_azure_openai_client()
        assert client is not None

    def test_get_azure_openai_client_missing_credentials(self):
        """測試缺少認證資訊"""
        with patch.dict('os.environ', {}, clear=True):
            from app.services.azure_openai_v2 import get_azure_openai_client

            client = get_azure_openai_client()
            assert client is None

    def test_get_whisper_deployment_name(self, monkeypatch):
        """測試獲取 Whisper 部署名稱"""
        monkeypatch.setenv("WHISPER_DEPLOYMENT_NAME", "test-whisper")
        name = get_whisper_deployment_name()
        assert name == "test-whisper"

    @pytest.mark.asyncio
    async def test_initialize_transcription_service_v2_success(self):
        """測試成功初始化轉錄服務"""
        import app.services.azure_openai_v2 as mod
        with patch('app.services.azure_openai_v2.get_azure_openai_client', return_value=Mock(spec=AzureOpenAI)) as mock_get_client, \
             patch('app.services.azure_openai_v2.get_whisper_deployment_name', return_value="test-whisper") as mock_get_deployment:

            mod._transcription_service_v2 = None

            await mod.initialize_transcription_service_v2()

            assert mod._transcription_service_v2 is not None
            mock_get_client.assert_called_once()
            mock_get_deployment.assert_called_once()

            mod.cleanup_transcription_service_v2()
            assert mod._transcription_service_v2 is None

    @pytest.mark.asyncio
    async def test_initialize_transcription_service_v2_missing_config(self):
        """測試缺少配置時初始化失敗"""
        with patch('app.services.azure_openai_v2.get_azure_openai_client', return_value=None):
            global _transcription_service_v2
            _transcription_service_v2 = None

            await initialize_transcription_service_v2()

            assert _transcription_service_v2 is None

@pytest.fixture
def mock_writable_tempfile():
    """模擬一個可寫的暫存檔案 (callable context manager)"""
    class MockTempFile:
        def __init__(self, *args, **kwargs):
            self.name = "/tmp/fake_temp_file.wav"
            self._file = io.BytesIO()
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass
        def write(self, data):
            self._file.write(data)
        def flush(self):
            pass
        def __call__(self, *args, **kwargs):
            # 當被直接呼叫時，回傳新的實例
            return MockTempFile(*args, **kwargs)

    # 回傳 MockTempFile 類別本身，讓 patch new_callable 可以直接使用
    return MockTempFile
