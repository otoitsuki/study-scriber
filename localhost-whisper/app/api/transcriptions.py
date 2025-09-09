"""
音頻轉錄端點

提供音頻轉錄服務，符合 OpenAI Whisper API 規格。
"""

import time
import logging
import asyncio
import json
from typing import Optional, List, Union
from binascii import hexlify  # <-- 新增

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
    Request,
)
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from app.config import get_settings, Settings
from app.models.schemas import (
    TranscriptionResponse,
    ResponseFormat,
    TimestampGranularity,
    ErrorType,
    ErrorCode,
    create_error_response,
)
from app.models.responses import (
    format_response_by_type,
    get_content_type_by_format,
    create_streaming_response_generator,
)
from app.services.model_manager import get_model_manager, ModelManager
from app.services.rate_limiter import get_rate_limiter, RateLimiter
from app.services.transcription import get_transcription_service, TranscriptionService
from app.utils.validators import (
    transcription_request_validator,
    ValidationError,
    FileValidationError,
    ParameterValidationError,
    SecurityValidationError,
)
from app.middleware.metrics import record_request_metrics

logger = logging.getLogger(__name__)

# 建立路由器
router = APIRouter(
    prefix="/v1/audio",
    tags=["transcriptions"],
    responses={
        200: {"description": "轉錄成功"},
        400: {"description": "請求參數錯誤"},
        413: {"description": "檔案過大"},
        429: {"description": "請求頻率過高"},
        500: {"description": "內部伺服器錯誤"},
        503: {"description": "服務暫時不可用"},
    },
)


async def get_client_ip(request: Request) -> str:
    """取得客戶端 IP 位址"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post(
    "/transcriptions",
    summary="音頻轉錄",
    description="將音頻檔案轉錄為文字，支援多種格式和語言",
    response_model=None,
)
async def create_transcription(
    request: Request,
    file: UploadFile = File(..., description="要轉錄的音頻檔案"),
    model: str = Form(..., description="使用的模型名稱"),
    language: Optional[str] = Form(None, description="音頻語言（ISO-639-1 格式）"),
    prompt: Optional[str] = Form(None, description="引導文字，幫助模型理解上下文"),
    response_format: str = Form(
        "json", description="回應格式：json, verbose_json, text, srt, vtt"
    ),
    temperature: float = Form(0.0, description="取樣溫度 (0.0-1.0)"),
    timestamp_granularities: Optional[str] = Form(
        None, description="時間戳精度，逗號分隔：segment,word"
    ),
    settings: Settings = Depends(get_settings),
    model_manager: ModelManager = Depends(get_model_manager),
    rate_limiter: RateLimiter = Depends(get_rate_limiter),
    transcription_service: TranscriptionService = Depends(get_transcription_service),
) -> Union[JSONResponse, PlainTextResponse, StreamingResponse]:
    """
    轉錄音頻檔案
    """
    start_time = time.time()
    client_ip = await get_client_ip(request)

    # ==========  Debug: 檢查上傳檔案位元流  ==========
    # 在任何進一步處理前，讀取並輸出前 16 bytes 與總大小
    try:
        raw_bytes = await file.read()
        logger.debug("=== DEBUG size = %d bytes", len(raw_bytes))
        logger.debug("=== DEBUG head16 = %s", hexlify(raw_bytes[:16]))
        file.file.seek(0)  # 重新指標，供後續流程正常讀取
    except Exception as e:
        logger.warning("DEBUG 讀取上傳檔案失敗: %s", str(e))
    # ================================================

    try:
        # 1. 速率限制檢查
        await rate_limiter.check_rate_limit(client_ip)

        # 2. 驗證請求參數
        try:
            # 解析 timestamp_granularities
            parsed_granularities = None
            if timestamp_granularities:
                granularity_list = [
                    g.strip() for g in timestamp_granularities.split(",")
                ]
                parsed_granularities = [
                    TimestampGranularity(g) for g in granularity_list
                ]

            # 驗證請求
            validation_result = (
                await transcription_request_validator.validate_transcription_request(
                    file=file,
                    model=model,
                    language=language,
                    prompt=prompt,
                    response_format=response_format,
                    temperature=temperature,
                    timestamp_granularities=parsed_granularities,
                )
            )

        except ValidationError as e:
            logger.warning(f"請求驗證失敗: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e),
            )

        # 3. 讀取檔案內容
        try:
            audio_data = await file.read()
        except Exception as e:
            logger.error(f"檔案讀取失敗: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法讀取上傳的檔案",
            )

        # 4. 執行轉錄
        try:
            transcription_result = await transcription_service.transcribe_audio(
                audio_data=audio_data,
                model_name=validation_result["model"],
                language=validation_result["language"],
                prompt=validation_result["prompt"],
                temperature=validation_result["temperature"],
                timestamp_granularities=validation_result["timestamp_granularities"],
                content_type=file.content_type,
                filename=file.filename,
            )

        except Exception as e:
            logger.error(f"轉錄服務失敗: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"轉錄處理失敗: {str(e)}",
            )

        # 5. 格式化回應
        try:
            processing_time = time.time() - start_time

            # 記錄指標
            if settings.enable_metrics:
                await record_request_metrics(
                    "transcription",
                    processing_time,
                    len(audio_data),
                    transcription_result.duration or 0,
                )

            # 根據回應格式生成回應
            response_format_enum = ResponseFormat(validation_result["response_format"])
            response_content = format_response_by_type(
                transcription_result, response_format_enum
            )
            content_type = get_content_type_by_format(response_format_enum)

            # 如果是串流格式，返回串流回應
            if response_format_enum in [ResponseFormat.SRT, ResponseFormat.VTT]:
                return StreamingResponse(
                    create_streaming_response_generator(
                        transcription_result, response_format_enum
                    ),
                    media_type=content_type,
                    headers={
                        "Content-Disposition": f'attachment; filename="transcript.{response_format_enum.value}"'
                    },
                )

            # 否則返回 JSON 或純文字回應
            if response_format_enum in [
                ResponseFormat.JSON,
                ResponseFormat.VERBOSE_JSON,
            ]:
                # 對於 JSON 格式，response_content 已經是 JSON 字串，需要解析為 dict
                import json

                content_dict = json.loads(response_content)
                return JSONResponse(
                    content=content_dict,
                    media_type=content_type,
                )
            else:
                # 對於純文字格式，直接返回字串
                return PlainTextResponse(
                    content=response_content,
                    media_type=content_type,
                )

        except Exception as e:
            logger.error(f"回應格式化失敗: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="回應格式化失敗",
            )

    except HTTPException:
        # 重新拋出 HTTP 異常
        raise
    except Exception as e:
        logger.error("轉錄處理失敗: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="轉錄處理失敗"
        )
