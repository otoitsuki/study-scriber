"""
MLX Whisper API Prometheus 指標中間件

收集並匯出 API 服務的各種指標，
包括請求指標、效能指標和業務指標。
"""

import logging
import time
import psutil
import os
from typing import Dict, Optional, Any

from fastapi import Request, Response
from fastapi.responses import PlainTextResponse
from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    Info,
    Enum,
    generate_latest,
    CollectorRegistry,
    CONTENT_TYPE_LATEST,
)
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings


logger = logging.getLogger(__name__)


class PrometheusMetricsMiddleware(BaseHTTPMiddleware):
    """Prometheus 指標收集中間件"""

    def __init__(self, app, registry: Optional[CollectorRegistry] = None):
        """
        初始化指標中間件

        Args:
            app: FastAPI 應用實例
            registry: Prometheus 收集器註冊表
        """
        super().__init__(app)
        self.settings = get_settings()
        self.registry = registry or CollectorRegistry()

        # 初始化所有指標
        self._init_request_metrics()
        self._init_performance_metrics()
        self._init_business_metrics()
        self._init_system_metrics()
        self._init_service_info()

        # 啟動時間
        self._start_time = time.time()

        logger.info("Prometheus 指標中間件已初始化")

    def _init_request_metrics(self) -> None:
        """初始化請求相關指標"""
        # 請求總數
        self.request_count = Counter(
            "whisper_api_requests_total",
            "Total number of HTTP requests",
            ["method", "endpoint", "status_code"],
            registry=self.registry,
        )

        # 請求持續時間
        self.request_duration = Histogram(
            "whisper_api_request_duration_seconds",
            "HTTP request duration in seconds",
            ["method", "endpoint"],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0, float("inf")],
            registry=self.registry,
        )

        # 請求大小
        self.request_size = Histogram(
            "whisper_api_request_size_bytes",
            "HTTP request size in bytes",
            ["method", "endpoint"],
            buckets=[
                1024,
                10240,
                102400,
                1048576,
                10485760,
                26214400,
                float("inf"),
            ],  # 1KB to 25MB
            registry=self.registry,
        )

        # 回應大小
        self.response_size = Histogram(
            "whisper_api_response_size_bytes",
            "HTTP response size in bytes",
            ["method", "endpoint"],
            buckets=[1024, 10240, 102400, 1048576, float("inf")],
            registry=self.registry,
        )

        # 活躍請求數
        self.active_requests = Gauge(
            "whisper_api_active_requests",
            "Number of active HTTP requests",
            registry=self.registry,
        )

    def _init_performance_metrics(self) -> None:
        """初始化效能相關指標"""
        # 模型載入時間
        self.model_load_duration = Histogram(
            "whisper_api_model_load_duration_seconds",
            "Model loading duration in seconds",
            ["model_name"],
            buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, float("inf")],
            registry=self.registry,
        )

        # 轉錄處理時間
        self.transcription_duration = Histogram(
            "whisper_api_transcription_duration_seconds",
            "Transcription processing duration in seconds",
            ["model_name"],
            buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, float("inf")],
            registry=self.registry,
        )

        # 音檔處理時間
        self.audio_processing_duration = Histogram(
            "whisper_api_audio_processing_duration_seconds",
            "Audio processing duration in seconds",
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, float("inf")],
            registry=self.registry,
        )

        # 轉錄速度比率
        self.transcription_speed_ratio = Histogram(
            "whisper_api_transcription_speed_ratio",
            "Transcription speed ratio (audio_duration / processing_time)",
            ["model_name"],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, float("inf")],
            registry=self.registry,
        )

    def _init_business_metrics(self) -> None:
        """初始化業務相關指標"""
        # 音檔時長
        self.audio_duration = Histogram(
            "whisper_api_audio_duration_seconds",
            "Processed audio duration in seconds",
            buckets=[10.0, 30.0, 60.0, 300.0, 600.0, 1800.0, 3600.0, float("inf")],
            registry=self.registry,
        )

        # 轉錄文字長度
        self.transcription_text_length = Histogram(
            "whisper_api_transcription_text_length_characters",
            "Length of transcribed text in characters",
            buckets=[100, 500, 1000, 5000, 10000, 50000, float("inf")],
            registry=self.registry,
        )

        # 載入的模型數量
        self.loaded_models_count = Gauge(
            "whisper_api_loaded_models_count",
            "Number of currently loaded models",
            registry=self.registry,
        )

        # 速率限制觸發次數
        self.rate_limit_hits = Counter(
            "whisper_api_rate_limit_hits_total",
            "Total number of rate limit hits",
            ["client_type"],
            registry=self.registry,
        )

        # 錯誤計數
        self.error_count = Counter(
            "whisper_api_errors_total",
            "Total number of errors",
            ["error_type", "error_code"],
            registry=self.registry,
        )

    def _init_system_metrics(self) -> None:
        """初始化系統資源指標"""
        # CPU 使用率
        self.cpu_usage = Gauge(
            "whisper_api_cpu_usage_percent",
            "Current CPU usage percentage",
            registry=self.registry,
        )

        # 記憶體使用量
        self.memory_usage = Gauge(
            "whisper_api_memory_usage_bytes",
            "Current memory usage in bytes",
            registry=self.registry,
        )

        # 記憶體使用率
        self.memory_usage_percent = Gauge(
            "whisper_api_memory_usage_percent",
            "Current memory usage percentage",
            registry=self.registry,
        )

        # 磁碟使用量
        self.disk_usage = Gauge(
            "whisper_api_disk_usage_bytes",
            "Current disk usage in bytes",
            ["path"],
            registry=self.registry,
        )

        # 運行時間
        self.uptime = Gauge(
            "whisper_api_uptime_seconds",
            "Service uptime in seconds",
            registry=self.registry,
        )

    def _init_service_info(self) -> None:
        """初始化服務資訊指標"""
        # 服務資訊
        self.service_info = Info(
            "whisper_api_service_info", "Service information", registry=self.registry
        )

        # 設定服務資訊
        self.service_info.info(
            {
                "version": "1.0.0",
                "python_version": f"{os.sys.version_info.major}.{os.sys.version_info.minor}.{os.sys.version_info.micro}",
                "default_model": self.settings.default_model,
                "max_requests_per_minute": str(self.settings.max_requests_per_minute),
                "max_file_size": str(self.settings.max_file_size),
                "workers": str(self.settings.workers),
            }
        )

    async def dispatch(self, request: Request, call_next):
        """中間件主要邏輯"""
        start_time = time.time()

        # 獲取請求資訊
        method = request.method
        path = request.url.path
        endpoint = self._normalize_endpoint(path)

        # 計算請求大小
        request_size = self._get_request_size(request)

        # 更新活躍請求計數
        self.active_requests.inc()

        try:
            # 處理請求
            response = await call_next(request)

            # 計算處理時間
            duration = time.time() - start_time

            # 獲取回應資訊
            status_code = str(response.status_code)
            response_size = self._get_response_size(response)

            # 記錄指標
            self.request_count.labels(
                method=method, endpoint=endpoint, status_code=status_code
            ).inc()

            self.request_duration.labels(method=method, endpoint=endpoint).observe(
                duration
            )

            self.request_size.labels(method=method, endpoint=endpoint).observe(
                request_size
            )

            self.response_size.labels(method=method, endpoint=endpoint).observe(
                response_size
            )

            return response

        except Exception as exc:
            # 記錄錯誤
            duration = time.time() - start_time

            self.request_count.labels(
                method=method, endpoint=endpoint, status_code="500"
            ).inc()

            self.request_duration.labels(method=method, endpoint=endpoint).observe(
                duration
            )

            # 重新拋出異常
            raise exc

        finally:
            # 更新活躍請求計數
            self.active_requests.dec()

    def _normalize_endpoint(self, path: str) -> str:
        """標準化端點路徑（用於指標標籤）"""
        # 移除查詢參數
        if "?" in path:
            path = path.split("?")[0]

        # 標準化常見路徑
        if path.startswith("/v1/audio/transcriptions"):
            return "/v1/audio/transcriptions"
        elif path.startswith("/v1/audio/translations"):
            return "/v1/audio/translations"
        elif path.startswith("/v1/models"):
            return "/v1/models"
        elif path == "/health":
            return "/health"
        elif path == "/metrics":
            return "/metrics"
        else:
            return path

    def _get_request_size(self, request: Request) -> int:
        """獲取請求大小"""
        try:
            content_length = request.headers.get("content-length")
            if content_length:
                return int(content_length)
        except (ValueError, TypeError):
            pass
        return 0

    def _get_response_size(self, response: Response) -> int:
        """獲取回應大小"""
        try:
            content_length = response.headers.get("content-length")
            if content_length:
                return int(content_length)
        except (ValueError, TypeError):
            pass
        return 0

    def update_system_metrics(self) -> None:
        """更新系統資源指標"""
        try:
            # CPU 使用率
            cpu_percent = psutil.cpu_percent(interval=None)
            self.cpu_usage.set(cpu_percent)

            # 記憶體使用情況
            memory = psutil.virtual_memory()
            self.memory_usage.set(memory.used)
            self.memory_usage_percent.set(memory.percent)

            # 磁碟使用情況
            disk = psutil.disk_usage("/")
            self.disk_usage.labels(path="/").set(disk.used)

            # 運行時間
            uptime = time.time() - self._start_time
            self.uptime.set(uptime)

        except Exception as e:
            logger.warning(f"更新系統指標失敗: {str(e)}")

    def record_model_load(self, model_name: str, duration: float) -> None:
        """記錄模型載入指標"""
        self.model_load_duration.labels(model_name=model_name).observe(duration)

    def record_transcription(
        self, model_name: str, duration: float, audio_duration: float, text_length: int
    ) -> None:
        """記錄轉錄指標"""
        self.transcription_duration.labels(model_name=model_name).observe(duration)
        self.audio_duration.observe(audio_duration)
        self.transcription_text_length.observe(text_length)

        # 計算速度比率
        if duration > 0:
            speed_ratio = audio_duration / duration
            self.transcription_speed_ratio.labels(model_name=model_name).observe(
                speed_ratio
            )

    def record_audio_processing(self, duration: float) -> None:
        """記錄音檔處理指標"""
        self.audio_processing_duration.observe(duration)

    def record_rate_limit_hit(self, client_type: str = "unknown") -> None:
        """記錄速率限制觸發"""
        self.rate_limit_hits.labels(client_type=client_type).inc()

    def record_error(self, error_type: str, error_code: str) -> None:
        """記錄錯誤"""
        self.error_count.labels(error_type=error_type, error_code=error_code).inc()

    def update_loaded_models_count(self, count: int) -> None:
        """更新載入模型數量"""
        self.loaded_models_count.set(count)


# 全域指標中間件實例
_metrics_middleware_instance: Optional[PrometheusMetricsMiddleware] = None


def get_metrics_middleware() -> Optional[PrometheusMetricsMiddleware]:
    """獲取全域指標中間件實例"""
    return _metrics_middleware_instance


def create_metrics_middleware(app) -> PrometheusMetricsMiddleware:
    """
    建立並設定指標中間件

    Args:
        app: FastAPI 應用實例

    Returns:
        PrometheusMetricsMiddleware: 指標中間件實例
    """
    global _metrics_middleware_instance
    _metrics_middleware_instance = PrometheusMetricsMiddleware(app)
    return _metrics_middleware_instance


def setup_metrics_endpoint(app) -> None:
    """
    設定 /metrics 端點

    Args:
        app: FastAPI 應用實例
    """
    middleware = get_metrics_middleware()

    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint():
        """Prometheus 指標端點"""
        if middleware is None:
            return PlainTextResponse("Metrics not available", status_code=503)

        # 更新系統指標
        middleware.update_system_metrics()

        # 更新載入模型數量（簡化版不再載入模型）
        try:
            from app.services.model_manager import get_model_manager

            model_manager = get_model_manager()
            # 簡化版 ModelManager 不再載入模型，所以載入數量為 0
            loaded_count = 0
            middleware.update_loaded_models_count(loaded_count)
        except Exception as e:
            logger.warning(f"更新模型計數失敗: {str(e)}")

        # 生成 Prometheus 指標
        return PlainTextResponse(
            generate_latest(middleware.registry), media_type=CONTENT_TYPE_LATEST
        )


def setup_metrics_integration(app) -> None:
    """
    設定完整的指標整合

    Args:
        app: FastAPI 應用實例
    """
    settings = get_settings()

    if settings.enable_metrics:
        # 建立指標中間件並直接添加到應用
        middleware = PrometheusMetricsMiddleware(app)

        # 設定指標端點
        setup_metrics_endpoint(app)

        logger.info(f"Prometheus 指標已啟用，端點: /metrics")
    else:
        logger.info("Prometheus 指標已停用")


# 便利函數


def record_model_load_time(model_name: str, duration: float) -> None:
    """記錄模型載入時間"""
    middleware = get_metrics_middleware()
    if middleware:
        middleware.record_model_load(model_name, duration)


def record_transcription_metrics(
    model_name: str, processing_duration: float, audio_duration: float, text_length: int
) -> None:
    """記錄轉錄相關指標"""
    middleware = get_metrics_middleware()
    if middleware:
        middleware.record_transcription(
            model_name, processing_duration, audio_duration, text_length
        )


def record_audio_processing_time(duration: float) -> None:
    """記錄音檔處理時間"""
    middleware = get_metrics_middleware()
    if middleware:
        middleware.record_audio_processing(duration)


def record_rate_limit_violation(client_type: str = "unknown") -> None:
    """記錄速率限制違規"""
    middleware = get_metrics_middleware()
    if middleware:
        middleware.record_rate_limit_hit(client_type)


def record_error_occurrence(error_type: str, error_code: str) -> None:
    """記錄錯誤發生"""
    middleware = get_metrics_middleware()
    if middleware:
        middleware.record_error(error_type, error_code)


async def record_request_metrics(
    endpoint: str,
    method: str,
    status_code: int,
    processing_time: float,
    model_name: str = None,
) -> None:
    """
    記錄請求指標（用於手動記錄特殊情況）

    Args:
        endpoint: API 端點名稱
        method: HTTP 方法
        status_code: HTTP 狀態碼
        processing_time: 處理時間（秒）
        model_name: 使用的模型名稱（可選）
    """
    middleware = get_metrics_middleware()

    if middleware:
        # 手動記錄轉錄相關的業務指標
        if model_name and endpoint == "transcriptions":
            # 由於這裡沒有音檔時長和文字長度，我們只記錄處理時間
            middleware.transcription_duration.labels(model_name=model_name).observe(
                processing_time
            )

        logger.debug(
            f"手動記錄指標 - 端點: {endpoint}, 方法: {method}, "
            f"狀態碼: {status_code}, 處理時間: {processing_time:.3f}s"
        )
