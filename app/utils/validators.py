"""
檔案驗證工具

實作各種檔案格式的基本驗證功能
"""

import logging

logger = logging.getLogger(__name__)


def valid_webm(head: bytes) -> bool:
    """
    驗證 WebM 檔案格式

    檢查 EBML header 魔術數字 0x1A45DFA3
    WebM 是基於 Matroska 容器格式，使用 EBML 編碼

    Args:
        head: 檔案開頭的位元組資料（至少需要 4 bytes）

    Returns:
        bool: 如果是有效的 WebM 檔案則返回 True
    """
    if len(head) < 4:
        logger.warning("檔案過小，無法進行 WebM 格式驗證")
        return False

    # EBML header 魔術數字: 0x1A45DFA3
    ebml_header = b"\x1A\x45\xDF\xA3"

    is_valid = head.startswith(ebml_header)

    if is_valid:
        logger.debug("✅ WebM 檔案格式驗證通過")
    else:
        logger.warning(f"❌ WebM 檔案格式驗證失敗: 期望 {ebml_header.hex()}, 實際 {head[:4].hex()}")

    return is_valid


def valid_audio_size(size_bytes: int, max_size: int = 5 * 1024 * 1024) -> bool:
    """
    驗證音檔大小

    Args:
        size_bytes: 檔案大小（位元組）
        max_size: 最大允許大小（預設 5MB）

    Returns:
        bool: 如果檔案大小在允許範圍內則返回 True
    """
    is_valid = 0 < size_bytes <= max_size

    if is_valid:
        logger.debug(f"✅ 音檔大小驗證通過: {size_bytes} bytes")
    else:
        logger.warning(f"❌ 音檔大小驗證失敗: {size_bytes} bytes (限制: {max_size} bytes)")

    return is_valid


def valid_sequence_number(seq: int, min_seq: int = 0, max_seq: int = 9999) -> bool:
    """
    驗證序號範圍

    Args:
        seq: 序號
        min_seq: 最小序號（預設 0）
        max_seq: 最大序號（預設 9999）

    Returns:
        bool: 如果序號在有效範圍內則返回 True
    """
    is_valid = min_seq <= seq <= max_seq

    if is_valid:
        logger.debug(f"✅ 序號驗證通過: {seq}")
    else:
        logger.warning(f"❌ 序號驗證失敗: {seq} (範圍: {min_seq}-{max_seq})")

    return is_valid
