"""
測試 Azure OpenAI v2 轉錄服務

測試「一段一轉」架構的核心轉錄邏輯
"""

import asyncio
import tempfile
import time
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID
import io

import pytest
from types import SimpleNamespace

from app.services.azure_openai_v2 import SimpleAudioTranscriptionService, get_azure_openai_client, get_whisper_deployment_name, initialize_transcription_service_v2, cleanup_transcription_service_v2, _transcription_service_v2
from openai import AzureOpenAI
from app.core.webm_header_repairer import WebMHeaderRepairer, HeaderExtractionResult, HeaderRepairResult


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

    def test_init_with_header_cache(self, mock_azure_client):
        """測試服務初始化包含檔頭緩存功能"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        assert service.client == mock_azure_client
        assert service.deployment_name == "whisper-test"
        assert service.processing_tasks == {}
        
        # 檢查檔頭緩存相關屬性
        assert service._header_cache == {}
        assert service._header_cache_timestamps == {}
        assert service._header_repairer is None  # 延遲初始化
        assert service._cache_expiry_seconds == 3600
        assert service._max_cache_sessions == 100

    def test_get_header_repairer(self, service):
        """測試檔頭修復器的延遲初始化"""
        # 第一次調用應該創建實例
        repairer1 = service._get_header_repairer()
        assert isinstance(repairer1, WebMHeaderRepairer)
        assert service._header_repairer is not None
        
        # 第二次調用應該返回同一個實例
        repairer2 = service._get_header_repairer()
        assert repairer1 is repairer2

    def test_extract_and_cache_header_success(self, service, session_id, sample_webm_data):
        """測試成功提取並緩存檔頭"""
        mock_repairer = Mock()
        mock_result = HeaderExtractionResult(
            success=True,
            header_data=sample_webm_data[:104],
            error_message=None
        )
        mock_repairer.extract_header.return_value = mock_result
        
        with patch.object(service, '_get_header_repairer', return_value=mock_repairer):
            result = service._extract_and_cache_header(str(session_id), sample_webm_data)
            
            assert result is True
            assert str(session_id) in service._header_cache
            assert str(session_id) in service._header_cache_timestamps
            assert service._header_cache[str(session_id)] == mock_result.header_data

    def test_extract_and_cache_header_failure(self, service, session_id, sample_webm_data):
        """測試檔頭提取失敗"""
        mock_repairer = Mock()
        mock_result = HeaderExtractionResult(
            success=False,
            header_data=None,
            error_message="Invalid WebM data"
        )
        mock_repairer.extract_header.return_value = mock_result
        
        with patch.object(service, '_get_header_repairer', return_value=mock_repairer):
            result = service._extract_and_cache_header(str(session_id), sample_webm_data)
            
            assert result is False
            assert str(session_id) not in service._header_cache

    def test_extract_and_cache_header_exception(self, service, session_id, sample_webm_data):
        """測試檔頭提取過程中的異常處理"""
        mock_repairer = Mock()
        mock_repairer.extract_header.side_effect = Exception("Extraction error")
        
        with patch.object(service, '_get_header_repairer', return_value=mock_repairer):
            result = service._extract_and_cache_header(str(session_id), sample_webm_data)
            
            assert result is False
            assert str(session_id) not in service._header_cache

    def test_get_cached_header_success(self, service, session_id):
        """測試成功獲取緩存檔頭"""
        header_data = b'WEBM_HEADER_DATA'
        service._header_cache[str(session_id)] = header_data
        service._header_cache_timestamps[str(session_id)] = time.time()
        
        result = service._get_cached_header(str(session_id))
        assert result == header_data

    def test_get_cached_header_not_exists(self, service, session_id):
        """測試獲取不存在的檔頭緩存"""
        result = service._get_cached_header(str(session_id))
        assert result is None

    def test_get_cached_header_expired(self, service, session_id):
        """測試獲取過期的檔頭緩存"""
        header_data = b'WEBM_HEADER_DATA'
        service._header_cache[str(session_id)] = header_data
        service._header_cache_timestamps[str(session_id)] = time.time() - 7200  # 2小時前
        
        result = service._get_cached_header(str(session_id))
        assert result is None
        assert str(session_id) not in service._header_cache

    def test_clear_session_cache(self, service, session_id):
        """測試清理特定會話的緩存"""
        header_data = b'WEBM_HEADER_DATA'
        service._header_cache[str(session_id)] = header_data
        service._header_cache_timestamps[str(session_id)] = time.time()
        
        service._clear_session_cache(str(session_id))
        
        assert str(session_id) not in service._header_cache
        assert str(session_id) not in service._header_cache_timestamps

    def test_cleanup_expired_cache(self, service):
        """測試自動清理過期緩存"""
        current_time = time.time()
        
        # 添加新緩存
        service._header_cache["session1"] = b"header1"
        service._header_cache_timestamps["session1"] = current_time
        
        # 添加過期緩存
        service._header_cache["session2"] = b"header2"
        service._header_cache_timestamps["session2"] = current_time - 7200  # 2小時前
        
        service._cleanup_expired_cache()
        
        assert "session1" in service._header_cache
        assert "session2" not in service._header_cache

    def test_cleanup_cache_size_limit(self, service):
        """測試緩存大小限制"""
        current_time = time.time()
        
        # 超過最大限制的緩存
        for i in range(105):  # 超過100的限制
            session_id = f"session{i}"
            service._header_cache[session_id] = f"header{i}".encode()
            service._header_cache_timestamps[session_id] = current_time - i  # 時間遞減
        
        service._cleanup_expired_cache()
        
        # 應該只保留100個最新的（session0-session99）
        assert len(service._header_cache) == 100
        assert "session0" in service._header_cache  # 最新的（current_time - 0）
        assert "session104" not in service._header_cache  # 最舊的（current_time - 104）

    async def test_process_audio_chunk_new_task(self, service, session_id, sample_webm_data):
        """測試處理新的音訊切片"""
        with patch.object(service, '_process_chunk_async') as mock_process:
            mock_task = AsyncMock()
            mock_process.return_value = mock_task

            with patch('asyncio.create_task', return_value=mock_task) as mock_create_task:
                result = await service.process_audio_chunk(session_id, 0, sample_webm_data)

                assert result is True
                mock_create_task.assert_called_once()

    async def test_process_audio_chunk_duplicate_task(self, service, session_id, sample_webm_data):
        """測試重複處理同一切片時的行為"""
        # 先添加一個正在處理的任務
        task_key = f"{session_id}_0"
        service.processing_tasks[task_key] = AsyncMock()

        result = await service.process_audio_chunk(session_id, 0, sample_webm_data)

        assert result is False





    async def test_convert_webm_to_wav_success(self, service, sample_webm_data, mock_ffmpeg_process, session_id):
        """測試成功的 WebM 到 WAV 轉換"""
        mock_wav_data = b'RIFF' + b'\x00' * 1000
        mock_ffmpeg_process.communicate.return_value = (mock_wav_data, b'')

        with patch('asyncio.create_subprocess_exec', return_value=mock_ffmpeg_process):
            with patch('asyncio.wait_for', return_value=(mock_wav_data, b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result == mock_wav_data

    async def test_convert_webm_to_wav_ffmpeg_error(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 轉換錯誤"""
        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = (b'', b'FFmpeg error')

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'', b'FFmpeg error')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    async def test_convert_webm_to_wav_timeout(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 轉換超時"""
        with patch('asyncio.create_subprocess_exec'):
            with patch('asyncio.wait_for', side_effect=asyncio.TimeoutError):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    async def test_convert_webm_to_wav_insufficient_output(self, service, sample_webm_data, session_id):
        """測試 FFmpeg 輸出不足"""
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (b'small', b'')  # 太小的輸出

        with patch('asyncio.create_subprocess_exec', return_value=mock_process):
            with patch('asyncio.wait_for', return_value=(b'small', b'')):
                result = await service._convert_webm_to_wav(sample_webm_data, 0, session_id)

                assert result is None

    async def test_transcribe_audio_success(self, service, sample_webm_data, session_id, mock_writable_tempfile):
        """測試成功的 WebM 直接轉錄 (架構優化 v2)"""
        # Azure OpenAI API 直接回傳字串，不是物件
        service.client.audio.transcriptions.create.return_value = "  測試轉錄結果  "

        # 建立 mock 檔案物件 (使用 WebM 格式)
        mock_file = io.BytesIO(sample_webm_data)

        with patch('tempfile.NamedTemporaryFile', new_callable=mock_writable_tempfile):
            with patch('pathlib.Path.unlink'):
                with patch('builtins.open', return_value=mock_file):
                    result = await service._transcribe_audio(sample_webm_data, session_id, 0)
                    assert result is not None
                    assert result['text'] == "測試轉錄結果"
                    assert result['chunk_sequence'] == 0
                    assert result['session_id'] == str(session_id)

    async def test_transcribe_audio_empty_result(self, service, sample_webm_data, session_id, mock_writable_tempfile):
        """測試空的轉錄結果 (WebM 直接轉錄架構 v2)"""
        mock_response = SimpleNamespace(text="  ") # 只有空白
        service.client.audio.transcriptions.create.return_value = mock_response

        # 建立 mock 檔案物件 (使用 WebM 格式)
        mock_file = io.BytesIO(sample_webm_data)

        with patch('tempfile.NamedTemporaryFile', new_callable=mock_writable_tempfile):
            with patch('pathlib.Path.unlink'):
                with patch('builtins.open', return_value=mock_file):
                    result = await service._transcribe_audio(sample_webm_data, session_id, 0)

                    assert result is None

    async def test_transcribe_audio_api_error(self, service, sample_webm_data, session_id, mock_writable_tempfile):
        """測試 API 呼叫錯誤 (WebM 直接轉錄架構 v2)"""
        service.client.audio.transcriptions.create.side_effect = Exception("API Error")

        # 建立 mock 檔案物件 (使用 WebM 格式)
        mock_file = io.BytesIO(sample_webm_data)

        with patch('tempfile.NamedTemporaryFile', new_callable=mock_writable_tempfile):
            with patch('pathlib.Path.unlink'):
                with patch('builtins.open', return_value=mock_file):
                    result = await service._transcribe_audio(sample_webm_data, session_id, 0)

                    assert result is None

    async def test_save_and_push_result_success(self, service, session_id, transcript_result, mock_supabase_client):
        """測試成功儲存和推送轉錄結果"""
        # 設置 mock 返回有效數據
        mock_supabase_client.table.return_value.insert.return_value.execute.return_value.data = [
            {'id': 'test-segment-id'}
        ]
        
        with patch('app.services.azure_openai_v2.get_supabase_client', return_value=mock_supabase_client):
            # broadcast 是非同步函式，使用 AsyncMock
            with patch('app.ws.transcript_feed.manager.broadcast', new_callable=AsyncMock) as mock_broadcast:

                await service._save_and_push_result(session_id, 0, transcript_result)

                # 驗證資料庫儲存
                mock_supabase_client.table.assert_called_with("transcript_segments")

                # 驗證 WebSocket 推送 - 應該有多次廣播（active 階段 + 轉錄結果 + 完成通知）
                assert mock_broadcast.call_count >= 2

    async def test_save_and_push_result_database_error(self, service, session_id, transcript_result):
        """測試資料庫儲存錯誤"""
        mock_supabase_client = Mock()
        mock_supabase_client.table.side_effect = Exception("Database Error")

        with patch('app.services.azure_openai_v2.get_supabase_client', return_value=mock_supabase_client):
            # 應該不會拋出異常，只是記錄錯誤
            await service._save_and_push_result(session_id, 0, transcript_result)

    async def test_process_chunk_async_full_flow(self, service, session_id, sample_webm_data):
        """測試完整的切片處理流程 (WebM 直接轉錄架構 v2)"""
        mock_transcript = {
            'text': '完整流程測試',
            'chunk_sequence': 0,
            'session_id': str(session_id),
            'timestamp': '2024-01-01T00:00:00Z',
            'language': 'zh-TW',
            'duration': 12
        }

        with patch.object(service, '_validate_and_repair_webm_data', return_value=sample_webm_data):
            # 注意：新架構不再調用 _convert_webm_to_wav
            with patch.object(service, '_transcribe_audio', return_value=mock_transcript) as mock_transcribe:
                with patch.object(service, '_save_and_push_result') as mock_save:

                    await service._process_chunk_async(session_id, 0, sample_webm_data)

                    # 驗證直接使用 WebM 數據調用轉錄
                    mock_transcribe.assert_called_once_with(sample_webm_data, session_id, 0)
                    mock_save.assert_called_once_with(session_id, 0, mock_transcript)

    async def test_process_chunk_async_validation_failure(self, service, session_id, sample_webm_data):
        """測試驗證失敗的情況 (WebM 架構)"""
        with patch.object(service, '_validate_and_repair_webm_data', return_value=None):
            with patch.object(service, '_transcribe_audio') as mock_transcribe:

                await service._process_chunk_async(session_id, 0, sample_webm_data)

                # 驗證失敗後不應該呼叫轉錄
                mock_transcribe.assert_not_called()

    async def test_process_chunk_async_webm_validation_skipped(self, service, session_id, sample_webm_data):
        """測試 WebM 直接轉錄架構中跳過轉換步驟"""
        with patch.object(service, '_validate_and_repair_webm_data', return_value=sample_webm_data):
            # 在新架構中，我們直接調用轉錄，無需轉換
            with patch.object(service, '_transcribe_audio', return_value=None) as mock_transcribe:
                with patch.object(service, '_save_and_push_result') as mock_save:

                    await service._process_chunk_async(session_id, 0, sample_webm_data)

                    # 驗證直接使用 WebM 數據調用轉錄
                    mock_transcribe.assert_called_once_with(sample_webm_data, session_id, 0)
                    # 轉錄失敗後不應該呼叫儲存
                    mock_save.assert_not_called()

    async def test_process_chunk_async_transcription_failure(self, service, session_id, sample_webm_data):
        """測試轉錄失敗的情況 (WebM 直接轉錄)"""
        with patch.object(service, '_validate_and_repair_webm_data', return_value=sample_webm_data):
            # 新架構：直接轉錄 WebM，不進行 FFmpeg 轉換
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
            # 根據 suffix 決定檔案名稱，支援 WebM 格式
            suffix = kwargs.get('suffix', '.wav')
            if suffix == '.webm':
                self.name = "/tmp/fake_temp_file.webm"
            else:
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
