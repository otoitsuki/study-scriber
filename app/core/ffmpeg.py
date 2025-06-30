"""
FFmpeg 音訊轉換服務 (REST API 簡化架構)

實作 WebM 到 16kHz mono PCM 的轉換，專門處理完整 10s 檔案
"""

import asyncio
import subprocess
import shlex
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# FFmpeg 命令：WebM 輸入 → 16kHz 單聲道 PCM 輸出
FFMPEG_CMD = "ffmpeg -i pipe:0 -ac 1 -ar 16000 -f s16le pipe:1 -loglevel error"


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
