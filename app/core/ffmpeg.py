"""
FFmpeg 音訊轉碼服務
提供 WebM → 16k mono PCM 轉換功能，支援進程池管理與錯誤處理
"""

import asyncio
import logging
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from queue import Queue, Empty
from typing import Optional, Dict, Any, List
import ffmpeg

logger = logging.getLogger(__name__)

@dataclass
class FFmpegProcess:
    """FFmpeg 進程封裝"""
    process: subprocess.Popen
    created_at: float
    last_used: float
    usage_count: int = 0

    def is_expired(self, max_age: int = 300, max_idle: int = 60) -> bool:
        """檢查進程是否過期"""
        current_time = time.time()
        return (
            current_time - self.created_at > max_age or
            current_time - self.last_used > max_idle
        )

    def cleanup(self):
        """清理進程資源"""
        try:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()
        except Exception as e:
            logger.warning(f"清理 FFmpeg 進程時發生錯誤: {e}")


class FFmpegProcessPool:
    """FFmpeg 進程池管理器"""

    def __init__(self, max_processes: int = 3, max_idle_time: int = 60):
        self.max_processes = max_processes
        self.max_idle_time = max_idle_time
        self.processes: Queue[FFmpegProcess] = Queue()
        self.active_processes: Dict[int, FFmpegProcess] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=max_processes)
        self._cleanup_thread = threading.Thread(target=self._cleanup_expired, daemon=True)
        self._cleanup_thread.start()

    def get_process(self) -> FFmpegProcess:
        """取得可用的 FFmpeg 進程"""
        with self.lock:
            # 嘗試從池中取得可用進程
            while not self.processes.empty():
                try:
                    process = self.processes.get_nowait()
                    # 檢查進程是否仍然活躍
                    if process.process.poll() is None and not process.is_expired():
                        process.last_used = time.time()
                        process.usage_count += 1
                        self.active_processes[process.process.pid] = process
                        return process
                    else:
                        # 進程已終止或過期，清理它
                        process.cleanup()
                except Empty:
                    break

            # 如果池中沒有可用進程，創建新的
            if len(self.active_processes) < self.max_processes:
                process = self._create_new_process()
                self.active_processes[process.process.pid] = process
                return process

            # 如果達到最大進程數，等待並重試
            raise RuntimeError("FFmpeg 進程池已滿，請稍後重試")

    def return_process(self, process: FFmpegProcess):
        """歸還進程到池中"""
        with self.lock:
            if process.process.pid in self.active_processes:
                del self.active_processes[process.process.pid]

                # 檢查進程是否仍然可用
                if process.process.poll() is None and not process.is_expired():
                    self.processes.put(process)
                else:
                    process.cleanup()

    def _create_new_process(self) -> FFmpegProcess:
        """創建新的 FFmpeg 進程"""
        try:
            # 使用 ffmpeg-python 創建進程
            process = (
                ffmpeg
                .input('pipe:', format='webm')
                .output('pipe:', format='s16le', acodec='pcm_s16le', ac=1, ar=16000)
                .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
            )

            current_time = time.time()
            ffmpeg_process = FFmpegProcess(
                process=process,
                created_at=current_time,
                last_used=current_time
            )

            logger.info(f"創建新的 FFmpeg 進程 PID: {process.pid}")
            return ffmpeg_process

        except Exception as e:
            logger.error(f"創建 FFmpeg 進程失敗: {e}")
            raise RuntimeError(f"無法創建 FFmpeg 進程: {e}")

    def _cleanup_expired(self):
        """清理過期的進程（後台執行緒）"""
        while True:
            try:
                time.sleep(30)  # 每30秒檢查一次

                with self.lock:
                    # 清理池中的過期進程
                    expired_processes = []
                    temp_queue = Queue()

                    while not self.processes.empty():
                        try:
                            process = self.processes.get_nowait()
                            if process.is_expired():
                                expired_processes.append(process)
                            else:
                                temp_queue.put(process)
                        except Empty:
                            break

                    # 重建佇列
                    self.processes = temp_queue

                    # 清理過期進程
                    for process in expired_processes:
                        logger.info(f"清理過期的 FFmpeg 進程 PID: {process.process.pid}")
                        process.cleanup()

            except Exception as e:
                logger.error(f"清理過期進程時發生錯誤: {e}")

    def cleanup_all(self):
        """清理所有進程"""
        with self.lock:
            # 清理活躍進程
            for process in self.active_processes.values():
                process.cleanup()
            self.active_processes.clear()

            # 清理池中的進程
            while not self.processes.empty():
                try:
                    process = self.processes.get_nowait()
                    process.cleanup()
                except Empty:
                    break

        # 關閉執行緒池
        self.executor.shutdown(wait=True)
        logger.info("FFmpeg 進程池已清理完成")


# 全域進程池實例
_process_pool = None

def get_process_pool() -> FFmpegProcessPool:
    """取得全域進程池實例"""
    global _process_pool
    if _process_pool is None:
        _process_pool = FFmpegProcessPool()
    return _process_pool


def ffmpeg_spawn() -> subprocess.Popen:
    """
    建立共用 FFmpeg 轉碼子進程

    Returns:
        subprocess.Popen: FFmpeg 進程實例

    Raises:
        RuntimeError: 當無法創建進程時
    """
    try:
        pool = get_process_pool()
        ffmpeg_process = pool.get_process()
        return ffmpeg_process.process
    except Exception as e:
        logger.error(f"spawn FFmpeg 進程失敗: {e}")
        raise RuntimeError(f"無法啟動 FFmpeg 進程: {e}")


def detect_audio_format(audio_bytes: bytes) -> str:
    """
    檢測音檔格式

    Args:
        audio_bytes: 音檔數據

    Returns:
        str: 檢測到的格式 (webm, mp4, ogg, wav, unknown)
    """
    if not audio_bytes or len(audio_bytes) < 12:
        return 'unknown'

    # WebM (Matroska) 以 EBML header 開頭 0x1A45DFA3
    if audio_bytes[0:4] == b'\x1A\x45\xDF\xA3':
        return 'webm'

    # MP4/ISOBMFF 常在 4–8 byte 看到 'ftyp'
    if b'ftyp' in audio_bytes[4:12]:
        return 'mp4'

    # OGG 以 'OggS' 開頭
    if audio_bytes[0:4] == b'OggS':
        return 'ogg'

    # WAV 以 'RIFF' 開頭，並在 8-12 byte 有 'WAVE'
    if audio_bytes[0:4] == b'RIFF' and audio_bytes[8:12] == b'WAVE':
        return 'wav'

    return 'unknown'


def feed_ffmpeg(process: subprocess.Popen, webm_bytes: bytes) -> bytes:
    """
    餵送音檔數據到 FFmpeg 並獲取 PCM 輸出

    Args:
        process: FFmpeg 進程實例
        webm_bytes: 音檔數據 (可能是 WebM, MP4 或其他格式)

    Returns:
        bytes: 轉換後的 16k mono PCM 數據

    Raises:
        RuntimeError: 當轉換失敗時
    """
    # 檢測音檔格式
    detected_format = detect_audio_format(webm_bytes)
    logger.info(f"檢測到音檔格式: {detected_format} (大小: {len(webm_bytes)} bytes)")

    try:
        # 設定逾時時間（10秒）
        timeout = 10

        # 發送音檔數據並獲取 PCM 輸出
        pcm_data, error_output = process.communicate(input=webm_bytes, timeout=timeout)

        # 檢查進程是否成功完成
        if process.returncode != 0:
            error_msg = error_output.decode('utf-8', errors='ignore') if error_output else "未知錯誤"

            # 增強錯誤日誌，包含格式資訊
            logger.error(f"FFmpeg 轉換失敗:")
            logger.error(f"  - 音檔格式: {detected_format}")
            logger.error(f"  - 音檔大小: {len(webm_bytes)} bytes")
            logger.error(f"  - 返回碼: {process.returncode}")
            logger.error(f"  - 錯誤訊息: {error_msg}")

            # 分析常見錯誤原因
            if "Invalid data found when processing input" in error_msg:
                logger.error(f"  - 分析: 音檔格式 '{detected_format}' 可能不被此版本的 FFmpeg 支援或檔案損壞")
            elif "Protocol not found" in error_msg:
                logger.error(f"  - 分析: FFmpeg 缺少對 '{detected_format}' 格式的支援")
            elif "No such file or directory" in error_msg:
                logger.error(f"  - 分析: FFmpeg 無法讀取輸入流")

            raise RuntimeError(f"FFmpeg 轉換失敗 (格式: {detected_format}): {error_msg}")

        if not pcm_data:
            logger.warning(f"FFmpeg 轉換結果為空 (輸入格式: {detected_format})")
            return b''

        logger.debug(f"成功轉換 {detected_format.upper()} ({len(webm_bytes)} bytes) → PCM ({len(pcm_data)} bytes)")
        return pcm_data

    except subprocess.TimeoutExpired:
        logger.error(f"FFmpeg 轉換逾時 (格式: {detected_format}, 大小: {len(webm_bytes)} bytes)")
        process.kill()
        process.wait()
        raise RuntimeError(f"FFmpeg 轉換逾時 (格式: {detected_format})")
    except Exception as e:
        logger.error(f"FFmpeg 轉換發生錯誤 (格式: {detected_format}): {e}")
        raise RuntimeError(f"音訊轉換失敗 (格式: {detected_format}): {e}")


async def feed_ffmpeg_async(webm_bytes: bytes) -> bytes:
    """
    非同步版本的 FFmpeg 轉換，支援多格式重試

    Args:
        webm_bytes: 音檔數據 (可能是 WebM, MP4 或其他格式)

    Returns:
        bytes: 轉換後的 16k mono PCM 數據
    """
    detected_format = detect_audio_format(webm_bytes)
    logger.info(f"非同步轉換開始 - 檢測到格式: {detected_format} (大小: {len(webm_bytes)} bytes)")

    def _convert_with_format(input_format: str):
        """使用指定格式進行轉換"""
        try:
            # 根據檢測到的格式選擇 FFmpeg 參數
            if input_format == 'mp4':
                # Safari 產出的 fragmented MP4
                process = (
                    ffmpeg
                    .input('pipe:', format='mp4', fflags='+genpts')
                    .output('pipe:', format='s16le', acodec='pcm_s16le', ac=1, ar=16000)
                    .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
                )
            elif input_format == 'webm':
                # WebM 格式
                process = (
                    ffmpeg
                    .input('pipe:', format='webm', fflags='+genpts')
                    .output('pipe:', format='s16le', acodec='pcm_s16le', ac=1, ar=16000)
                    .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
                )
            else:
                # 通用格式，讓 FFmpeg 自動檢測
                process = (
                    ffmpeg
                    .input('pipe:', fflags='+genpts')
                    .output('pipe:', format='s16le', acodec='pcm_s16le', ac=1, ar=16000)
                    .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
                )

            pcm_data, error_output = process.communicate(input=webm_bytes, timeout=10)

            if process.returncode != 0:
                error_msg = error_output.decode('utf-8', errors='ignore') if error_output else "未知錯誤"
                logger.error(f"FFmpeg 轉換失敗 (格式: {input_format}): {error_msg}")
                raise RuntimeError(f"FFmpeg 轉換失敗 (格式: {input_format}): {error_msg}")

            logger.debug(f"成功轉換 {input_format.upper()} → PCM ({len(pcm_data)} bytes)")
            return pcm_data

        finally:
            # 清理臨時進程
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=2)
            except:
                pass

    def _convert():
        """同步轉換函式，包含重試邏輯"""
        # 首先嘗試使用檢測到的格式
        try:
            return _convert_with_format(detected_format)
        except RuntimeError as e:
            logger.warning(f"使用檢測格式 '{detected_format}' 失敗: {e}")

            # 如果檢測格式失敗，嘗試其他常見格式
            fallback_formats = ['mp4', 'webm', 'auto']
            if detected_format in fallback_formats:
                fallback_formats.remove(detected_format)

            for fallback_format in fallback_formats:
                try:
                    logger.info(f"嘗試備用格式: {fallback_format}")
                    return _convert_with_format(fallback_format)
                except RuntimeError as fallback_error:
                    logger.warning(f"備用格式 '{fallback_format}' 也失敗: {fallback_error}")
                    continue

            # 所有格式都失敗
            raise RuntimeError(f"所有格式轉換都失敗，原始錯誤: {e}")

    # 在執行緒池中執行轉換
    loop = asyncio.get_event_loop()
    pool = get_process_pool()
    return await loop.run_in_executor(pool.executor, _convert)


def cleanup_ffmpeg_resources():
    """清理 FFmpeg 資源"""
    global _process_pool
    if _process_pool:
        _process_pool.cleanup_all()
        _process_pool = None
    logger.info("FFmpeg 資源清理完成")


def check_format_support() -> Dict[str, bool]:
    """
    檢查 FFmpeg 支援的音檔格式

    Returns:
        Dict[str, bool]: 各格式的支援狀態
    """
    supported_formats = {}
    test_formats = ['webm', 'mp4', 'ogg', 'wav']

    for fmt in test_formats:
        try:
            # 測試格式支援：嘗試使用該格式作為輸入
            result = subprocess.run(
                ['ffmpeg', '-f', fmt, '-i', '/dev/null', '-f', 'null', '-'],
                capture_output=True,
                text=True,
                timeout=3
            )
            # 如果不是因為檔案不存在而失敗，則表示格式被支援
            supported_formats[fmt] = "No such file or directory" in result.stderr or result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            supported_formats[fmt] = False
        except Exception:
            supported_formats[fmt] = False

    return supported_formats


# 健康檢查函式
def check_ffmpeg_health() -> Dict[str, Any]:
    """
    檢查 FFmpeg 服務健康狀態，包含格式支援檢測

    Returns:
        Dict: 健康狀態資訊
    """
    try:
        # 檢查 FFmpeg 是否可用
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode != 0:
            return {
                "ffmpeg_available": False,
                "status": "unhealthy",
                "error": "FFmpeg 執行失敗",
                "details": result.stderr
            }

        # 解析版本資訊
        version_line = result.stdout.split('\n')[0] if result.stdout else "Unknown"

        # 檢查編解碼器支援
        codecs_result = subprocess.run(
            ['ffmpeg', '-codecs'],
            capture_output=True,
            text=True,
            timeout=3
        )

        # 分析重要編解碼器支援
        codec_support = {}
        if codecs_result.returncode == 0:
            codecs_output = codecs_result.stdout
            codec_support = {
                "opus": "opus" in codecs_output,
                "aac": "aac" in codecs_output,
                "pcm_s16le": "pcm_s16le" in codecs_output,
                "vorbis": "vorbis" in codecs_output
            }

        # 檢查格式支援
        format_support = check_format_support()

        # 檢查進程池狀態
        try:
            pool = get_process_pool()
            with pool.lock:
                active_count = len(pool.active_processes)
                pool_count = pool.processes.qsize()
        except Exception as e:
            logger.warning(f"無法取得進程池狀態: {e}")
            active_count = 0
            pool_count = 0

        # 檢查安裝路徑
        try:
            install_path = subprocess.run(['which', 'ffmpeg'], capture_output=True, text=True).stdout.strip()
        except:
            install_path = "unknown"

        return {
            "ffmpeg_available": True,
            "status": "healthy",
            "version": version_line,
            "installation_path": install_path,
            "format_support": format_support,
            "codec_support": codec_support,
            "process_pool": {
                "active_processes": active_count,
                "pooled_processes": pool_count,
                "max_processes": getattr(get_process_pool(), 'max_processes', 3)
            },
            "recommendations": _generate_health_recommendations(format_support, codec_support)
        }

    except subprocess.TimeoutExpired:
        return {
            "ffmpeg_available": False,
            "status": "unhealthy",
            "error": "FFmpeg 檢查逾時 (可能系統負載過高)"
        }
    except FileNotFoundError:
        return {
            "ffmpeg_available": False,
            "status": "unhealthy",
            "error": "FFmpeg 未安裝",
            "install_instructions": {
                "ubuntu": "sudo apt update && sudo apt install ffmpeg",
                "macos": "brew install ffmpeg",
                "docker": "RUN apt-get update && apt-get install -y ffmpeg"
            }
        }
    except Exception as e:
        return {
            "ffmpeg_available": False,
            "status": "unhealthy",
            "error": f"檢查時發生未預期錯誤: {str(e)}"
        }


def _generate_health_recommendations(format_support: Dict[str, bool], codec_support: Dict[str, bool]) -> List[str]:
    """
    根據 FFmpeg 支援狀況生成建議

    Args:
        format_support: 格式支援狀況
        codec_support: 編解碼器支援狀況

    Returns:
        List[str]: 建議列表
    """
    recommendations = []

    # 檢查關鍵格式支援
    if not format_support.get('mp4', False):
        recommendations.append("⚠️ MP4 格式不被支援，建議重新編譯 FFmpeg 或安裝完整版本")

    if not format_support.get('webm', False):
        recommendations.append("⚠️ WebM 格式不被支援，可能影響瀏覽器錄音功能")

    # 檢查關鍵編解碼器
    if not codec_support.get('opus', False):
        recommendations.append("⚠️ Opus 編解碼器不被支援，建議安裝 libopus")

    if not codec_support.get('pcm_s16le', False):
        recommendations.append("🚨 PCM 編解碼器不被支援，這是基本要求，請檢查 FFmpeg 安裝")

    # 提供最佳化建議
    if format_support.get('mp4', False) and codec_support.get('aac', False):
        recommendations.append("✅ 建議使用 MP4 + AAC 格式以獲得最佳兼容性")

    if not recommendations:
        recommendations.append("✅ FFmpeg 配置良好，支援所有必要的格式和編解碼器")

    return recommendations
