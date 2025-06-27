"""
Fragmented MP4 整合測試

測試 Safari 瀏覽器產生的 fragmented MP4 格式處理，包括：
- 格式檢測
- FFmpeg 轉換
- 錯誤恢復
- 智能重試策略
"""

import asyncio
import struct
from unittest.mock import AsyncMock, Mock, patch
from uuid import uuid4

import pytest

from app.core.ffmpeg import detect_audio_format, feed_ffmpeg_async
from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
from app.ws.upload_audio import AudioUploadManager


class TestFragmentedMP4Integration:
    """Fragmented MP4 格式整合測試"""

    @pytest.fixture
    def sample_fragmented_mp4_data(self):
        """
        模擬 Safari 產生的 fragmented MP4 數據
        包含典型的 fragmented MP4 標記：styp, moof, trun
        """
        # 構建 fragmented MP4 標頭
        ftyp_box = b'\x00\x00\x00\x20ftyp' + b'isom' + b'\x00\x00\x02\x00' + b'isomavc1mp41'
        styp_box = b'\x00\x00\x00\x14styp' + b'msdh' + b'\x00\x00\x00\x00' + b'msdh'
        moof_box = b'\x00\x00\x00\x10moof' + b'\x00\x00\x00\x08mfhd' + b'\x00\x00\x00\x01'

        # Track Fragment Header Box (tfhd)
        tfhd_box = b'\x00\x00\x00\x10tfhd' + b'\x00\x00\x00\x01' + b'\x00\x00\x00\x01'

        # Track Fragment Run Box (trun) - 這是導致錯誤的關鍵標記
        trun_box = b'\x00\x00\x00\x14trun' + b'\x00\x00\x00\x01' + b'\x00\x00\x00\x01' + b'\x00\x00\x00\x00'

        # Media Data Box (mdat)
        mdat_box = b'\x00\x00\x04\x00mdat' + b'\x00' * 1000  # 1KB 音訊數據

        return ftyp_box + styp_box + moof_box + tfhd_box + trun_box + mdat_box

    @pytest.fixture
    def sample_standard_mp4_data(self):
        """標準 MP4 數據（用於對比測試）"""
        ftyp_box = b'\x00\x00\x00\x20ftyp' + b'isom' + b'\x00\x00\x02\x00' + b'isomavc1mp41'
        moov_box = b'\x00\x00\x00\x10moov' + b'\x00\x00\x00\x08mvhd' + b'\x00\x00\x00\x01'
        mdat_box = b'\x00\x00\x04\x00mdat' + b'\x00' * 1000
        return ftyp_box + moov_box + mdat_box

    def test_fragmented_mp4_format_detection(self, sample_fragmented_mp4_data):
        """測試 fragmented MP4 格式檢測"""
        detected_format = detect_audio_format(sample_fragmented_mp4_data)

        assert detected_format == 'fmp4', f"期望檢測為 'fmp4'，實際為 '{detected_format}'"

    def test_standard_mp4_format_detection(self, sample_standard_mp4_data):
        """測試標準 MP4 格式檢測（確保與 fragmented MP4 區分）"""
        detected_format = detect_audio_format(sample_standard_mp4_data)

        assert detected_format == 'mp4', f"期望檢測為 'mp4'，實際為 '{detected_format}'"

    def test_fragmented_mp4_markers_detection(self):
        """測試各種 fragmented MP4 標記的檢測"""
        test_cases = [
            (b'styp' + b'\x00' * 100, 'fmp4'),  # Segment Type Box
            (b'moof' + b'\x00' * 100, 'fmp4'),  # Movie Fragment Box
            (b'sidx' + b'\x00' * 100, 'fmp4'),  # Segment Index Box
            (b'tfhd' + b'\x00' * 100, 'fmp4'),  # Track Fragment Header
            (b'trun' + b'\x00' * 100, 'fmp4'),  # Track Fragment Run
        ]

        for test_data, expected_format in test_cases:
            detected = detect_audio_format(test_data)
            assert detected == expected_format, f"標記 {test_data[:4]} 應檢測為 {expected_format}，實際為 {detected}"

    @pytest.mark.asyncio
    async def test_fragmented_mp4_conversion_success(self, sample_fragmented_mp4_data):
        """測試 fragmented MP4 成功轉換"""
        expected_pcm = b'\x00\x01' * 8000  # 模擬 16kHz mono PCM 數據

        # 模擬成功的 FFmpeg 進程
        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (expected_pcm, b'')

        with patch('ffmpeg.run_async', return_value=mock_process):
            result = await feed_ffmpeg_async(sample_fragmented_mp4_data)

            assert result == expected_pcm
            assert mock_process.communicate.called

    @pytest.mark.asyncio
    async def test_fragmented_mp4_retry_strategy(self, sample_fragmented_mp4_data):
        """測試 fragmented MP4 的智能重試策略"""

        # 模擬第一次失敗，第二次成功的場景
        expected_pcm = b'\x00\x01' * 8000

        call_count = 0

        def mock_run_async(*args, **kwargs):
            nonlocal call_count
            call_count += 1

            process = AsyncMock()
            if call_count == 1:  # 第一次嘗試失敗 (fmp4)
                process.returncode = 1
                process.communicate.return_value = (b'', b'could not find corresponding trex')
            else:  # 第二次嘗試成功 (mp4)
                process.returncode = 0
                process.communicate.return_value = (expected_pcm, b'')

            return process

        with patch('ffmpeg.run_async', side_effect=mock_run_async):
            result = await feed_ffmpeg_async(sample_fragmented_mp4_data)

            assert result == expected_pcm
            assert call_count == 2  # 確認進行了重試

    @pytest.mark.asyncio
    async def test_fragmented_mp4_trex_error_handling(self, sample_fragmented_mp4_data):
        """測試特定的 'trex' 錯誤處理"""

        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = (b'', b'could not find corresponding trex')

        with patch('ffmpeg.run_async', return_value=mock_process):
            with pytest.raises(RuntimeError) as exc_info:
                await feed_ffmpeg_async(sample_fragmented_mp4_data)

            error_msg = str(exc_info.value)
            assert 'trex' in error_msg or '智能重試策略失敗' in error_msg

    @pytest.mark.asyncio
    async def test_fragmented_mp4_trun_error_handling(self, sample_fragmented_mp4_data):
        """測試特定的 'trun' 錯誤處理"""

        mock_process = AsyncMock()
        mock_process.returncode = 1
        mock_process.communicate.return_value = (b'', b'trun track id unknown')

        with patch('ffmpeg.run_async', return_value=mock_process):
            with pytest.raises(RuntimeError) as exc_info:
                await feed_ffmpeg_async(sample_fragmented_mp4_data)

            error_msg = str(exc_info.value)
            assert 'trun' in error_msg or '智能重試策略失敗' in error_msg

    @pytest.mark.asyncio
    async def test_transcription_service_with_fragmented_mp4(self, mock_azure_client, session_id, sample_fragmented_mp4_data):
        """測試轉錄服務處理 fragmented MP4"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        expected_wav = b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000
        expected_transcript = '測試 fragmented MP4 轉錄結果'

        mock_azure_client.audio.transcriptions.create.return_value = expected_transcript

        with patch('app.core.ffmpeg.feed_ffmpeg_async', return_value=expected_wav) as mock_convert:
            with patch.object(service, '_save_and_push_result') as mock_save:
                await service._process_chunk_async(session_id, 0, sample_fragmented_mp4_data)

                mock_convert.assert_called_once_with(sample_fragmented_mp4_data)
                mock_azure_client.audio.transcriptions.create.assert_called_once()
                mock_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_websocket_upload_with_fragmented_mp4(self, mock_websocket, session_id, mock_supabase_client, sample_fragmented_mp4_data):
        """測試 WebSocket 上傳 fragmented MP4"""
        manager = AudioUploadManager(
            websocket=mock_websocket,
            session_id=session_id,
            supabase_client=mock_supabase_client
        )
        manager.is_connected = True
        manager.r2_client = AsyncMock()

        # 準備帶序號的音檔數據
        chunk_sequence = 0
        chunk_data = struct.pack('<I', chunk_sequence) + sample_fragmented_mp4_data

        manager.r2_client.store_chunk_blob.return_value = {'success': True}

        mock_service = AsyncMock()
        with patch('app.core.container.container.resolve', return_value=mock_service):
            await manager._handle_audio_chunk(chunk_data)

            if manager.upload_tasks:
                await asyncio.gather(*manager.upload_tasks.values())

            # 驗證處理流程
            assert chunk_sequence in manager.received_chunks
            mock_websocket.send_text.assert_called_once()
            mock_service.process_audio_chunk.assert_called_once()

    @pytest.mark.asyncio
    async def test_fragmented_mp4_error_diagnosis(self, sample_fragmented_mp4_data):
        """測試 fragmented MP4 錯誤診斷功能"""
        from app.core.ffmpeg import _generate_audio_diagnostics

        detected_format = detect_audio_format(sample_fragmented_mp4_data)
        diagnostics = _generate_audio_diagnostics(sample_fragmented_mp4_data, detected_format)

        assert 'fmp4' in diagnostics
        assert 'fragmented MP4' in diagnostics
        assert 'movflags' in diagnostics
        assert len(sample_fragmented_mp4_data) > 0

    @pytest.mark.asyncio
    async def test_fragmented_mp4_vs_standard_mp4_processing(self, sample_fragmented_mp4_data, sample_standard_mp4_data):
        """測試 fragmented MP4 與標準 MP4 的處理差異"""

        # 檢測格式差異
        fmp4_format = detect_audio_format(sample_fragmented_mp4_data)
        mp4_format = detect_audio_format(sample_standard_mp4_data)

        assert fmp4_format == 'fmp4'
        assert mp4_format == 'mp4'

        # 模擬轉換過程中使用不同的參數
        expected_pcm = b'\x00\x01' * 8000

        fmp4_process = AsyncMock()
        fmp4_process.returncode = 0
        fmp4_process.communicate.return_value = (expected_pcm, b'')

        mp4_process = AsyncMock()
        mp4_process.returncode = 0
        mp4_process.communicate.return_value = (expected_pcm, b'')

        with patch('ffmpeg.run_async', return_value=fmp4_process):
            fmp4_result = await feed_ffmpeg_async(sample_fragmented_mp4_data)

        with patch('ffmpeg.run_async', return_value=mp4_process):
            mp4_result = await feed_ffmpeg_async(sample_standard_mp4_data)

        # 兩者都應該成功轉換
        assert fmp4_result == expected_pcm
        assert mp4_result == expected_pcm

    @pytest.mark.asyncio
    async def test_fragmented_mp4_performance_timing(self, sample_fragmented_mp4_data):
        """測試 fragmented MP4 處理性能"""
        import time

        expected_pcm = b'\x00\x01' * 8000

        mock_process = AsyncMock()
        mock_process.returncode = 0
        mock_process.communicate.return_value = (expected_pcm, b'')

        with patch('ffmpeg.run_async', return_value=mock_process):
            start_time = time.time()
            result = await feed_ffmpeg_async(sample_fragmented_mp4_data)
            end_time = time.time()

            processing_time = end_time - start_time

            assert result == expected_pcm
            assert processing_time < 1.0  # 處理時間應該在1秒內

    @pytest.mark.asyncio
    async def test_multiple_fragmented_mp4_chunks(self, mock_azure_client, session_id):
        """測試處理多個 fragmented MP4 切片"""
        service = SimpleAudioTranscriptionService(
            azure_client=mock_azure_client,
            deployment_name="whisper-test"
        )

        # 創建多個不同的 fragmented MP4 切片
        chunks = []
        for i in range(3):
            # 每個切片有稍微不同的內容
            ftyp_box = b'\x00\x00\x00\x20ftyp' + b'isom' + b'\x00\x00\x02\x00' + b'isomavc1mp41'
            styp_box = b'\x00\x00\x00\x14styp' + b'msdh' + b'\x00\x00\x00\x00' + b'msdh'
            moof_box = b'\x00\x00\x00\x10moof' + b'\x00\x00\x00\x08mfhd' + struct.pack('>I', i + 1)
            trun_box = b'\x00\x00\x00\x14trun' + b'\x00\x00\x00\x01' + struct.pack('>I', i + 1) + b'\x00\x00\x00\x00'
            mdat_box = b'\x00\x00\x04\x00mdat' + bytes([i] * 1000)

            chunks.append(ftyp_box + styp_box + moof_box + trun_box + mdat_box)

        expected_wav = b'RIFF' + (1000).to_bytes(4, 'little') + b'WAVE' + b'\x00' * 1000
        expected_transcript = '多切片轉錄結果'

        mock_azure_client.audio.transcriptions.create.return_value = expected_transcript

        with patch('app.core.ffmpeg.feed_ffmpeg_async', return_value=expected_wav):
            with patch.object(service, '_save_and_push_result') as mock_save:
                # 並行處理所有切片
                tasks = [
                    service._process_chunk_async(session_id, i, chunk)
                    for i, chunk in enumerate(chunks)
                ]

                await asyncio.gather(*tasks)

                # 驗證所有切片都被處理
                assert mock_save.call_count == len(chunks)
                assert mock_azure_client.audio.transcriptions.create.call_count == len(chunks)
