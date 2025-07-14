import asyncio, shlex, re
from app.core.config import get_settings

async def is_silent(wav: bytes) -> bool:
    """
    若整段音訊都在靜音門檻以下，回 True
    """
    s = get_settings()
    noise_db = s.SILENCE_NOISE_DB
    duration = s.SILENCE_DURATION_SEC
    cmd = (
        f"ffmpeg -v info -i pipe:0 "
        f"-af silencedetect=noise={noise_db}dB:d={duration} "
        f"-f null -"
    )
    proc = await asyncio.create_subprocess_exec(
        *shlex.split(cmd),
        stdin=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate(wav)
    log = err.decode()

    # FFmpeg 只在偵測到音訊時印出 "silence_end"
    return "silence_end" not in log
