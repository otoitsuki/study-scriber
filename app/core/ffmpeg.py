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
from typing import Optional, Dict, Any
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


def feed_ffmpeg(process: subprocess.Popen, webm_bytes: bytes) -> bytes:
    """
    餵送 WebM 數據到 FFmpeg 並獲取 PCM 輸出

    Args:
        process: FFmpeg 進程實例
        webm_bytes: WebM 音訊數據

    Returns:
        bytes: 轉換後的 16k mono PCM 數據

    Raises:
        RuntimeError: 當轉換失敗時
    """
    try:
        # 設定逾時時間（10秒）
        timeout = 10

        # 發送 WebM 數據並獲取 PCM 輸出
        pcm_data, error_output = process.communicate(input=webm_bytes, timeout=timeout)

        # 檢查進程是否成功完成
        if process.returncode != 0:
            error_msg = error_output.decode('utf-8', errors='ignore') if error_output else "未知錯誤"
            logger.error(f"FFmpeg 轉換失敗，返回碼: {process.returncode}, 錯誤: {error_msg}")
            raise RuntimeError(f"FFmpeg 轉換失敗: {error_msg}")

        if not pcm_data:
            logger.warning("FFmpeg 轉換結果為空")
            return b''

        logger.debug(f"成功轉換 WebM ({len(webm_bytes)} bytes) → PCM ({len(pcm_data)} bytes)")
        return pcm_data

    except subprocess.TimeoutExpired:
        logger.error("FFmpeg 轉換逾時")
        process.kill()
        process.wait()
        raise RuntimeError("FFmpeg 轉換逾時")
    except Exception as e:
        logger.error(f"FFmpeg 轉換發生錯誤: {e}")
        raise RuntimeError(f"音訊轉換失敗: {e}")


async def feed_ffmpeg_async(webm_bytes: bytes) -> bytes:
    """
    非同步版本的 FFmpeg 轉換

    Args:
        webm_bytes: WebM 音訊數據

    Returns:
        bytes: 轉換後的 16k mono PCM 數據
    """
    def _convert():
        """同步轉換函式"""
        pool = get_process_pool()
        ffmpeg_process = pool.get_process()

        try:
            # 重新創建進程以避免管道問題
            process = (
                ffmpeg
                .input('pipe:', format='webm')
                .output('pipe:', format='s16le', acodec='pcm_s16le', ac=1, ar=16000)
                .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
            )

            pcm_data, error_output = process.communicate(input=webm_bytes, timeout=10)

            if process.returncode != 0:
                error_msg = error_output.decode('utf-8', errors='ignore') if error_output else "未知錯誤"
                raise RuntimeError(f"FFmpeg 轉換失敗: {error_msg}")

            return pcm_data

        finally:
            # 清理臨時進程
            try:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=2)
            except:
                pass

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


# 健康檢查函式
def check_ffmpeg_health() -> Dict[str, Any]:
    """
    檢查 FFmpeg 服務健康狀態

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

        return {
            "ffmpeg_available": True,
            "status": "healthy",
            "version": version_line,
            "active_processes": active_count,
            "pooled_processes": pool_count,
            "max_processes": getattr(get_process_pool(), 'max_processes', 3),
            "installation_path": subprocess.run(['which', 'ffmpeg'], capture_output=True, text=True).stdout.strip()
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
