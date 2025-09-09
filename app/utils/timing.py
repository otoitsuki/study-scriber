from app.core.config import get_settings

def calc_times(seq: int):
    """計算切片的開始和結束時間戳 (秒)"""
    settings = get_settings()
    chunk_duration = settings.AUDIO_CHUNK_DURATION_SEC  # 每次都重新讀取設定
    overlap = getattr(settings, 'AUDIO_CHUNK_OVERLAP_SEC', 0)
    
    effective = chunk_duration - overlap
    start = seq * effective
    return start, start + chunk_duration
