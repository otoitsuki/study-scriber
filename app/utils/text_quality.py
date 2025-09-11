"""
文本品質檢查工具
用於檢測和過濾 Whisper 幻覺輸出
"""

import re
import logging
from typing import List, Pattern

logger = logging.getLogger(__name__)


def is_low_quality_text(
    text: str, 
    max_repetition_ratio: float = 0.5,  # 降低門檻更嚴格
    min_char_threshold: int = 2,
    check_patterns: bool = True,
    check_diversity: bool = True,
    check_sentence_repetition: bool = True,
    check_phrase_repetition: bool = True
) -> bool:
    """
    檢測文本是否為低品質（幻覺輸出）
    
    Args:
        text: 要檢測的文本
        max_repetition_ratio: 最大重複比例門檻
        min_char_threshold: 最小字符數門檻
        check_patterns: 是否檢查幻覺模式
        check_diversity: 是否檢查字符多樣性
        check_sentence_repetition: 是否檢查句子重複
        check_phrase_repetition: 是否檢查詞組重複
        
    Returns:
        bool: 是否為低品質文本
    """
    if not text or len(text.strip()) < min_char_threshold:
        return True
    
    text = text.strip()
    
    # 1. 檢測句子重複模式
    if check_sentence_repetition and is_sentence_repetitive(text):
        logger.debug(f"🔄 [品質檢查] 檢測到句子重複: '{text[:30]}...'")
        return True
    
    # 2. 檢測詞組重複模式  
    if check_phrase_repetition and is_phrase_repetitive(text):
        logger.debug(f"🔄 [品質檢查] 檢測到詞組重複: '{text[:30]}...'")
        return True
    
    # 3. 檢測重複字符模式
    char_counts = {}
    for char in text:
        if char.strip():  # 忽略空白字符
            char_counts[char] = char_counts.get(char, 0) + 1
    
    if char_counts:
        # 計算最高頻字符的比例
        max_char_count = max(char_counts.values())
        repetition_ratio = max_char_count / len(text.replace(' ', ''))
        
        if repetition_ratio > max_repetition_ratio:
            logger.debug(
                f"🔄 [品質檢查] 高重複比例: {repetition_ratio:.2f} > {max_repetition_ratio}, "
                f"文本: '{text[:20]}...'"
            )
            return True
    
    # 檢測常見的 Whisper 幻覺模式
    if check_patterns:
        hallucination_patterns = get_hallucination_patterns()
        
        for pattern_obj in hallucination_patterns:
            if pattern_obj.search(text):
                logger.debug(f"🔄 [品質檢查] 檢測到幻覺模式: '{text[:20]}...'")
                return True
    
    # 檢查字符多樣性
    if check_diversity:
        unique_chars = set(text.replace(' ', ''))
        if len(unique_chars) <= 2 and len(text) > 10:
            logger.debug(f"🔄 [品質檢查] 字符多樣性過低: '{text[:20]}...'")
            return True
    
    return False


def get_hallucination_patterns() -> List[Pattern]:
    """
    獲取常見的幻覺模式正規表達式列表
    
    Returns:
        List[Pattern]: 編譯後的正規表達式模式列表
    """
    patterns = [
        r'^([乖嗯呃啊哦噢唉]{2,})+$',  # 純重複中文字符
        r'^([a-zA-Z])\1{3,}',          # 重複英文字符 
        r'^(.{1,3})\1{2,}$',          # 短模式重複
        r'(謝謝觀看|謝謝收聽|請訂閱|Subscribe|Thanks for watching)',  # 常見幻覺短語
        r'^[.,!?;:\s]*$',             # 只有標點符號
        r'^(哈){3,}$',                # 重複笑聲
        r'^(嘿){3,}$',                # 重複感嘆詞
    ]
    
    return [re.compile(pattern, re.IGNORECASE) for pattern in patterns]


def is_repetitive_text(
    text: str, 
    max_repetition_ratio: float = 0.6,
    min_char_threshold: int = 3
) -> bool:
    """
    專門檢測重複文本模式（與 localhost-whisper 服務保持一致）
    
    Args:
        text: 要檢測的文本
        max_repetition_ratio: 最大重複比例
        min_char_threshold: 最少字符數門檻
        
    Returns:
        bool: 是否為重複文本
    """
    if not text or len(text.strip()) < min_char_threshold:
        return True  # 空文本或過短文本視為低品質
    
    text = text.strip()
    
    # 檢測單字符重複模式
    char_counts = {}
    for char in text:
        if char.strip():  # 忽略空白字符
            char_counts[char] = char_counts.get(char, 0) + 1
    
    if char_counts:
        # 計算最高頻字符的比例
        max_char_count = max(char_counts.values())
        repetition_ratio = max_char_count / len(text.replace(' ', ''))
        
        if repetition_ratio > max_repetition_ratio:
            logger.debug(
                f"🔄 [重複檢測] 高重複比例: {repetition_ratio:.2f} > {max_repetition_ratio}, "
                f"文本: '{text[:20]}...'"
            )
            return True
    
    # 檢測常見的 Whisper 幻覺模式
    hallucination_patterns = [
        r'^([乖嗯呃啊哦]{3,})',  # 重複的中文字符
        r'^([a-zA-Z])\1{4,}',      # 重複的英文字符 
        r'^(.{1,2})\1{3,}',       # 短模式重複
        r'(謝謝觀看|謝謝收聽|謝謝|感謝|Subscribe)',  # 常見的幻覺短語
    ]
    
    for pattern in hallucination_patterns:
        if re.search(pattern, text):
            logger.debug(f"🔄 [模式檢測] 檢測到幻覺模式: '{text[:20]}...'")
            return True
    
    return False


def is_sentence_repetitive(text: str, max_repetition_ratio: float = 0.6) -> bool:
    """
    檢測句子重複模式
    
    Args:
        text: 要檢測的文本
        max_repetition_ratio: 最大重複句子比例
        
    Returns:
        bool: 是否包含重複句子
    """
    # 按中文句號、英文句號、問號、感嘆號分割句子
    sentences = re.split(r'[。.!?！？]', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    
    if len(sentences) <= 1:
        return False
    
    # 計算每個句子的出現次數
    sentence_counts = {}
    for sentence in sentences:
        if len(sentence) > 2:  # 忽略過短的句子片段
            sentence_counts[sentence] = sentence_counts.get(sentence, 0) + 1
    
    if not sentence_counts:
        return False
    
    # 檢查是否有句子重複次數過高
    max_count = max(sentence_counts.values())
    total_sentences = len(sentences)
    repetition_ratio = max_count / total_sentences
    
    return repetition_ratio > max_repetition_ratio


def is_phrase_repetitive(text: str, max_repetition_ratio: float = 0.7) -> bool:
    """
    檢測詞組/單詞重複模式
    
    Args:
        text: 要檢測的文本  
        max_repetition_ratio: 最大重複詞組比例
        
    Returns:
        bool: 是否包含重複詞組
    """
    # 按空格分割詞組，同時處理中英文混合
    words = text.split()
    if len(words) <= 2:
        return False
    
    # 計算每個詞的出現次數
    word_counts = {}
    for word in words:
        word = word.strip('~,.!?;:')  # 去除標點符號
        if len(word) > 1:  # 忽略單字符詞
            word_counts[word] = word_counts.get(word, 0) + 1
    
    if not word_counts:
        return False
    
    # 檢查是否有詞重複次數過高
    max_count = max(word_counts.values())
    total_words = len(words)
    repetition_ratio = max_count / total_words
    
    # 特別檢查連續重複詞組模式 (如 "yeah~yeah yeah")
    text_lower = text.lower()
    if re.search(r'(\b\w+[~]*\w*\b)\s*\1\s*\1', text_lower):  # 連續3次相同詞組
        return True
    
    return repetition_ratio > max_repetition_ratio


def check_transcription_quality(
    text: str,
    provider_name: str = "unknown"
) -> bool:
    """
    統一的轉錄品質檢查入口
    
    Args:
        text: 轉錄文本
        provider_name: Provider 名稱（用於日誌）
        
    Returns:
        bool: True 表示品質良好，False 表示應該過濾
    """
    if is_low_quality_text(text):
        logger.info(f"🔇 [{provider_name}] 文本品質檢查失敗，建議過濾: '{text[:30]}...'")
        return False
    
    logger.debug(f"✅ [{provider_name}] 文本品質檢查通過: '{text[:50]}...'")
    return True