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
    檢測音檔格式，完整支援 fragmented MP4

    Args:
        audio_bytes: 音檔數據

    Returns:
        str: 檢測到的格式 (webm, mp4, fmp4, ogg, wav, unknown)
        - mp4: 標準 MP4 格式
        - fmp4: fragmented MP4 格式（需要特殊 FFmpeg 參數）
    """
    if not audio_bytes or len(audio_bytes) < 32:
        return 'unknown'

    # 擴大檢測範圍到 128 bytes 以捕獲更多格式變體
    search_range = min(len(audio_bytes), 128)
    header_data = audio_bytes[:search_range]

    # WebM (Matroska) 以 EBML header 開頭 0x1A45DFA3
    if audio_bytes[0:4] == b'\x1A\x45\xDF\xA3':
        return 'webm'

    # Fragmented MP4 格式檢測（優先檢測，需要特殊處理）
    fragmented_markers = [
        b'styp',  # Segment Type Box - fragmented MP4 的片段類型盒
        b'moof',  # Movie Fragment Box - movie fragment 盒
        b'sidx',  # Segment Index Box - segment index 盒
        b'tfhd',  # Track Fragment Header Box - track fragment header
        b'trun',  # Track Fragment Run Box - track run
    ]

    # 檢查是否包含 fragmented MP4 標記
    has_fragmented_marker = any(marker in header_data for marker in fragmented_markers)

    if has_fragmented_marker:
        # 進一步確認是否為 MP4 容器格式
        mp4_markers = [b'ftyp', b'mdat', b'moov']
        has_mp4_marker = any(marker in header_data for marker in mp4_markers)

        if has_mp4_marker or b'mp4' in header_data[:16]:
            return 'fmp4'  # 確認為 fragmented MP4

    # 標準 MP4/ISOBMFF 檢測
    # 標準 MP4 在 4-8 byte 有 'ftyp'
    if b'ftyp' in header_data:
        # 檢查是否不包含 fragmented 標記，以區分標準 MP4
        if not has_fragmented_marker:
            return 'mp4'
        else:
            return 'fmp4'  # 包含 ftyp 但也有 fragmented 標記

    # 檢測其他 MP4 相關標記
    if b'mdat' in header_data:
        if has_fragmented_marker:
            return 'fmp4'
        else:
            return 'mp4'

    # OGG 以 'OggS' 開頭
    if audio_bytes[0:4] == b'OggS':
        return 'ogg'

    # WAV 以 'RIFF' 開頭，並在 8-12 byte 有 'WAVE'
    if audio_bytes[0:4] == b'RIFF' and len(audio_bytes) >= 12 and audio_bytes[8:12] == b'WAVE':
        return 'wav'

    return 'unknown'


def _generate_audio_diagnostics(audio_bytes: bytes, detected_format: str) -> str:
    """
    生成音檔診斷資訊，包含頭部十六進位和格式建議

    Args:
        audio_bytes: 音檔數據
        detected_format: 檢測到的格式

    Returns:
        str: 診斷資訊字串
    """
    if not audio_bytes:
        return "診斷: 音檔數據為空"

    # 生成頭部十六進位輸出（前 64 bytes）
    hex_header = audio_bytes[:64].hex(' ', 8).upper()

    # 格式建議
    format_suggestions = {
        'fmp4': '建議: 這是 fragmented MP4 格式，需要特殊的 movflags 參數',
        'mp4': '建議: 標準 MP4 格式，通常相容性良好',
        'webm': '建議: WebM 格式，適合網頁播放',
        'unknown': '建議: 無法識別格式，可能是損壞的音檔或不支援的格式'
    }

    suggestion = format_suggestions.get(detected_format, '建議: 檢查音檔是否為有效的音訊格式')

    return (
        f"音檔診斷資訊:\n"
        f"- 檢測格式: {detected_format}\n"
        f"- 檔案大小: {len(audio_bytes)} bytes\n"
        f"- 頭部資料 (前64字節): {hex_header}\n"
        f"- {suggestion}"
    )


def _get_error_solution_advice(error_msg: str, detected_format: str) -> str:
    """
    根據錯誤訊息提供具體的解決建議

    Args:
        error_msg: FFmpeg 錯誤訊息
        detected_format: 檢測到的格式

    Returns:
        str: 解決建議
    """
    error_solutions = {
        'could not find corresponding trex': (
            "🔧 Fragmented MP4 錯誤解決方案:\n"
            "1. 確認使用 'fmp4' 格式處理 fragmented MP4\n"
            "2. 檢查是否使用了正確的 movflags 參數\n"
            "3. 考慮使用 WebM 格式作為替代方案"
        ),
        'trun track id unknown': (
            "🔧 Track ID 錯誤解決方案:\n"
            "1. 使用 fflags='+genpts+igndts' 忽略錯誤時間戳\n"
            "2. 增加 analyzeduration 和 probesize 參數\n"
            "3. 嘗試使用 avoid_negative_ts='make_zero'"
        ),
        'Invalid data found when processing input': (
            "🔧 資料格式錯誤解決方案:\n"
            "1. 檢查音檔是否完整下載\n"
            "2. 確認瀏覽器錄音格式設定\n"
            "3. 嘗試不同的格式參數組合"
        ),
        'No such file or directory': (
            "🔧 檔案讀取錯誤解決方案:\n"
            "1. 確認 FFmpeg 正確安裝\n"
            "2. 檢查音檔數據是否正確傳輸\n"
            "3. 驗證 pipe 輸入是否正常"
        )
    }

    # 尋找匹配的錯誤模式
    for error_pattern, solution in error_solutions.items():
        if error_pattern.lower() in error_msg.lower():
            return solution

    # 根據格式提供通用建議
    format_advice = {
        'fmp4': "建議嘗試標準 MP4 格式作為備用",
        'mp4': "建議嘗試 WebM 格式作為備用",
        'webm': "建議嘗試 MP4 格式作為備用",
        'unknown': "建議檢查音檔格式是否受支援"
    }

    generic_advice = format_advice.get(detected_format, "建議嘗試其他音檔格式")

    return (
        f"🔧 通用解決方案:\n"
        f"1. {generic_advice}\n"
        f"2. 檢查音檔是否損壞或格式不正確\n"
        f"3. 確認 FFmpeg 版本支援所需格式"
    )


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
    非同步版本的 FFmpeg 轉換，支援智能格式重試策略

    Args:
        webm_bytes: 音檔數據 (可能是 WebM, MP4 或其他格式)

    Returns:
        bytes: 轉換後的 16k mono PCM 數據
    """
    detected_format = detect_audio_format(webm_bytes)

    # 生成詳細的診斷資訊
    diagnostics = _generate_audio_diagnostics(webm_bytes, detected_format)
    logger.info(f"非同步轉換開始 - 檢測到格式: {detected_format} (大小: {len(webm_bytes)} bytes)")
    logger.debug(f"音檔診斷詳情:\n{diagnostics}")

    def _convert_with_format(input_format: str):
        """使用指定格式進行轉換"""
        try:
            # 根據檢測到的格式選擇 FFmpeg 參數
            if input_format == 'fmp4':
                # Fragmented MP4 格式 - 需要特殊參數組合解決 trex/trun 錯誤
                process = (
                    ffmpeg
                    .input('pipe:',
                           format='mp4',
                           # 處理 fragmented MP4 的關鍵參數
                           movflags='+faststart+frag_keyframe',
                           fflags='+genpts+igndts+discardcorrupt',
                           # 增加格式探測時間和大小
                           analyzeduration='10M',
                           probesize='10M',
                           # 處理時間戳問題
                           avoid_negative_ts='make_zero')
                    .output('pipe:',
                           format='s16le',
                           acodec='pcm_s16le',
                           ac=1,
                           ar=16000)
                    .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True, quiet=True)
                )
                logger.debug(f"使用 fragmented MP4 專用參數進行轉換")
            elif input_format == 'mp4':
                # 標準 MP4 格式
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

                # 生成詳細的錯誤診斷和解決建議
                solution_advice = _get_error_solution_advice(error_msg, input_format)
                full_error_info = (
                    f"FFmpeg 轉換失敗 (格式: {input_format}):\n"
                    f"錯誤訊息: {error_msg}\n"
                    f"{solution_advice}"
                )

                logger.error(full_error_info)
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
        """同步轉換函式，智能重試策略"""
        max_retries = 3
        retry_attempts = []

        # 第一階段：嘗試檢測到的精確格式
        try:
            logger.info(f"階段1: 使用檢測格式 '{detected_format}' 進行轉換")
            result = _convert_with_format(detected_format)
            logger.info(f"檢測格式 '{detected_format}' 轉換成功")
            return result
        except RuntimeError as e:
            retry_attempts.append({
                'format': detected_format,
                'error': str(e),
                'stage': '精確格式'
            })
            logger.warning(f"檢測格式 '{detected_format}' 失敗: {e}")

        # 第二階段：智能格式選擇 - 根據檢測格式選擇相關的備用格式
        backup_strategies = {
            'fmp4': ['mp4', 'auto'],  # fragmented MP4 優先嘗試標準 MP4
            'mp4': ['fmp4', 'auto'],  # 標準 MP4 優先嘗試 fragmented MP4
            'webm': ['auto', 'mp4'],  # WebM 先自動檢測，再嘗試 MP4
            'unknown': ['auto', 'fmp4', 'mp4', 'webm']  # 未知格式嘗試所有選項
        }

        backup_formats = backup_strategies.get(detected_format, ['auto', 'fmp4', 'mp4', 'webm'])

        for backup_format in backup_formats:
            if len(retry_attempts) >= max_retries:
                logger.warning(f"已達到最大重試次數 {max_retries}，停止嘗試")
                break

            try:
                logger.info(f"階段2: 嘗試智能備用格式 '{backup_format}'")
                result = _convert_with_format(backup_format)
                logger.info(f"備用格式 '{backup_format}' 轉換成功")
                return result
            except RuntimeError as e:
                retry_attempts.append({
                    'format': backup_format,
                    'error': str(e),
                    'stage': '智能備用'
                })
                logger.warning(f"備用格式 '{backup_format}' 失敗: {e}")

        # 第三階段：通用格式嘗試（如果尚未嘗試過）
        remaining_formats = ['ogg', 'wav']  # 其他可能的格式

        for fallback_format in remaining_formats:
            if len(retry_attempts) >= max_retries:
                break

            try:
                logger.info(f"階段3: 嘗試通用格式 '{fallback_format}'")
                result = _convert_with_format(fallback_format)
                logger.info(f"通用格式 '{fallback_format}' 轉換成功")
                return result
            except RuntimeError as e:
                retry_attempts.append({
                    'format': fallback_format,
                    'error': str(e),
                    'stage': '通用格式'
                })
                logger.warning(f"通用格式 '{fallback_format}' 失敗: {e}")

        # 所有重試都失敗 - 生成詳細的失敗報告
        failure_report = _generate_retry_failure_report(detected_format, retry_attempts, diagnostics)
        logger.error(failure_report)

        # 拋出包含所有重試資訊的錯誤
        primary_error = retry_attempts[0]['error'] if retry_attempts else "未知錯誤"
        raise RuntimeError(f"智能重試策略失敗，共嘗試 {len(retry_attempts)} 種格式。主要錯誤: {primary_error}")

    # 在執行緒池中執行轉換
    loop = asyncio.get_event_loop()
    pool = get_process_pool()
    return await loop.run_in_executor(pool.executor, _convert)


def _generate_retry_failure_report(detected_format: str, retry_attempts: list, diagnostics: str) -> str:
    """
    生成詳細的重試失敗報告

    Args:
        detected_format: 原始檢測到的格式
        retry_attempts: 重試嘗試記錄
        diagnostics: 音檔診斷資訊

    Returns:
        str: 格式化的失敗報告
    """
    report_lines = [
        "=== 智能重試策略失敗報告 ===",
        f"檢測格式: {detected_format}",
        f"總重試次數: {len(retry_attempts)}",
        "",
        "詳細重試記錄:"
    ]

    for i, attempt in enumerate(retry_attempts, 1):
        report_lines.extend([
            f"{i}. 階段: {attempt['stage']} | 格式: {attempt['format']}",
            f"   錯誤: {attempt['error'][:100]}{'...' if len(attempt['error']) > 100 else ''}",
            ""
        ])

    report_lines.extend([
        "音檔診斷資訊:",
        diagnostics,
        "",
        "建議解決方案:",
        "1. 檢查音檔是否損壞或格式不支援",
        "2. 確認 FFmpeg 安裝完整並支援相關編解碼器",
        "3. 如果問題持續，請聯繫技術支援並提供此報告"
    ])

    return "\n".join(report_lines)


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
