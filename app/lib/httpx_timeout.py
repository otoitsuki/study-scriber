from httpx import Timeout
from app.core.config import get_settings

def get_httpx_timeout() -> Timeout:
    """
    依據設定檔回傳 httpx.Timeout 物件。
    這樣任何 provider 引用時都不會 NameError。
    """
    s = get_settings()
    return Timeout(
        connect=s.HTTPX_CONNECT_TIMEOUT,   # e.g. 5
        read=s.HTTPX_READ_TIMEOUT,         # 55
        write=s.HTTPX_WRITE_TIMEOUT,       # 30
        pool=s.HTTPX_POOL_TIMEOUT,         # 5
    )
