"""
MLX Whisper API 錯誤處理中間件

提供全域錯誤處理，統一處理各種異常情況，
並返回符合 OpenAI API 規格的錯誤回應。
"""

import logging
import traceback
import time
from typing import Optional, Dict, Any

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.models.schemas import ErrorType, ErrorCode, create_error_response
from app.services.rate_limiter import RateLimitExceeded
from app.services.model_manager import ModelLoadError
from app.services.transcription import TranscriptionError, AudioProcessingError


logger = logging.getLogger(__name__)


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """錯誤處理中間件"""

    def __init__(self, app, debug: bool = False):
        """
        初始化錯誤處理中間件

        Args:
            app: FastAPI 應用實例
            debug: 是否為調試模式（返回詳細錯誤資訊）
        """
        super().__init__(app)
        self.debug = debug

        # 錯誤統計
        self._error_stats = {
            "total_errors": 0,
            "error_by_type": {},
            "error_by_status": {},
            "last_reset": time.time(),
        }

    async def dispatch(self, request: Request, call_next):
        """處理請求並捕獲錯誤"""
        start_time = time.time()

        try:
            response = await call_next(request)
            return response

        except Exception as exc:
            # 記錄處理時間
            processing_time = time.time() - start_time

            # 處理異常並返回錯誤回應
            return await self._handle_exception(request, exc, processing_time)

    async def _handle_exception(
        self, request: Request, exc: Exception, processing_time: float
    ) -> JSONResponse:
        """
        處理異常並返回適當的錯誤回應

        Args:
            request: 請求物件
            exc: 異常實例
            processing_time: 處理時間

        Returns:
            JSONResponse: 錯誤回應
        """
        # 決定錯誤類型和回應
        error_info = self._classify_error(exc)

        # 記錄錯誤
        await self._log_error(request, exc, error_info, processing_time)

        # 更新錯誤統計
        self._update_error_stats(error_info)

        # 建立錯誤回應
        error_response = create_error_response(
            message=error_info["message"],
            error_type=error_info["type"],
            error_code=error_info["code"],
        )

        # 在調試模式下添加額外資訊
        if self.debug:
            error_response.error.details = {
                "exception_type": type(exc).__name__,
                "processing_time": processing_time,
                "request_path": str(request.url.path),
                "request_method": request.method,
            }

            # 添加 traceback（僅在內部錯誤時）
            if error_info["status_code"] >= 500:
                error_response.error.traceback = traceback.format_exc()

        return JSONResponse(
            status_code=error_info["status_code"],
            content=error_response.model_dump(),
            headers=self._get_error_headers(),
        )

    def _classify_error(self, exc: Exception) -> Dict[str, Any]:
        """
        分類錯誤並決定回應格式

        Args:
            exc: 異常實例

        Returns:
            Dict: 包含錯誤資訊的字典
        """
        # HTTPException（FastAPI 內建）
        if isinstance(exc, HTTPException):
            return self._handle_http_exception(exc)

        # 速率限制錯誤
        elif isinstance(exc, RateLimitExceeded):
            return self._handle_rate_limit_error(exc)

        # 模型載入錯誤
        elif isinstance(exc, ModelLoadError):
            return self._handle_model_load_error(exc)

        # 音檔處理錯誤
        elif isinstance(exc, AudioProcessingError):
            return self._handle_audio_processing_error(exc)

        # 轉錄錯誤
        elif isinstance(exc, TranscriptionError):
            return self._handle_transcription_error(exc)

        # 驗證錯誤（Pydantic）
        elif hasattr(exc, "errors"):  # ValidationError
            return self._handle_validation_error(exc)

        # 其他未知錯誤
        else:
            return self._handle_internal_error(exc)

    def _handle_http_exception(self, exc: HTTPException) -> Dict[str, Any]:
        """處理 HTTP 異常"""
        status_code = exc.status_code

        if status_code == 400:
            error_type = ErrorType.INVALID_REQUEST_ERROR
            error_code = ErrorCode.INVALID_FILE
        elif status_code == 413:
            error_type = ErrorType.INVALID_REQUEST_ERROR
            error_code = ErrorCode.FILE_TOO_LARGE
        elif status_code == 429:
            error_type = ErrorType.RATE_LIMIT_ERROR
            error_code = ErrorCode.RATE_LIMIT
        elif status_code >= 500:
            error_type = ErrorType.INTERNAL_ERROR
            error_code = ErrorCode.INTERNAL_ERROR
        else:
            error_type = ErrorType.INVALID_REQUEST_ERROR
            error_code = ErrorCode.INVALID_FILE

        return {
            "status_code": status_code,
            "message": str(exc.detail),
            "type": error_type,
            "code": error_code,
        }

    def _handle_rate_limit_error(self, exc: RateLimitExceeded) -> Dict[str, Any]:
        """處理速率限制錯誤"""
        message = str(exc)
        if hasattr(exc, "wait_time") and exc.wait_time > 0:
            message += f" (建議等待 {exc.wait_time:.1f} 秒)"

        return {
            "status_code": 429,
            "message": message,
            "type": ErrorType.RATE_LIMIT_ERROR,
            "code": ErrorCode.RATE_LIMIT,
        }

    def _handle_model_load_error(self, exc: ModelLoadError) -> Dict[str, Any]:
        """處理模型載入錯誤"""
        return {
            "status_code": 503,
            "message": f"模型載入失敗: {str(exc)}",
            "type": ErrorType.SERVICE_UNAVAILABLE,
            "code": ErrorCode.OVERLOADED,
        }

    def _handle_audio_processing_error(
        self, exc: AudioProcessingError
    ) -> Dict[str, Any]:
        """處理音檔處理錯誤"""
        message = str(exc)

        # 檢查是否為檔案格式問題
        if "format" in message.lower() or "codec" in message.lower():
            return {
                "status_code": 400,
                "message": f"不支援的音檔格式: {message}",
                "type": ErrorType.INVALID_REQUEST_ERROR,
                "code": ErrorCode.INVALID_FILE_FORMAT,
            }

        return {
            "status_code": 400,
            "message": f"音檔處理失敗: {message}",
            "type": ErrorType.INVALID_REQUEST_ERROR,
            "code": ErrorCode.INVALID_FILE,
        }

    def _handle_transcription_error(self, exc: TranscriptionError) -> Dict[str, Any]:
        """處理轉錄錯誤"""
        message = str(exc)

        # 檢查是否為逾時錯誤
        if "timeout" in message.lower():
            return {
                "status_code": 504,
                "message": "轉錄請求逾時，請嘗試較短的音檔",
                "type": ErrorType.INTERNAL_ERROR,
                "code": ErrorCode.TIMEOUT,
            }

        return {
            "status_code": 500,
            "message": f"轉錄處理失敗: {message}",
            "type": ErrorType.INTERNAL_ERROR,
            "code": ErrorCode.INTERNAL_ERROR,
        }

    def _handle_validation_error(self, exc: Exception) -> Dict[str, Any]:
        """處理驗證錯誤"""
        try:
            # 嘗試提取詳細的驗證錯誤資訊
            errors = exc.errors() if hasattr(exc, "errors") else []

            if errors:
                # 取第一個錯誤作為主要訊息
                first_error = errors[0]
                field = " -> ".join(str(loc) for loc in first_error.get("loc", []))
                message = first_error.get("msg", "驗證失敗")

                return {
                    "status_code": 400,
                    "message": f"參數驗證失敗 ({field}): {message}",
                    "type": ErrorType.INVALID_REQUEST_ERROR,
                    "code": ErrorCode.INVALID_FILE,
                }

        except Exception:
            # 如果提取錯誤資訊失敗，回退到基本處理
            pass

        return {
            "status_code": 400,
            "message": f"請求參數驗證失敗: {str(exc)}",
            "type": ErrorType.INVALID_REQUEST_ERROR,
            "code": ErrorCode.INVALID_FILE,
        }

    def _handle_internal_error(self, exc: Exception) -> Dict[str, Any]:
        """處理內部錯誤"""
        # 檢查常見的內部錯誤類型
        exc_name = type(exc).__name__
        exc_msg = str(exc)

        # 記憶體錯誤
        if "memory" in exc_msg.lower() or exc_name == "MemoryError":
            return {
                "status_code": 503,
                "message": "伺服器記憶體不足，請稍後重試",
                "type": ErrorType.SERVICE_UNAVAILABLE,
                "code": ErrorCode.OVERLOADED,
            }

        # 逾時錯誤
        if "timeout" in exc_msg.lower() or exc_name == "TimeoutError":
            return {
                "status_code": 504,
                "message": "請求處理逾時，請稍後重試",
                "type": ErrorType.INTERNAL_ERROR,
                "code": ErrorCode.TIMEOUT,
            }

        # 一般內部錯誤
        return {
            "status_code": 500,
            "message": "伺服器內部錯誤，請稍後重試",
            "type": ErrorType.INTERNAL_ERROR,
            "code": ErrorCode.INTERNAL_ERROR,
        }

    async def _log_error(
        self,
        request: Request,
        exc: Exception,
        error_info: Dict[str, Any],
        processing_time: float,
    ) -> None:
        """記錄錯誤到日誌"""
        status_code = error_info["status_code"]

        # 準備日誌內容
        log_data = {
            "method": request.method,
            "path": str(request.url.path),
            "status_code": status_code,
            "error_type": error_info["type"],
            "error_code": error_info["code"],
            "processing_time": f"{processing_time:.3f}s",
            "user_agent": request.headers.get("user-agent", "unknown"),
            "client_ip": (
                getattr(request.client, "host", "unknown")
                if request.client
                else "unknown"
            ),
        }

        # 根據錯誤嚴重程度選擇日誌等級
        if status_code >= 500:
            # 服務器錯誤：ERROR 級別，包含完整 traceback
            logger.error(
                f"Internal server error: {error_info['message']} | "
                f"Request: {log_data['method']} {log_data['path']} | "
                f"Client: {log_data['client_ip']} | "
                f"Processing time: {log_data['processing_time']}",
                extra=log_data,
                exc_info=True,
            )
        elif status_code >= 400:
            # 客戶端錯誤：WARNING 級別
            logger.warning(
                f"Client error: {error_info['message']} | "
                f"Request: {log_data['method']} {log_data['path']} | "
                f"Client: {log_data['client_ip']}",
                extra=log_data,
            )
        else:
            # 其他情況：INFO 級別
            logger.info(
                f"Request error: {error_info['message']} | "
                f"Request: {log_data['method']} {log_data['path']}",
                extra=log_data,
            )

    def _update_error_stats(self, error_info: Dict[str, Any]) -> None:
        """更新錯誤統計"""
        self._error_stats["total_errors"] += 1

        # 按錯誤類型統計
        error_type = error_info["type"]
        self._error_stats["error_by_type"][error_type] = (
            self._error_stats["error_by_type"].get(error_type, 0) + 1
        )

        # 按狀態碼統計
        status_code = error_info["status_code"]
        self._error_stats["error_by_status"][status_code] = (
            self._error_stats["error_by_status"].get(status_code, 0) + 1
        )

    def _get_error_headers(self) -> Dict[str, str]:
        """取得錯誤回應的額外標頭"""
        return {
            "X-Error-Timestamp": str(int(time.time())),
            "X-Service-Name": "mlx-whisper-api",
        }

    def get_error_stats(self) -> Dict[str, Any]:
        """取得錯誤統計資訊"""
        current_time = time.time()
        uptime = current_time - self._error_stats["last_reset"]

        stats = dict(self._error_stats)
        stats["uptime"] = uptime

        # 計算錯誤率（如果有總請求數的話）
        if hasattr(self, "_total_requests"):
            total_requests = getattr(self, "_total_requests", 0)
            if total_requests > 0:
                stats["error_rate"] = self._error_stats["total_errors"] / total_requests

        return stats

    def reset_error_stats(self) -> None:
        """重設錯誤統計"""
        self._error_stats = {
            "total_errors": 0,
            "error_by_type": {},
            "error_by_status": {},
            "last_reset": time.time(),
        }
        logger.info("錯誤統計已重設")


# 便利函數


def create_error_handler_middleware(app, debug: bool = False) -> ErrorHandlerMiddleware:
    """
    建立錯誤處理中間件實例

    Args:
        app: FastAPI 應用
        debug: 是否為調試模式

    Returns:
        ErrorHandlerMiddleware: 中間件實例
    """
    return ErrorHandlerMiddleware(app, debug=debug)


async def handle_validation_error(exc: Exception) -> JSONResponse:
    """
    處理 Pydantic 驗證錯誤的便利函數

    Args:
        exc: 驗證錯誤異常

    Returns:
        JSONResponse: 格式化的錯誤回應
    """
    try:
        errors = exc.errors() if hasattr(exc, "errors") else []

        if errors:
            # 格式化所有驗證錯誤
            error_messages = []
            for error in errors:
                field = " -> ".join(str(loc) for loc in error.get("loc", []))
                message = error.get("msg", "驗證失敗")
                error_messages.append(f"{field}: {message}")

            combined_message = "; ".join(error_messages)
        else:
            combined_message = str(exc)

    except Exception:
        combined_message = str(exc)

    error_response = create_error_response(
        message=f"請求參數驗證失敗: {combined_message}",
        error_type=ErrorType.INVALID_REQUEST_ERROR,
        error_code=ErrorCode.INVALID_FILE,
    )

    return JSONResponse(status_code=400, content=error_response.model_dump())


def create_http_error_response(
    status_code: int, message: str, error_code: Optional[ErrorCode] = None
) -> JSONResponse:
    """
    建立 HTTP 錯誤回應的便利函數

    Args:
        status_code: HTTP 狀態碼
        message: 錯誤訊息
        error_code: 錯誤代碼

    Returns:
        JSONResponse: 錯誤回應
    """
    # 根據狀態碼決定錯誤類型
    if status_code == 429:
        error_type = ErrorType.RATE_LIMIT_ERROR
        default_code = ErrorCode.RATE_LIMIT
    elif status_code >= 500:
        error_type = ErrorType.INTERNAL_ERROR
        default_code = ErrorCode.INTERNAL_ERROR
    elif status_code == 413:
        error_type = ErrorType.INVALID_REQUEST_ERROR
        default_code = ErrorCode.FILE_TOO_LARGE
    else:
        error_type = ErrorType.INVALID_REQUEST_ERROR
        default_code = ErrorCode.INVALID_FILE

    error_response = create_error_response(
        message=message, error_type=error_type, error_code=error_code or default_code
    )

    return JSONResponse(status_code=status_code, content=error_response.model_dump())
