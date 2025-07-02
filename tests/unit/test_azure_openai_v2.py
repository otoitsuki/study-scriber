"""
測試 Azure OpenAI v2 轉錄服務

測試「一段一轉」架構的核心轉錄邏輯
"""

import asyncio
import tempfile
import time
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID, uuid4
import io
import logging
import unittest.mock

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

class TestWhisperSegmentFiltering:
    """測試 Whisper 段落過濾功能"""

    def test_keep_function_valid_segment(self):
        """測試保留有效段落"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
        from app.core.config import settings

        # 模擬有效的 verbose_json 段落
        valid_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "這是一段正常的語音轉錄文字",
            "tokens": [1234, 5678],
            "temperature": 0.0,
            "avg_logprob": -0.3,
            "compression_ratio": 1.8,
            "no_speech_prob": 0.1
        }

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")
        result = service._keep(valid_segment)

        # 應該保留有效段落
        assert result is True

    def test_keep_function_high_no_speech_prob(self):
        """測試過濾高靜音機率段落"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        # 模擬高靜音機率段落
        high_no_speech_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "um, uh, er...",
            "tokens": [1234],
            "temperature": 0.0,
            "avg_logprob": -0.5,
            "compression_ratio": 1.5,
            "no_speech_prob": 0.9  # 超過預設門檻 0.8
        }

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")
        result = service._keep(high_no_speech_segment)

        # 應該過濾掉高靜音機率段落
        assert result is False

    def test_keep_function_low_confidence(self):
        """測試過濾低置信度段落"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        # 模擬低置信度段落
        low_confidence_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "不確定的轉錄內容",
            "tokens": [1234],
            "temperature": 0.0,
            "avg_logprob": -1.5,  # 低於預設門檻 -1.0
            "compression_ratio": 1.8,
            "no_speech_prob": 0.3
        }

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")
        result = service._keep(low_confidence_segment)

        # 應該過濾掉低置信度段落
        assert result is False

    def test_keep_function_high_compression_ratio(self):
        """測試過濾高重複比率段落"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        # 模擬高重複比率段落（通常是幻覺）
        high_compression_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "重複重複重複重複重複重複重複重複重複重複",
            "tokens": [1234] * 20,  # 很多重複 token
            "temperature": 0.0,
            "avg_logprob": -0.2,
            "compression_ratio": 3.0,  # 超過預設門檻 2.4
            "no_speech_prob": 0.2
        }

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")
        result = service._keep(high_compression_segment)

        # 應該過濾掉高重複比率段落
        assert result is False

    def test_keep_function_boundary_values(self):
        """測試邊界值情況"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")

        # 測試剛好在門檻值的情況
        boundary_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "邊界測試",
            "tokens": [1234],
            "temperature": 0.0,
            "avg_logprob": -1.0,      # 等於門檻值
            "compression_ratio": 2.4,  # 等於門檻值
            "no_speech_prob": 0.8      # 等於門檻值
        }

        # 等於門檻值的情況應該被保留（使用 >= 和 > 判斷）
        result = service._keep(boundary_segment)
        assert result is False  # no_speech_prob >= 0.8 應該被過濾

    def test_keep_function_missing_fields(self):
        """測試缺少必要欄位的段落"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")

        # 測試缺少必要欄位的情況
        incomplete_segment = {
            "id": 0,
            "text": "缺少其他欄位",
        }

        # 缺少必要欄位應該回傳 False
        result = service._keep(incomplete_segment)
        assert result is False

    @patch('app.services.azure_openai_v2.PROMETHEUS_AVAILABLE', True)
    def test_prometheus_counter_increment(self):
        """測試 Prometheus 計數器正確遞增"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        with patch('app.services.azure_openai_v2.WHISPER_SEGMENTS_FILTERED') as mock_counter:
            service = SimpleAudioTranscriptionService(Mock(), "whisper-test")

            # 測試過濾段落時計數器遞增
            filtered_segment = {
                "id": 0,
                "seek": 0,
                "start": 0.0,
                "end": 5.0,
                "text": "靜音段落",
                "tokens": [1234],
                "temperature": 0.0,
                "avg_logprob": -0.5,
                "compression_ratio": 1.8,
                "no_speech_prob": 0.9  # 會被過濾
            }

            service._keep(filtered_segment)

            # 檢查計數器是否被調用，使用正確的標籤
            mock_counter.labels.assert_called_once_with(
                reason="no_speech",
                deployment="whisper-test"
            )
            mock_counter.labels.return_value.inc.assert_called_once()

    def test_keep_function_multiple_filter_conditions(self):
        """測試多個過濾條件同時滿足的情況"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")

        # 同時滿足多個過濾條件
        multiple_issues_segment = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "問題重重的段落",
            "tokens": [1234],
            "temperature": 0.0,
            "avg_logprob": -2.0,     # 低置信度
            "compression_ratio": 3.5, # 高重複比率
            "no_speech_prob": 0.95    # 高靜音機率
        }

        # 應該被過濾（依據第一個匹配的條件）
        result = service._keep(multiple_issues_segment)
        assert result is False

    def test_keep_function_with_custom_thresholds(self):
        """測試使用自定義門檻值的情況"""
        from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
        from app.core.config import settings

        service = SimpleAudioTranscriptionService(Mock(), "whisper-test")

        # 使用當前配置的門檻值進行測試
        segment_near_threshold = {
            "id": 0,
            "seek": 0,
            "start": 0.0,
            "end": 5.0,
            "text": "接近門檻值的段落",
            "tokens": [1234],
            "temperature": 0.0,
            "avg_logprob": settings.FILTER_LOGPROB + 0.1,      # 稍微高於門檻
            "compression_ratio": settings.FILTER_COMPRESSION - 0.1, # 稍微低於門檻
            "no_speech_prob": settings.FILTER_NO_SPEECH - 0.1       # 稍微低於門檻
        }

        # 應該被保留
        result = service._keep(segment_near_threshold)
        assert result is True

class TestTranscribeAudioVerboseJson:
    """測試 _transcribe_audio 方法使用 verbose_json 格式和段落過濾功能"""

    @pytest.fixture
    def service(self):
        """創建測試用的轉錄服務實例"""
        mock_client = Mock()
        return SimpleAudioTranscriptionService(mock_client, "whisper-test")

    @pytest.fixture
    def sample_webm_data(self):
        """模擬 WebM 音訊數據"""
        return b'\x1aE\xdf\xa3' + b'\x00' * 1000  # 簡單的 WebM 檔頭 + 數據

    @pytest.fixture
    def sample_verbose_json_response(self):
        """模擬 Whisper API verbose_json 回應"""
        return {
            "task": "transcribe",
            "language": "zh",
            "duration": 10.0,
            "text": "這是一段測試語音 低品質的內容",
            "segments": [
                {
                    "id": 0,
                    "seek": 0,
                    "start": 0.0,
                    "end": 5.0,
                    "text": "這是一段測試語音",
                    "tokens": [1234, 5678, 9012],
                    "temperature": 0.0,
                    "avg_logprob": -0.3,
                    "compression_ratio": 1.8,
                    "no_speech_prob": 0.1
                },
                {
                    "id": 1,
                    "seek": 500,
                    "start": 5.0,
                    "end": 10.0,
                    "text": "低品質的內容",
                    "tokens": [3456, 7890],
                    "temperature": 0.0,
                    "avg_logprob": -1.5,  # 低置信度，會被過濾
                    "compression_ratio": 2.0,
                    "no_speech_prob": 0.3
                }
            ]
        }

    @pytest.mark.asyncio
    async def test_transcribe_audio_verbose_json_success_with_filtering(self, service, sample_webm_data, sample_verbose_json_response):
        """測試使用 verbose_json 格式成功轉錄並過濾低品質段落"""
        session_id = uuid4()
        chunk_sequence = 1

        # 模擬 Azure OpenAI 客戶端回應
        mock_response = Mock()
        mock_response.segments = [
            Mock(**segment) for segment in sample_verbose_json_response['segments']
        ]
        mock_response.duration = sample_verbose_json_response['duration']
        mock_response.language = sample_verbose_json_response['language']
        mock_response.task = sample_verbose_json_response['task']
        mock_response.text = sample_verbose_json_response['text']

        service.client.audio.transcriptions.create = AsyncMock(return_value=mock_response)

        # 模擬 _keep 方法的行為（第一段保留，第二段過濾）
        def mock_keep(segment):
            return segment['avg_logprob'] >= -1.0
        service._keep = Mock(side_effect=mock_keep)

        # 執行轉錄
        result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # 驗證結果
        assert result is not None
        assert result['text'] == "這是一段測試語音"  # 只包含通過過濾的段落
        assert result['chunk_sequence'] == chunk_sequence
        assert result['session_id'] == str(session_id)

        # 驗證 API 調用使用 verbose_json
        service.client.audio.transcriptions.create.assert_called_once()
        call_args = service.client.audio.transcriptions.create.call_args
        assert call_args.kwargs['response_format'] == "verbose_json"
        assert call_args.kwargs['model'] == "whisper-test"

        # 驗證過濾函數被調用
        assert service._keep.call_count == 2  # 兩個段落都被檢查

    @pytest.mark.asyncio
    async def test_transcribe_audio_all_segments_filtered(self, service, sample_webm_data):
        """測試所有段落都被過濾的情況"""
        session_id = uuid4()
        chunk_sequence = 1

        # 模擬包含低品質段落的回應
        low_quality_response = {
            "task": "transcribe",
            "language": "zh",
            "duration": 10.0,
            "text": "低品質內容 更低品質內容",
            "segments": [
                {
                    "id": 0,
                    "seek": 0,
                    "start": 0.0,
                    "end": 5.0,
                    "text": "低品質內容",
                    "tokens": [1234],
                    "temperature": 0.0,
                    "avg_logprob": -2.0,  # 低置信度
                    "compression_ratio": 1.8,
                    "no_speech_prob": 0.3
                },
                {
                    "id": 1,
                    "seek": 500,
                    "start": 5.0,
                    "end": 10.0,
                    "text": "更低品質內容",
                    "tokens": [5678],
                    "temperature": 0.0,
                    "avg_logprob": -2.5,  # 更低置信度
                    "compression_ratio": 2.0,
                    "no_speech_prob": 0.4
                }
            ]
        }

        mock_response = Mock()
        mock_response.segments = [
            Mock(**segment) for segment in low_quality_response['segments']
        ]
        mock_response.duration = low_quality_response['duration']
        mock_response.language = low_quality_response['language']
        mock_response.task = low_quality_response['task']
        mock_response.text = low_quality_response['text']

        service.client.audio.transcriptions.create = AsyncMock(return_value=mock_response)

        # 模擬所有段落都被過濾
        service._keep = Mock(return_value=False)

        # 執行轉錄
        result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # 所有段落被過濾，應該返回 None
        assert result is None

        # 驗證過濾函數被調用
        assert service._keep.call_count == 2

    @pytest.mark.asyncio
    async def test_transcribe_audio_empty_segments(self, service, sample_webm_data):
        """測試沒有段落的情況"""
        session_id = uuid4()
        chunk_sequence = 1

        # 模擬沒有段落的回應
        empty_response = {
            "task": "transcribe",
            "language": "zh",
            "duration": 10.0,
            "text": "",
            "segments": []
        }

        mock_response = Mock()
        mock_response.segments = empty_response['segments']  # 空列表
        mock_response.duration = empty_response['duration']
        mock_response.language = empty_response['language']
        mock_response.task = empty_response['task']
        mock_response.text = empty_response['text']

        service.client.audio.transcriptions.create = AsyncMock(return_value=mock_response)
        service._keep = Mock()

        # 執行轉錄
        result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # 沒有段落，應該返回 None
        assert result is None

        # 過濾函數不應該被調用
        service._keep.assert_not_called()

    @pytest.mark.asyncio
    async def test_transcribe_audio_verbose_json_api_error(self, service, sample_webm_data):
        """測試 API 調用異常的情況"""
        session_id = uuid4()
        chunk_sequence = 1

        # 模擬 API 異常
        service.client.audio.transcriptions.create = AsyncMock(side_effect=Exception("API Error"))
        service._broadcast_transcription_error = AsyncMock()

        # 執行轉錄
        result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # API 異常，應該返回 None
        assert result is None

        # 驗證錯誤廣播被調用
        service._broadcast_transcription_error.assert_called_once_with(
            session_id, chunk_sequence, "whisper_api_error", unittest.mock.ANY
        )

    @pytest.mark.asyncio
    async def test_transcribe_audio_rate_limit_error(self, service, sample_webm_data):
        """測試頻率限制錯誤的情況"""
        session_id = uuid4()
        chunk_sequence = 1

        # 模擬頻率限制錯誤
        from openai import RateLimitError
        service.client.audio.transcriptions.create = AsyncMock(side_effect=RateLimitError("Rate limit exceeded", response=Mock(), body=None))
        service._broadcast_transcription_error = AsyncMock()

        # 執行轉錄
        result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # 頻率限制錯誤，應該返回 None
        assert result is None

        # 驗證錯誤廣播被調用
        service._broadcast_transcription_error.assert_called_once_with(
            session_id, chunk_sequence, "rate_limit_error", unittest.mock.ANY
        )

    @pytest.mark.asyncio
    async def test_transcribe_audio_logs_filtering_details(self, service, sample_webm_data, sample_verbose_json_response, caplog):
        """測試詳細的過濾日誌記錄"""
        session_id = uuid4()
        chunk_sequence = 1

        mock_response = Mock()
        mock_response.segments = [
            Mock(**segment) for segment in sample_verbose_json_response['segments']
        ]
        mock_response.duration = sample_verbose_json_response['duration']
        mock_response.language = sample_verbose_json_response['language']
        mock_response.task = sample_verbose_json_response['task']
        mock_response.text = sample_verbose_json_response['text']

        service.client.audio.transcriptions.create = AsyncMock(return_value=mock_response)

        # 模擬 _keep 方法並記錄調用
        original_segments = sample_verbose_json_response['segments']
        keep_calls = []
        def mock_keep(segment):
            keep_calls.append(segment)
            return segment['avg_logprob'] >= -1.0
        service._keep = Mock(side_effect=mock_keep)

        with caplog.at_level(logging.INFO):
            result = await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

        # 驗證結果和日誌
        assert result is not None
        assert "段落過濾統計" in caplog.text or len(keep_calls) == 2

        # 驗證 _keep 被正確調用
        assert len(keep_calls) == 2
        assert keep_calls[0] == original_segments[0]
        assert keep_calls[1] == original_segments[1]

    @pytest.mark.asyncio
    async def test_transcribe_audio_prometheus_metrics_updated(self, service, sample_webm_data, sample_verbose_json_response):
        """測試 Prometheus 指標正確更新"""
        session_id = uuid4()
        chunk_sequence = 1

        mock_response = Mock()
        mock_response.segments = [
            Mock(**segment) for segment in sample_verbose_json_response['segments']
        ]
        mock_response.duration = sample_verbose_json_response['duration']
        mock_response.language = sample_verbose_json_response['language']
        mock_response.task = sample_verbose_json_response['task']
        mock_response.text = sample_verbose_json_response['text']

        service.client.audio.transcriptions.create = AsyncMock(return_value=mock_response)
        service._keep = Mock(return_value=True)  # 所有段落都保留

        with patch('app.services.azure_openai_v2.WHISPER_REQ_TOTAL') as mock_counter:
            await service._transcribe_audio(sample_webm_data, session_id, chunk_sequence)

            # 驗證成功指標被更新
            mock_counter.labels.assert_called_with(status="success", deployment="whisper-test")
            mock_counter.labels.return_value.inc.assert_called_once()
