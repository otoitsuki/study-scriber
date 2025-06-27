"""
WebM 檔頭修復核心邏輯
提供檔頭提取、驗證和重組功能，解決 MediaRecorder 後續 chunk 缺乏 EBML 檔頭的問題
"""

import logging
import time
from typing import Optional, Tuple
from dataclasses import dataclass

from .ffmpeg import detect_webm_header_info, is_webm_header_complete, WebMHeaderInfo

logger = logging.getLogger(__name__)


@dataclass
class HeaderRepairResult:
    """檔頭修復結果"""
    success: bool = False
    repaired_data: Optional[bytes] = None
    original_header_size: int = 0
    audio_data_size: int = 0
    repair_time_ms: float = 0.0
    error_message: Optional[str] = None


@dataclass
class HeaderExtractionResult:
    """檔頭提取結果"""
    success: bool = False
    header_data: Optional[bytes] = None
    header_info: Optional[WebMHeaderInfo] = None
    extraction_time_ms: float = 0.0
    error_message: Optional[str] = None


class WebMHeaderRepairer:
    """
    WebM 檔頭修復核心引擎

    負責從第一個完整 chunk 提取檔頭模板，並將其應用到後續缺乏檔頭的 chunk 中
    """

    def __init__(self):
        """初始化 WebM 檔頭修復器"""
        self._repair_stats = {
            'total_extractions': 0,
            'successful_extractions': 0,
            'total_repairs': 0,
            'successful_repairs': 0,
            'total_repair_time_ms': 0.0
        }
        logger.info("WebMHeaderRepairer 初始化完成")

    def extract_header(self, complete_webm_chunk: bytes) -> HeaderExtractionResult:
        """
        從完整的 WebM chunk 中提取檔頭模板

        Args:
            complete_webm_chunk: 包含完整檔頭的 WebM chunk 數據

        Returns:
            HeaderExtractionResult: 檔頭提取結果
        """
        start_time = time.time()
        result = HeaderExtractionResult()

        try:
            self._repair_stats['total_extractions'] += 1

            # 1. 驗證輸入數據
            if not complete_webm_chunk or len(complete_webm_chunk) < 32:
                result.error_message = "輸入數據長度不足"
                return result

            # 2. 檢測檔頭完整性
            header_info = detect_webm_header_info(complete_webm_chunk)
            if not header_info.is_complete:
                result.error_message = f"檔頭不完整: {header_info.error_message}"
                return result

            # 3. 提取檔頭數據（從開始到第一個 Cluster）
            if header_info.header_size > 0:
                header_data = complete_webm_chunk[:header_info.header_size]

                # 4. 驗證提取的檔頭
                if self._validate_extracted_header(header_data):
                    result.success = True
                    result.header_data = header_data
                    result.header_info = header_info
                    self._repair_stats['successful_extractions'] += 1

                    logger.debug(f"成功提取檔頭: 大小={len(header_data)} bytes, "
                               f"編碼器={header_info.codec_type}, "
                               f"音軌數={header_info.track_count}")
                else:
                    result.error_message = "提取的檔頭驗證失敗"
            else:
                result.error_message = "無法確定檔頭大小"

        except Exception as e:
            result.error_message = f"檔頭提取異常: {str(e)}"
            logger.error(f"檔頭提取發生錯誤: {e}")

        finally:
            result.extraction_time_ms = (time.time() - start_time) * 1000

        return result

    def repair_chunk(self, header_template: bytes, incomplete_chunk: bytes) -> HeaderRepairResult:
        """
        使用檔頭模板修復不完整的 WebM chunk

        Args:
            header_template: 從完整 chunk 提取的檔頭模板
            incomplete_chunk: 缺乏檔頭的 WebM chunk

        Returns:
            HeaderRepairResult: 修復結果
        """
        start_time = time.time()
        result = HeaderRepairResult()

        try:
            self._repair_stats['total_repairs'] += 1

            # 1. 驗證輸入
            if not header_template or not incomplete_chunk:
                result.error_message = "輸入參數無效"
                return result

            if len(header_template) < 32 or len(incomplete_chunk) < 8:
                result.error_message = "數據長度不足"
                return result

            # 2. 檢測 incomplete_chunk 是否已經有檔頭
            if is_webm_header_complete(incomplete_chunk):
                # 如果已經有完整檔頭，直接返回原數據
                result.success = True
                result.repaired_data = incomplete_chunk
                result.original_header_size = 0
                result.audio_data_size = len(incomplete_chunk)
                logger.debug("Chunk 已有完整檔頭，無需修復")
                return result

            # 3. 檢測 incomplete_chunk 中的音頻數據起始位置
            audio_data_start = self._find_audio_data_start(incomplete_chunk)
            if audio_data_start == -1:
                result.error_message = "無法在 incomplete chunk 中找到有效的音頻數據"
                return result

            # 4. 提取音頻數據
            audio_data = incomplete_chunk[audio_data_start:]
            if len(audio_data) < 8:
                result.error_message = "音頻數據長度不足"
                return result

            # 5. 修復檔頭中的時間戳信息（如果需要）
            repaired_header = self._update_header_timestamps(header_template, incomplete_chunk)

            # 6. 拼接修復後的數據
            repaired_data = repaired_header + audio_data

            # 7. 驗證修復結果
            if self.validate_repaired_chunk(repaired_data):
                result.success = True
                result.repaired_data = repaired_data
                result.original_header_size = len(repaired_header)
                result.audio_data_size = len(audio_data)
                self._repair_stats['successful_repairs'] += 1

                logger.debug(f"成功修復 chunk: 檔頭={len(repaired_header)} bytes, "
                           f"音頻={len(audio_data)} bytes, "
                           f"總計={len(repaired_data)} bytes")
            else:
                result.error_message = "修復後的數據驗證失敗"

        except Exception as e:
            result.error_message = f"檔頭修復異常: {str(e)}"
            logger.error(f"檔頭修復發生錯誤: {e}")

        finally:
            repair_time_ms = (time.time() - start_time) * 1000
            result.repair_time_ms = repair_time_ms
            self._repair_stats['total_repair_time_ms'] += repair_time_ms

        return result

    def validate_repaired_chunk(self, repaired_chunk: bytes) -> bool:
        """
        驗證修復後的 WebM chunk 是否有效

        Args:
            repaired_chunk: 修復後的 WebM 數據

        Returns:
            bool: True 表示驗證通過，False 表示驗證失敗
        """
        try:
            if not repaired_chunk or len(repaired_chunk) < 32:
                return False

            # 1. 檢查是否有完整的檔頭
            if not is_webm_header_complete(repaired_chunk):
                logger.debug("修復後的 chunk 檔頭仍不完整")
                return False

            # 2. 檢測檔頭資訊
            header_info = detect_webm_header_info(repaired_chunk)
            if not header_info.is_complete:
                logger.debug(f"檔頭驗證失敗: {header_info.error_message}")
                return False

            # 3. 檢查數據長度合理性
            if header_info.header_size >= len(repaired_chunk):
                logger.debug("檔頭大小異常，等於或超過總數據大小")
                return False

            # 4. 檢查是否有音頻數據
            audio_data_size = len(repaired_chunk) - header_info.header_size
            if audio_data_size < 8:
                logger.debug("音頻數據長度不足")
                return False

            logger.debug(f"修復驗證通過: 檔頭={header_info.header_size} bytes, "
                        f"音頻={audio_data_size} bytes, "
                        f"編碼器={header_info.codec_type}")

            return True

        except Exception as e:
            logger.error(f"修復驗證發生錯誤: {e}")
            return False

    def get_repair_statistics(self) -> dict:
        """
        獲取修復統計信息

        Returns:
            dict: 包含修復統計數據的字典
        """
        stats = self._repair_stats.copy()

        # 計算成功率
        if stats['total_extractions'] > 0:
            stats['extraction_success_rate'] = stats['successful_extractions'] / stats['total_extractions']
        else:
            stats['extraction_success_rate'] = 0.0

        if stats['total_repairs'] > 0:
            stats['repair_success_rate'] = stats['successful_repairs'] / stats['total_repairs']
            stats['average_repair_time_ms'] = stats['total_repair_time_ms'] / stats['total_repairs']
        else:
            stats['repair_success_rate'] = 0.0
            stats['average_repair_time_ms'] = 0.0

        return stats

    def _validate_extracted_header(self, header_data: bytes) -> bool:
        """
        驗證提取的檔頭是否有效

        Args:
            header_data: 提取的檔頭數據

        Returns:
            bool: True 表示有效，False 表示無效
        """
        try:
            # 檢查基本長度
            if len(header_data) < 32:
                return False

            # 檢查 EBML header 標記
            if header_data[:4] != b'\x1A\x45\xDF\xA3':
                return False

            # 使用現有的檔頭檢測功能進行深度驗證
            header_info = detect_webm_header_info(header_data)
            return header_info.has_ebml_header and header_info.has_segment

        except Exception:
            return False

    def _find_audio_data_start(self, incomplete_chunk: bytes) -> int:
        """
        在不完整的 chunk 中尋找音頻數據的起始位置

        Args:
            incomplete_chunk: 不完整的 WebM chunk

        Returns:
            int: 音頻數據起始位置，-1 表示未找到
        """
        try:
            # 1. 檢查是否以 Cluster 元素開始 (0x1F43B675)
            cluster_marker = b'\x1F\x43\xB6\x75'
            if incomplete_chunk.startswith(cluster_marker):
                return 0  # 直接從 Cluster 開始

            # 2. 在前 64 bytes 中搜尋 Cluster 標記
            search_range = min(len(incomplete_chunk), 64)
            for i in range(search_range - len(cluster_marker) + 1):
                if incomplete_chunk[i:i + len(cluster_marker)] == cluster_marker:
                    return i

            # 3. 如果沒找到 Cluster，檢查是否包含其他音頻數據標記
            # SimpleBlock (0xA3) 或 Block (0xA1)
            audio_markers = [b'\xA3', b'\xA1']
            for marker in audio_markers:
                for i in range(search_range):
                    if incomplete_chunk[i:i + len(marker)] == marker:
                        return max(0, i - 8)  # 往前一點以包含可能的長度資訊

            # 4. 如果都沒找到，假設從開始就是音頻數據
            logger.debug("未找到明確的音頻數據標記，假設從頭開始")
            return 0

        except Exception as e:
            logger.debug(f"尋找音頻數據起始位置時發生錯誤: {e}")
            return 0  # 預設從開始處理

    def _update_header_timestamps(self, header_template: bytes, incomplete_chunk: bytes) -> bytes:
        """
        更新檔頭中的時間戳信息（如有需要）

        Args:
            header_template: 原始檔頭模板
            incomplete_chunk: 不完整的 chunk（可能包含時間戳信息）

        Returns:
            bytes: 更新後的檔頭數據
        """
        try:
            # 目前先返回原始檔頭模板
            # 未來可以實作更複雜的時間戳更新邏輯
            return header_template

        except Exception as e:
            logger.debug(f"更新檔頭時間戳時發生錯誤: {e}")
            return header_template
