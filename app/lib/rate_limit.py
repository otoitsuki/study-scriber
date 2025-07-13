# app/lib/rate_limit.py
import asyncio
import logging
from app.core.config import get_settings

logger = logging.getLogger(__name__)

class RateLimitHandler:
    def __init__(self):
        self._delay = 0
        logger.info("🚦 [RateLimitHandler] 頻率限制處理器已初始化")

    async def wait(self):
        if self._delay:
            logger.info(f"⏳ [RateLimitHandler] 等待 {self._delay}s 避免頻率限制")
            await asyncio.sleep(self._delay)

    def backoff(self):
        previous_delay = self._delay
        self._delay = min((self._delay or 5) * 2, 60)
        logger.warning(f"📈 [RateLimitHandler] 退避延遲：{previous_delay}s → {self._delay}s")

    def reset(self):
        if self._delay > 0:
            logger.info(f"✅ [RateLimitHandler] 重置延遲：{self._delay}s → 0s")
            self._delay = 0

class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int = 3, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.semaphore = asyncio.Semaphore(max_requests)
        self.active_requests = 0
        self.total_acquired = 0
        self.total_released = 0
        self._lock = asyncio.Lock()
        logger.info(f"🪟 [SlidingWindow] 初始化完成：{max_requests} requests/{window_seconds}s")

    async def acquire(self):
        await self.semaphore.acquire()
        async with self._lock:
            self.active_requests += 1
            self.total_acquired += 1
        loop = asyncio.get_event_loop()
        loop.call_later(self.window_seconds, self._release_permit)

    def _release_permit(self):
        self.semaphore.release()
        self.active_requests = max(0, self.active_requests - 1)
        self.total_released += 1

    async def wait(self):
        await self.acquire()

    def get_stats(self):
        return {
            'type': 'sliding_window',
            'max_requests': self.max_requests,
            'window_seconds': self.window_seconds,
            'active_requests': self.active_requests,
            'available_permits': self.max_requests - self.active_requests,
            'total_acquired': self.total_acquired,
            'total_released': self.total_released,
            'utilization_percent': (self.active_requests / self.max_requests) * 100 if self.max_requests > 0 else 0,
            'is_at_capacity': self.active_requests >= self.max_requests
        }

    def reset(self):
        self.total_acquired = 0
        self.total_released = 0

    def backoff(self):
        logger.warning(f"🚦 [SlidingWindow] 遇到 429 錯誤，滑動視窗將自動處理退避")

    @property
    def _delay(self):
        if self.active_requests >= self.max_requests:
            return max(1, self.window_seconds // 4)
        return 0


def get_rate_limit():
    s = get_settings()
    if getattr(s, "USE_SLIDING_WINDOW_RATE_LIMIT", False):
        if not hasattr(get_rate_limit, "_sliding_window"):
            get_rate_limit._sliding_window = SlidingWindowRateLimiter(
                max_requests=getattr(s, "SLIDING_WINDOW_MAX_REQUESTS", 3),
                window_seconds=getattr(s, "SLIDING_WINDOW_SECONDS", 60)
            )
        return get_rate_limit._sliding_window
    else:
        if not hasattr(get_rate_limit, "_handler"):
            get_rate_limit._handler = RateLimitHandler()
        return get_rate_limit._handler
