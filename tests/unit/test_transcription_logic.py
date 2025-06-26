"""
測試轉錄邏輯的核心功能

專注於「一段一轉」架構的核心邏輯，不涉及資料庫連接
"""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch
from uuid import UUID, uuid4

import pytest


class MockSimpleAudioTranscriptionService:
    """模擬的轉錄服務，用於測試核心邏輯"""

    def __init__(self, azure_client, deployment_name: str):
        self.client = azure_client
        self.deployment_name = deployment_name
        self.processing_tasks = {}

    async def process_audio_chunk(self, session_id: UUID, chunk_sequence: int, webm_data: bytes) -> bool:
        """處理音訊切片"""
        task_key = f"{session_id}_{chunk_sequence}"

        if task_key in self.processing_tasks:
            return False

        task = asyncio.create_task(
            self._process_chunk_async(session_id, chunk_sequence, webm_data)
        )
        self.processing_tasks[task_key] = task
        task.add_done_callback(lambda t: self.processing_tasks.pop(task_key, None))

        return True

    async def _process_chunk_async(self, session_id: UUID, chunk_sequence: int, webm_data: bytes):
        """非同步處理切片"""
        # 驗證資料
        if not self._validate_webm_data(webm_data, chunk_sequence):
            return

        # 轉換 WebM 到 WAV
        wav_data = await self._convert_webm_to_wav(webm_data, chunk_sequence)
        if not wav_data:
            return

        # 轉錄音訊
        transcript_result = await self._transcribe_audio(wav_data, session_id, chunk_sequence)
        if not transcript_result:
            return

        # 儲存和推送結果
        await self._save_and_push_result(session_id, chunk_sequence, transcript_result)

    def _validate_webm_data(self, webm_data: bytes, chunk_sequence: int) -> bool:
        """驗證 WebM 資料"""
        if not webm_data or len(webm_data) < 50:
            return False
        return True

    async def _convert_webm_to_wav(self, webm_data: bytes, chunk_sequence: int) -> bytes:
        """模擬 WebM 到 WAV 轉換"""
        # 模擬 FFmpeg 轉換
        await asyncio.sleep(0.01)  # 模擬處理時間
        return b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000

    async def _transcribe_audio(self, wav_data: bytes, session_id: UUID, chunk_sequence: int) -> dict:
        """模擬音訊轉錄"""
        await asyncio.sleep(0.01)  # 模擬 API 呼叫
        return {
            'text': f'測試轉錄結果 {chunk_sequence}',
            'chunk_sequence': chunk_sequence,
            'session_id': str(session_id),
            'timestamp': '2024-01-01T00:00:00Z',
            'language': 'zh-TW',
            'duration': 12
        }

    async def _save_and_push_result(self, session_id: UUID, chunk_sequence: int, transcript_result: dict):
        """模擬儲存和推送結果"""
        await asyncio.sleep(0.01)  # 模擬資料庫操作


class TestTranscriptionLogic:
    """測試轉錄邏輯"""

    @pytest.fixture
    def session_id(self):
        """測試會話 ID"""
        return uuid4()

    @pytest.fixture
    def mock_azure_client(self):
        """模擬 Azure 客戶端"""
        client = Mock()
        client.audio.transcriptions.create.return_value = "測試轉錄結果"
        return client

    @pytest.fixture
    def service(self, mock_azure_client):
        """轉錄服務實例"""
        return MockSimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

    @pytest.fixture
    def sample_webm_data(self):
        """樣本 WebM 資料"""
        return b'\x1a\x45\xdf\xa3' + b'\x00' * 1000

    def test_service_initialization(self, mock_azure_client):
        """測試服務初始化"""
        service = MockSimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="test-deployment"
        )

        assert service.client == mock_azure_client
        assert service.deployment_name == "test-deployment"
        assert service.processing_tasks == {}

    @pytest.mark.asyncio
    async def test_process_audio_chunk_success(self, service, session_id, sample_webm_data):
        """測試成功處理音訊切片"""
        result = await service.process_audio_chunk(session_id, 0, sample_webm_data)

        assert result is True
        assert f"{session_id}_0" in service.processing_tasks

    @pytest.mark.asyncio
    async def test_process_audio_chunk_duplicate(self, service, session_id, sample_webm_data):
        """測試重複處理同一切片"""
        # 第一次處理
        result1 = await service.process_audio_chunk(session_id, 0, sample_webm_data)
        assert result1 is True

        # 第二次處理同一切片
        result2 = await service.process_audio_chunk(session_id, 0, sample_webm_data)
        assert result2 is False

    def test_validate_webm_data_valid(self, service, sample_webm_data):
        """測試有效的 WebM 資料驗證"""
        result = service._validate_webm_data(sample_webm_data, 0)
        assert result is True

    def test_validate_webm_data_too_small(self, service):
        """測試過小的 WebM 資料"""
        small_data = b'\x00' * 10
        result = service._validate_webm_data(small_data, 0)
        assert result is False

    def test_validate_webm_data_empty(self, service):
        """測試空的 WebM 資料"""
        result = service._validate_webm_data(b'', 0)
        assert result is False

    @pytest.mark.asyncio
    async def test_convert_webm_to_wav(self, service, sample_webm_data):
        """測試 WebM 到 WAV 轉換"""
        result = await service._convert_webm_to_wav(sample_webm_data, 0)

        assert result is not None
        assert result.startswith(b'RIFF')
        assert b'WAVE' in result

    @pytest.mark.asyncio
    async def test_transcribe_audio(self, service, session_id):
        """測試音訊轉錄"""
        wav_data = b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000

        result = await service._transcribe_audio(wav_data, session_id, 0)

        assert result is not None
        assert result['text'] == '測試轉錄結果 0'
        assert result['chunk_sequence'] == 0
        assert result['session_id'] == str(session_id)
        assert result['language'] == 'zh-TW'

    @pytest.mark.asyncio
    async def test_save_and_push_result(self, service, session_id):
        """測試儲存和推送結果"""
        transcript_result = {
            'text': '測試結果',
            'chunk_sequence': 0,
            'session_id': str(session_id),
            'timestamp': '2024-01-01T00:00:00Z',
            'language': 'zh-TW',
            'duration': 12
        }

        # 應該不會拋出異常
        await service._save_and_push_result(session_id, 0, transcript_result)

    @pytest.mark.asyncio
    async def test_complete_processing_flow(self, service, session_id, sample_webm_data):
        """測試完整的處理流程"""
        # 啟動處理
        result = await service.process_audio_chunk(session_id, 0, sample_webm_data)
        assert result is True

        # 等待處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values(), return_exceptions=True)

        # 處理完成後任務應該被清理
        assert len(service.processing_tasks) == 0

    @pytest.mark.asyncio
    async def test_concurrent_processing(self, service, session_id, sample_webm_data):
        """測試並行處理多個切片"""
        # 同時處理多個切片
        tasks = []
        for i in range(3):
            task = service.process_audio_chunk(session_id, i, sample_webm_data)
            tasks.append(task)

        results = await asyncio.gather(*tasks)

        # 所有切片都應該成功啟動處理
        assert all(results)
        assert len(service.processing_tasks) == 3

        # 等待所有處理完成
        await asyncio.gather(*service.processing_tasks.values(), return_exceptions=True)

        # 所有任務應該被清理
        assert len(service.processing_tasks) == 0

    @pytest.mark.asyncio
    async def test_performance_timing(self, service, session_id, sample_webm_data):
        """測試處理性能"""
        import time

        start_time = time.time()

        # 處理切片
        await service.process_audio_chunk(session_id, 0, sample_webm_data)

        # 等待處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values())

        end_time = time.time()
        processing_time = end_time - start_time

        # 驗證處理時間合理（模擬環境應該很快）
        assert processing_time < 1.0  # 少於 1 秒

    @pytest.mark.asyncio
    async def test_error_handling_invalid_data(self, service, session_id):
        """測試無效資料的錯誤處理"""
        invalid_data = b''  # 空資料

        # 處理無效資料
        result = await service.process_audio_chunk(session_id, 0, invalid_data)
        assert result is True  # 任務啟動成功

        # 等待處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values(), return_exceptions=True)

        # 任務應該被清理
        assert len(service.processing_tasks) == 0


class TestChunkProcessingFlow:
    """測試切片處理流程"""

    @pytest.mark.asyncio
    async def test_twelve_second_chunks(self):
        """測試 12 秒切片的處理"""
        # 模擬 12 秒切片的資料量（假設 16kHz, 16-bit, mono）
        # 12 秒 * 16000 Hz * 2 bytes = 384,000 bytes
        chunk_size = 12 * 16000 * 2

        mock_client = Mock()
        service = MockSimpleAudioTranscriptionService(mock_client, "whisper-test")

        # 建立 12 秒的音訊資料
        audio_data = b'\x1a\x45\xdf\xa3' + b'\x00' * chunk_size
        session_id = uuid4()

        # 處理切片
        result = await service.process_audio_chunk(session_id, 0, audio_data)
        assert result is True

        # 等待處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values())

    @pytest.mark.asyncio
    async def test_sequential_chunks(self):
        """測試順序處理多個切片"""
        mock_client = Mock()
        service = MockSimpleAudioTranscriptionService(mock_client, "whisper-test")
        session_id = uuid4()

        # 模擬連續的音訊切片
        chunks = []
        for i in range(5):
            audio_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000
            chunks.append((i, audio_data))

        # 順序處理切片
        for chunk_seq, audio_data in chunks:
            result = await service.process_audio_chunk(session_id, chunk_seq, audio_data)
            assert result is True

        # 等待所有處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values(), return_exceptions=True)

        # 所有任務應該被清理
        assert len(service.processing_tasks) == 0

    @pytest.mark.asyncio
    async def test_low_latency_processing(self):
        """測試低延遲處理"""
        mock_client = Mock()
        service = MockSimpleAudioTranscriptionService(mock_client, "whisper-test")
        session_id = uuid4()

        audio_data = b'\x1a\x45\xdf\xa3' + b'\x00' * 1000

        # 測量端到端延遲
        import time
        start_time = time.time()

        # 啟動處理
        await service.process_audio_chunk(session_id, 0, audio_data)

        # 等待處理完成
        if service.processing_tasks:
            await asyncio.gather(*service.processing_tasks.values())

        end_time = time.time()
        latency = end_time - start_time

        # 驗證低延遲（模擬環境）
        assert latency < 0.5  # 少於 500ms
