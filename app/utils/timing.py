from app.core.config import get_settings
_CHUNK = get_settings().AUDIO_CHUNK_DURATION_SEC
_OVERLAP = getattr(get_settings(), 'AUDIO_CHUNK_OVERLAP_SEC', 0)

def calc_times(seq: int):
    effective = _CHUNK - _OVERLAP
    start = seq * effective
    return start, start + _CHUNK
