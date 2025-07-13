"""
settings_utils.py
集中放一些會在多個模組用到、但必須動態讀取
get_settings() 的小函式，避免 module import 時
把 settings 綁死。
"""

from app.core.config import get_settings


def get_chunk_duration() -> int:
    """
    回傳目前 .env 中指定的切片長度 (秒)。
    每次呼叫都重新走 get_settings()，確保與
    .env → Settings 一致。
    """
    return get_settings().AUDIO_CHUNK_DURATION_SEC


def get_filter_thresholds():
    """
    回傳 (no_speech_thresh, logprob_thresh, compression_thresh)。
    同樣每次重新讀取設定。
    """
    s = get_settings()
    return s.FILTER_NO_SPEECH, s.FILTER_LOGPROB, s.FILTER_COMPRESSION
