from app.core.config import get_settings
_CHUNK = get_settings().AUDIO_CHUNK_DURATION_SEC

def calc_times(seq: int):
    start = seq * _CHUNK
    return start, start + _CHUNK
