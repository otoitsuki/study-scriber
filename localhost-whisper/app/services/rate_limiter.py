"""
MLX Whisper API 速率限制器

實作基於滑動視窗演算法的速率限制，
支援 IP 級別和全域的請求速率控制。
"""

import asyncio
import logging
import time
from collections import deque, defaultdict
from typing import Dict, Optional, Tuple, List
from datetime import datetime, timedelta

from app.config import get_settings


logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    """速率限制超過異常"""

    def __init__(self, message: str, wait_time: float = 0.0):
        super().__init__(message)
        self.wait_time = wait_time


class RateLimiter:
    """速率限制器"""

    def __init__(
        self,
        max_requests_per_minute: Optional[int] = None,
        window_size: int = 60,
        cleanup_interval: int = 300,  # 5分鐘清理一次
    ):
        """
        初始化速率限制器

        Args:
            max_requests_per_minute: 每分鐘最大請求數
            window_size: 時間窗口大小（秒）
            cleanup_interval: 清理間隔（秒）
        """
        self.settings = get_settings()
        self.max_requests = (
            max_requests_per_minute or self.settings.max_requests_per_minute
        )
        self.window_size = window_size
        self.cleanup_interval = cleanup_interval

        # 儲存每個客戶端的請求記錄 {client_id: deque}
        self._requests: Dict[str, deque] = defaultdict(deque)

        # 全域請求記錄
        self._global_requests: deque = deque()

        # 併發控制鎖
        self._lock = asyncio.Lock()

        # 最後清理時間
        self._last_cleanup = time.time()

        # 統計資訊
        self._stats = {
            "total_requests": 0,
            "blocked_requests": 0,
            "clients_count": 0,
            "last_reset": time.time(),
        }

        logger.info(f"速率限制器已初始化，每分鐘最大請求數: {self.max_requests}")

    async def check_rate_limit(
        self, client_id: str = "global", check_global: bool = True
    ) -> bool:
        """
        檢查是否超過速率限制

        Args:
            client_id: 客戶端ID（可以是IP或其他識別符）
            check_global: 是否檢查全域限制

        Returns:
            bool: True表示允許請求，False表示超過限制
        """
        async with self._lock:
            current_time = time.time()

            # 執行定期清理
            await self._cleanup_if_needed(current_time)

            # 更新統計
            self._stats["total_requests"] += 1

            # 檢查客戶端級別限制
            client_allowed = await self._check_client_limit(client_id, current_time)

            # 檢查全域限制
            global_allowed = True
            if check_global:
                global_allowed = await self._check_global_limit(current_time)

            # 只有兩個都通過才允許
            allowed = client_allowed and global_allowed

            if allowed:
                # 記錄請求
                self._requests[client_id].append(current_time)
                if check_global:
                    self._global_requests.append(current_time)

                # 更新客戶端計數
                self._stats["clients_count"] = len(self._requests)
            else:
                # 記錄被阻擋的請求
                self._stats["blocked_requests"] += 1
                logger.debug(f"請求被速率限制阻擋: client={client_id}")

            return allowed

    async def _check_client_limit(self, client_id: str, current_time: float) -> bool:
        """檢查客戶端級別的速率限制"""
        client_requests = self._requests[client_id]

        # 清理過期請求
        while client_requests and client_requests[0] < current_time - self.window_size:
            client_requests.popleft()

        # 檢查是否超過限制
        return len(client_requests) < self.max_requests

    async def _check_global_limit(self, current_time: float) -> bool:
        """檢查全域速率限制"""
        # 清理過期請求
        while (
            self._global_requests
            and self._global_requests[0] < current_time - self.window_size
        ):
            self._global_requests.popleft()

        # 全域限制通常比個別客戶端限制高一些
        global_max = self.max_requests * 10  # 假設最多10個併發客戶端
        return len(self._global_requests) < global_max

    async def get_wait_time(
        self, client_id: str = "global", check_global: bool = True
    ) -> float:
        """
        獲取需要等待的時間

        Args:
            client_id: 客戶端ID
            check_global: 是否檢查全域限制

        Returns:
            float: 需要等待的時間（秒），0表示不需要等待
        """
        async with self._lock:
            current_time = time.time()

            # 計算客戶端等待時間
            client_wait = await self._calculate_client_wait_time(
                client_id, current_time
            )

            # 計算全域等待時間
            global_wait = 0.0
            if check_global:
                global_wait = await self._calculate_global_wait_time(current_time)

            # 返回較大的等待時間
            return max(client_wait, global_wait)

    async def _calculate_client_wait_time(
        self, client_id: str, current_time: float
    ) -> float:
        """計算客戶端等待時間"""
        client_requests = self._requests[client_id]

        if len(client_requests) < self.max_requests:
            return 0.0

        # 找到最舊的請求
        if client_requests:
            oldest_request = client_requests[0]
            wait_time = self.window_size - (current_time - oldest_request)
            return max(0.0, wait_time)

        return 0.0

    async def _calculate_global_wait_time(self, current_time: float) -> float:
        """計算全域等待時間"""
        global_max = self.max_requests * 10

        if len(self._global_requests) < global_max:
            return 0.0

        if self._global_requests:
            oldest_request = self._global_requests[0]
            wait_time = self.window_size - (current_time - oldest_request)
            return max(0.0, wait_time)

        return 0.0

    async def _cleanup_if_needed(self, current_time: float) -> None:
        """如果需要，執行清理"""
        if current_time - self._last_cleanup > self.cleanup_interval:
            await self._cleanup_expired_records(current_time)
            self._last_cleanup = current_time

    async def _cleanup_expired_records(self, current_time: float) -> None:
        """清理過期記錄"""
        cutoff_time = current_time - self.window_size * 2  # 保留2倍窗口時間的記錄

        # 清理客戶端記錄
        clients_to_remove = []
        for client_id, requests in self._requests.items():
            # 清理過期請求
            while requests and requests[0] < cutoff_time:
                requests.popleft()

            # 如果客戶端沒有請求記錄，標記為待刪除
            if not requests:
                clients_to_remove.append(client_id)

        # 刪除空的客戶端記錄
        for client_id in clients_to_remove:
            del self._requests[client_id]

        # 清理全域記錄
        while self._global_requests and self._global_requests[0] < cutoff_time:
            self._global_requests.popleft()

        if clients_to_remove:
            logger.debug(f"清理了 {len(clients_to_remove)} 個過期客戶端記錄")

    async def reset_client_limit(self, client_id: str) -> bool:
        """
        重設客戶端限制

        Args:
            client_id: 客戶端ID

        Returns:
            bool: 是否成功重設
        """
        async with self._lock:
            if client_id in self._requests:
                self._requests[client_id].clear()
                logger.info(f"已重設客戶端 {client_id} 的速率限制")
                return True
            return False

    async def reset_all_limits(self) -> None:
        """重設所有限制"""
        async with self._lock:
            self._requests.clear()
            self._global_requests.clear()
            self._stats["blocked_requests"] = 0
            self._stats["last_reset"] = time.time()
            logger.info("已重設所有速率限制")

    def get_client_status(self, client_id: str) -> Dict[str, any]:
        """
        獲取客戶端狀態

        Args:
            client_id: 客戶端ID

        Returns:
            Dict: 客戶端狀態資訊
        """
        client_requests = self._requests.get(client_id, deque())
        current_time = time.time()

        # 計算窗口內的請求數
        window_requests = sum(
            1
            for req_time in client_requests
            if req_time > current_time - self.window_size
        )

        return {
            "client_id": client_id,
            "requests_in_window": window_requests,
            "max_requests": self.max_requests,
            "remaining_requests": max(0, self.max_requests - window_requests),
            "window_size": self.window_size,
            "last_request": client_requests[-1] if client_requests else None,
        }

    def get_global_status(self) -> Dict[str, any]:
        """獲取全域狀態"""
        current_time = time.time()

        # 計算窗口內的全域請求數
        window_requests = sum(
            1
            for req_time in self._global_requests
            if req_time > current_time - self.window_size
        )

        global_max = self.max_requests * 10

        return {
            "global_requests_in_window": window_requests,
            "global_max_requests": global_max,
            "global_remaining": max(0, global_max - window_requests),
            "active_clients": len(self._requests),
            "total_requests": self._stats["total_requests"],
            "blocked_requests": self._stats["blocked_requests"],
            "block_rate": (
                self._stats["blocked_requests"] / self._stats["total_requests"]
                if self._stats["total_requests"] > 0
                else 0
            ),
            "uptime": current_time - self._stats["last_reset"],
        }

    async def check_and_wait(
        self,
        client_id: str = "global",
        max_wait_time: float = 60.0,
        check_global: bool = True,
    ) -> bool:
        """
        檢查速率限制，如果超過則等待

        Args:
            client_id: 客戶端ID
            max_wait_time: 最大等待時間（秒）
            check_global: 是否檢查全域限制

        Returns:
            bool: True表示成功，False表示等待時間超過最大值

        Raises:
            RateLimitExceeded: 等待時間超過最大值時拋出
        """
        if await self.check_rate_limit(client_id, check_global):
            return True

        wait_time = await self.get_wait_time(client_id, check_global)

        if wait_time > max_wait_time:
            raise RateLimitExceeded(
                f"需要等待 {wait_time:.1f} 秒，超過最大等待時間 {max_wait_time} 秒",
                wait_time,
            )

        if wait_time > 0:
            logger.info(f"速率限制觸發，等待 {wait_time:.1f} 秒")
            await asyncio.sleep(wait_time)

        # 等待後再次檢查
        return await self.check_rate_limit(client_id, check_global)


# 全域速率限制器實例
_rate_limiter_instance: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """
    獲取全域速率限制器實例（單例模式）

    Returns:
        RateLimiter: 速率限制器實例
    """
    global _rate_limiter_instance

    if _rate_limiter_instance is None:
        _rate_limiter_instance = RateLimiter()

    return _rate_limiter_instance


# 全域實例
rate_limiter = get_rate_limiter()


# 便利函數


async def check_rate_limit(client_id: str = "global") -> bool:
    """檢查速率限制"""
    return await rate_limiter.check_rate_limit(client_id)


async def get_wait_time(client_id: str = "global") -> float:
    """獲取等待時間"""
    return await rate_limiter.get_wait_time(client_id)


def get_client_ip_from_request(request) -> str:
    """
    從請求中提取客戶端IP

    Args:
        request: FastAPI Request 物件

    Returns:
        str: 客戶端IP地址
    """
    # 檢查代理標頭
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # 取第一個IP（如果有多個代理）
        return forwarded_for.split(",")[0].strip()

    # 檢查其他代理標頭
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip

    # 回退到直接IP
    return str(request.client.host) if request.client else "unknown"


async def rate_limit_middleware(request, client_id: Optional[str] = None):
    """
    速率限制中間件輔助函數

    Args:
        request: FastAPI Request 物件
        client_id: 可選的客戶端ID，如果未提供則使用IP

    Returns:
        bool: 是否允許請求

    Raises:
        RateLimitExceeded: 超過速率限制
    """
    if client_id is None:
        client_id = get_client_ip_from_request(request)

    allowed = await rate_limiter.check_rate_limit(client_id)

    if not allowed:
        wait_time = await rate_limiter.get_wait_time(client_id)
        raise RateLimitExceeded(
            f"超過速率限制，請等待 {wait_time:.1f} 秒後重試", wait_time
        )

    return True
