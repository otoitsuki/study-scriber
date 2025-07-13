"""
FFmpeg 音訊轉換服務 (REST API 簡化架構)

實作 WebM 到 16kHz mono PCM 的轉換，專門處理完整 10s 檔案
"""

import asyncio
import subprocess
import shlex
import logging
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# FFmpeg 命令：WebM 輸入 → 16kHz 單聲道 PCM 輸出
FFMPEG_CMD = "ffmpeg -i pipe:0 -ac 1 -ar 16000 -f s16le pipe:1 -loglevel error"


@dataclass
class WebMHeaderInfo:
    """WebM 檔頭信息數據類"""
    is_complete: bool = False
    has_ebml_header: bool = False
    has_segment: bool = False
    header_size: int = 0
    codec_type: str = "unknown"
    track_count: int = 0
    error_message: Optional[str] = None


def detect_webm_header_info(data: bytes) -> WebMHeaderInfo:
    """
    檢測 WebM 檔頭信息

    Args:
        data: WebM 音頻二進制數據

    Returns:
        WebMHeaderInfo: 檔頭信息
    """
    info = WebMHeaderInfo()

    if not data or len(data) < 16:
        info.error_message = "數據長度不足"
        return info

    try:
        # 檢查 EBML 標頭 (0x1A45DFA3)
        if data[:4] == b'\x1A\x45\xDF\xA3':
            info.has_ebml_header = True

            # 簡單檢測 Segment 元素 (0x18538067)
            if b'\x18\x53\x80\x67' in data[:1024]:
                info.has_segment = True

                # 估算檔頭大小（簡化版本）
                cluster_pos = data.find(b'\x1F\x43\xB6\x75')  # Cluster 標記
                if cluster_pos > 0:
                    info.header_size = cluster_pos
                else:
                    info.header_size = min(len(data), 512)  # 預設估算

                info.is_complete = True
                info.codec_type = "opus" if b'Opus' in data[:1024] else "vorbis"
                info.track_count = 1  # 簡化假設只有一個音軌
            else:
                info.error_message = "缺少 Segment 元素"
        else:
            info.error_message = "缺少 EBML 檔頭"

    except Exception as e:
        info.error_message = f"檢測異常: {str(e)}"

    return info


def is_webm_header_complete(data: bytes) -> bool:
    """
    檢查 WebM 檔頭是否完整

    Args:
        data: WebM 音頻二進制數據

    Returns:
        bool: 如果檔頭完整則返回 True
    """
    if not data or len(data) < 16:
        return False

    # 檢查 EBML 檔頭
    if data[:4] != b'\x1A\x45\xDF\xA3':
        return False

    # 檢查是否包含 Segment 元素
    return b'\x18\x53\x80\x67' in data[:1024]


def detect_audio_format(audio_data: bytes) -> str:
    """
    檢測音頻格式

    Args:
        audio_data: 音頻二進制數據

    Returns:
        str: 檢測到的音頻格式 ('webm', 'mp4', 'ogg', 'wav', 'unknown')
    """
    if not audio_data or len(audio_data) < 16:
        return 'unknown'

    # 檢查檔案頭簽名
    header = audio_data[:16]

    # WebM 格式 (EBML header)
    if header.startswith(b'\x1A\x45\xDF\xA3'):
        return 'webm'

    # MP4 格式 (ftypMSNV for fragmented MP4, ftyp for regular MP4)
    if b'ftyp' in header[:8] or header[4:8] == b'ftyp':
        return 'mp4'

    # OGG 格式
    if header.startswith(b'OggS'):
        return 'ogg'

    # WAV 格式 (RIFF header)
    if header.startswith(b'RIFF') and header[8:12] == b'WAVE':
        return 'wav'

    # 檢查更大範圍內的 MP4 格式標識
    search_range = min(len(audio_data), 64)
    for i in range(search_range - 4):
        if audio_data[i:i+4] == b'ftyp':
            return 'mp4'

    logger.debug(f"Unknown audio format, header: {header.hex()}")
    return 'unknown'


def check_ffmpeg_health() -> dict:
    """
    檢查 FFmpeg 健康狀態

    Returns:
        dict: 包含 FFmpeg 狀態信息的字典
    """
    try:
        # 檢查 FFmpeg 是否可用
        result = subprocess.run(['ffmpeg', '-version'],
                              capture_output=True, text=True, timeout=5)

        if result.returncode == 0:
            # 解析版本信息
            version_line = result.stdout.split('\n')[0]
            version = version_line.split(' ')[2] if len(version_line.split(' ')) > 2 else 'unknown'

            return {
                'ffmpeg_available': True,
                'status': 'healthy',
                'version': version,
                'active_processes': 0,  # 簡化版本，不追踪活躍進程
                'pooled_processes': 0,
                'max_processes': 3
            }
        else:
            return {
                'ffmpeg_available': False,
                'status': 'error',
                'error': 'FFmpeg command failed'
            }

    except FileNotFoundError:
        return {
            'ffmpeg_available': False,
            'status': 'not_found',
            'error': 'FFmpeg not installed'
        }
    except subprocess.TimeoutExpired:
        return {
            'ffmpeg_available': False,
            'status': 'timeout',
            'error': 'FFmpeg version check timeout'
        }
    except Exception as e:
        return {
            'ffmpeg_available': False,
            'status': 'error',
            'error': str(e)
        }


async def webm_to_pcm(webm: bytes) -> bytes:
    """
    將 WebM 音訊轉換為 PCM 格式

    轉換參數：
    - 輸入：WebM 格式音訊資料
    - 輸出：16kHz 單聲道 signed 16-bit little-endian PCM
    - 適用於 Azure OpenAI Whisper API

    Args:
        webm: WebM 格式的音訊二進制資料

    Returns:
        bytes: PCM 格式的音訊二進制資料

    Raises:
        RuntimeError: FFmpeg 轉換失敗時拋出
    """
    try:
        logger.debug(f"🎵 [FFmpeg] 開始轉換 WebM → PCM (size: {len(webm)} bytes)")

        # 建立 FFmpeg 子程序
        proc = await asyncio.create_subprocess_exec(
            *shlex.split(FFMPEG_CMD),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        # 執行轉換
        stdout, stderr = await proc.communicate(webm)

        # 檢查轉換結果
        if proc.returncode != 0:
            error_msg = stderr.decode('utf-8') if stderr else "Unknown FFmpeg error"
            logger.error(f"❌ [FFmpeg] 轉換失敗 (返回碼: {proc.returncode}): {error_msg}")
            raise RuntimeError(f"FFmpeg convert failed: {error_msg}")

        if not stdout:
            logger.error("❌ [FFmpeg] 轉換結果為空")
            raise RuntimeError("FFmpeg convert produced no output")

        logger.info(f"✅ [FFmpeg] WebM → PCM 轉換成功 ({len(webm)} → {len(stdout)} bytes)")
        return stdout

    except asyncio.TimeoutError:
        logger.error("❌ [FFmpeg] 轉換超時")
        raise RuntimeError("FFmpeg convert timeout")
    except FileNotFoundError:
        logger.error("❌ [FFmpeg] FFmpeg 程序未找到，請確認已安裝 FFmpeg")
        raise RuntimeError("FFmpeg not found. Please install FFmpeg.")
    except Exception as e:
        logger.error(f"❌ [FFmpeg] 轉換異常: {str(e)}")
        raise RuntimeError(f"FFmpeg convert error: {str(e)}")


async def webm_to_wav(webm: bytes) -> Optional[bytes]:
    """
    將 WebM 音訊轉換為 16kHz mono 16-bit RIFF-WAV 格式

    Args:
        webm: WebM 格式的音訊二進制資料

    Returns:
        Optional[bytes]: WAV 格式的音訊二進制資料，失敗時回傳 None
    """
    ffmpeg_cmd = "ffmpeg -f webm -i pipe:0 -ac 1 -ar 16000 -f wav -y pipe:1 -loglevel error"
    try:
        logger.debug(f"🎵 [FFmpeg] 開始轉換 WebM → WAV (size: {len(webm)} bytes)")
        proc = await asyncio.create_subprocess_exec(
            *shlex.split(ffmpeg_cmd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout, stderr = await proc.communicate(webm)
        if proc.returncode != 0:
            error_msg = stderr.decode('utf-8') if stderr else "Unknown FFmpeg error"
            logger.error(f"❌ [FFmpeg] WebM → WAV 轉換失敗 (返回碼: {proc.returncode}): {error_msg}")
            return None
        if not stdout:
            logger.error("❌ [FFmpeg] WebM → WAV 轉換結果為空")
            return None
        logger.info(f"✅ [FFmpeg] WebM → WAV 轉換成功 ({len(webm)} → {len(stdout)} bytes)")
        return stdout
    except asyncio.TimeoutError:
        logger.error("❌ [FFmpeg] WebM → WAV 轉換超時")
        return None
    except FileNotFoundError:
        logger.error("❌ [FFmpeg] FFmpeg 程序未找到，請確認已安裝 FFmpeg")
        return None
    except Exception as e:
        logger.error(f"❌ [FFmpeg] WebM → WAV 轉換異常: {str(e)}")
        return None


async def validate_webm_audio(webm: bytes) -> bool:
    """
    驗證 WebM 音訊檔案是否有效

    使用 FFmpeg 來檢查音訊檔案的完整性和格式

    Args:
        webm: WebM 格式的音訊二進制資料

    Returns:
        bool: 如果音訊檔案有效則返回 True
    """
    try:
        # 使用 FFmpeg 驗證模式（不產生輸出，只檢查格式）
        validate_cmd = "ffmpeg -v error -i pipe:0 -f null -"

        proc = await asyncio.create_subprocess_exec(
            *shlex.split(validate_cmd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        stdout, stderr = await proc.communicate(webm)

        if proc.returncode == 0:
            logger.debug("✅ [FFmpeg] WebM 音訊檔案驗證通過")
            return True
        else:
            error_msg = stderr.decode('utf-8') if stderr else "Unknown validation error"
            logger.warning(f"⚠️ [FFmpeg] WebM 音訊檔案驗證失敗: {error_msg}")
            return False

    except Exception as e:
        logger.warning(f"⚠️ [FFmpeg] 音訊檔案驗證異常: {str(e)}")
        return False


async def get_audio_info(webm: bytes) -> Optional[dict]:
    """
    獲取音訊檔案資訊

    Args:
        webm: WebM 格式的音訊二進制資料

    Returns:
        dict: 包含音訊資訊的字典，如果失敗則返回 None
    """
    try:
        # 使用 ffprobe 獲取音訊資訊
        probe_cmd = "ffprobe -v quiet -print_format json -show_format -show_streams pipe:0"

        proc = await asyncio.create_subprocess_exec(
            *shlex.split(probe_cmd),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )

        stdout, stderr = await proc.communicate(webm)

        if proc.returncode == 0 and stdout:
            import json
            info = json.loads(stdout.decode('utf-8'))
            logger.debug(f"📊 [FFprobe] 音訊資訊: {info}")
            return info
        else:
            logger.warning("⚠️ [FFprobe] 無法獲取音訊資訊")
            return None

    except Exception as e:
        logger.warning(f"⚠️ [FFprobe] 獲取音訊資訊異常: {str(e)}")
        return None
