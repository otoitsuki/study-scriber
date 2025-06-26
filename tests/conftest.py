"""
pytest 配置檔案

提供測試所需的共用 fixtures 和配置
"""

import asyncio
import os
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Generator
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest
from openai import AzureOpenAI

# 設定測試環境變數
os.environ.update({
    "AZURE_OPENAI_API_KEY": "test-key",
    "AZURE_OPENAI_ENDPOINT": "https://test.openai.azure.com/",
    "WHISPER_DEPLOYMENT_NAME": "whisper-test",
    "SUPABASE_URL": "https://test.supabase.co",
    "SUPABASE_KEY": "test-key",
    "R2_ACCOUNT_ID": "test-account",
    "R2_ACCESS_KEY_ID": "test-access-key",
    "R2_SECRET_ACCESS_KEY": "test-secret-key",
    "R2_BUCKET_NAME": "test-bucket",
    "DATABASE_URL": "sqlite:///test.db",  # 使用 SQLite 測試資料庫
    "TESTING": "true"  # 測試模式標誌
})


@pytest.fixture
def session_id() -> UUID:
    """測試用的會話 ID"""
    return uuid4()


@pytest.fixture
def mock_azure_client() -> Mock:
    """模擬的 Azure OpenAI 客戶端"""
    client = Mock(spec=AzureOpenAI)

    # 模擬轉錄 API 回應
    client.audio.transcriptions.create.return_value = "這是測試轉錄結果"

    return client


@pytest.fixture
def mock_supabase_client() -> Mock:
    """模擬的 Supabase 客戶端"""
    client = Mock()

    # 模擬資料庫操作
    mock_response = Mock()
    mock_response.data = [{"id": 1, "session_id": "test-session"}]
    client.table.return_value.insert.return_value.execute.return_value = mock_response
    client.table.return_value.select.return_value.eq.return_value.execute.return_value = mock_response

    return client


@pytest.fixture
def sample_webm_data() -> bytes:
    """樣本 WebM 音訊資料"""
    # 建立一個最小的 WebM 檔案結構
    # EBML 標頭 + 基本資料
    ebml_header = b'\x1a\x45\xdf\xa3'  # EBML 標識
    sample_data = b'\x00' * 1000  # 1KB 的樣本資料
    return ebml_header + sample_data


@pytest.fixture
def sample_wav_data() -> bytes:
    """樣本 WAV 音訊資料"""
    # 建立一個最小的 WAV 檔案結構
    wav_header = b'RIFF'
    wav_size = (1000).to_bytes(4, 'little')
    wav_format = b'WAVE'
    sample_data = b'\x00' * 1000
    return wav_header + wav_size + wav_format + sample_data


@pytest.fixture
def temp_audio_file() -> Generator[Path, None, None]:
    """臨時音訊檔案"""
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        # 寫入基本的 WAV 標頭
        f.write(b'RIFF')
        f.write((1000).to_bytes(4, 'little'))
        f.write(b'WAVE')
        f.write(b'\x00' * 1000)
        f.flush()

        yield Path(f.name)

        # 清理
        Path(f.name).unlink(missing_ok=True)


@pytest.fixture
def mock_ffmpeg_process() -> AsyncMock:
    """模擬的 FFmpeg 程序"""
    process = AsyncMock()
    process.returncode = 0
    process.communicate.return_value = (b'mock_wav_data', b'')
    return process


@pytest.fixture(scope="session")
def event_loop():
    """提供事件循環給整個測試會話"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def mock_websocket() -> AsyncMock:
    """模擬的 WebSocket 連接"""
    websocket = AsyncMock()
    websocket.accept = AsyncMock()
    websocket.send_text = AsyncMock()
    websocket.receive = AsyncMock()
    websocket.close = AsyncMock()
    return websocket


@pytest.fixture
def transcript_result() -> dict:
    """樣本轉錄結果"""
    return {
        'text': '這是測試轉錄結果',
        'chunk_sequence': 0,
        'session_id': 'test-session-id',
        'timestamp': '2024-01-01T00:00:00Z',
        'language': 'zh-TW',
        'duration': 12
    }


# 測試用的常數
TEST_CHUNK_SIZE = 1024
TEST_CHUNK_SEQUENCE = 0
TEST_SESSION_ID = "test-session-id"
