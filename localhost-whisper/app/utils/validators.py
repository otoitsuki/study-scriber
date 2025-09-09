"""
MLX Whisper API 輸入驗證工具

提供各種輸入驗證功能，包括請求參數驗證、
檔案安全檢查、模型驗證等。
"""

import re
import logging
from typing import List, Optional, Dict, Any, Union
from pathlib import Path

from fastapi import UploadFile, HTTPException
from pydantic import validator

from app.config import get_settings
from app.models.schemas import (
    ResponseFormat,
    TimestampGranularity,
    validate_audio_file_type,
)
from app.utils.audio import is_audio_file, AudioValidationError


logger = logging.getLogger(__name__)


class ValidationError(Exception):
    """驗證錯誤基礎類別"""

    pass


class FileValidationError(ValidationError):
    """檔案驗證錯誤"""

    pass


class ParameterValidationError(ValidationError):
    """參數驗證錯誤"""

    pass


class SecurityValidationError(ValidationError):
    """安全驗證錯誤"""

    pass


class RequestValidator:
    """請求驗證器"""

    def __init__(self):
        """初始化驗證器"""
        self.settings = get_settings()

        # 支援的語言代碼 (ISO 639-1)
        self.supported_languages = {
            "zh",
            "en",
            "ja",
            "ko",
            "es",
            "fr",
            "de",
            "it",
            "pt",
            "ru",
            "ar",
            "hi",
            "th",
            "vi",
            "id",
            "ms",
            "tl",
            "nl",
            "sv",
            "no",
            "da",
            "fi",
            "pl",
            "cs",
            "hu",
            "ro",
            "bg",
            "hr",
            "sk",
            "sl",
            "et",
            "lv",
            "lt",
            "mt",
            "cy",
            "ga",
            "gd",
            "br",
            "eu",
            "ca",
            "gl",
            "ast",
            "an",
            "oc",
            "co",
            "rm",
            "fur",
            "lld",
            "sc",
            "vec",
            "lij",
            "pms",
            "lmo",
            "emn",
            "rgn",
            "nap",
            "scn",
        }

        # 危險的檔案路徑模式
        self.dangerous_patterns = [
            r"\.\./",  # 路徑遍歷
            r"\.\.\\",  # Windows 路徑遍歷
            r"/etc/",  # 系統目錄
            r"\\windows\\",  # Windows 系統目錄
            r"<script",  # XSS 嘗試
            r"javascript:",  # JavaScript 協議
            r"data:",  # Data URLs
            r"\x00",  # 空字元
        ]

    def validate_model_name(self, model_name: str) -> str:
        """
        驗證模型名稱 (已加入別名支援)

        Args:
            model_name: 模型名稱

        Returns:
            str: 驗證後的真實模型名稱

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if not model_name or not isinstance(model_name, str):
            raise ParameterValidationError("模型名稱不能為空")

        # 移除前後空白
        model_name = model_name.strip()

        # 檢查是否為模型別名
        aliases = self.settings.get_model_aliases()
        if model_name in aliases:
            original_model = model_name
            model_name = aliases[original_model]
            logger.info(f"偵測到模型別名: '{original_model}' -> '{model_name}'")

        # 檢查是否為支援的模型
        supported_models = self.settings.get_supported_models()
        if model_name not in supported_models:
            # 在錯誤訊息中同時顯示別名和真實名稱
            if "original_model" in locals():
                error_message = (
                    f"模型別名 '{original_model}' 指向的目標模型 '{model_name}' 不被支援。"
                    f"支援的模型: {', '.join(supported_models)}"
                )
            else:
                error_message = (
                    f"不支援的模型: {model_name}。"
                    f"支援的模型: {', '.join(supported_models)}"
                )
            raise ParameterValidationError(error_message)

        return model_name

    def validate_language(self, language: Optional[str]) -> Optional[str]:
        """
        驗證語言代碼

        Args:
            language: 語言代碼

        Returns:
            Optional[str]: 驗證後的語言代碼

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if language is None:
            return None

        if not isinstance(language, str):
            raise ParameterValidationError("語言代碼必須是字串")

        # 移除前後空白並轉為小寫
        language = language.strip().lower()

        # 空字串或 'auto' 表示自動檢測
        if language == "" or language == "auto":
            return None

        # 檢查格式
        if len(language) != 2 or not language.isalpha():
            raise ParameterValidationError("語言代碼必須是2個字母的 ISO 639-1 格式")

        # 檢查是否為支援的語言
        if language not in self.supported_languages:
            logger.warning(f"不常見的語言代碼: {language}")
            # 不拋出異常，允許使用不常見的語言代碼

        return language

    def validate_prompt(self, prompt: Optional[str]) -> Optional[str]:
        """
        驗證引導文字

        Args:
            prompt: 引導文字

        Returns:
            Optional[str]: 驗證後的引導文字

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if prompt is None:
            return None

        if not isinstance(prompt, str):
            raise ParameterValidationError("引導文字必須是字串")

        # 移除前後空白
        prompt = prompt.strip()

        # 空字串視為 None
        if not prompt:
            return None

        # 長度檢查
        max_prompt_length = 1000  # 限制引導文字長度
        if len(prompt) > max_prompt_length:
            raise ParameterValidationError(
                f"引導文字過長，最多 {max_prompt_length} 個字元"
            )

        # 安全檢查
        self._check_text_security(prompt)

        return prompt

    def validate_temperature(self, temperature: float) -> float:
        """
        驗證溫度參數

        Args:
            temperature: 溫度值

        Returns:
            float: 驗證後的溫度值

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if not isinstance(temperature, (int, float)):
            raise ParameterValidationError("溫度必須是數字")

        temperature = float(temperature)

        if temperature < 0.0 or temperature > 1.0:
            raise ParameterValidationError("溫度必須在 0.0 到 1.0 之間")

        return temperature

    def validate_response_format(self, response_format: str) -> ResponseFormat:
        """
        驗證回應格式 (已加入 verbose_json 相容)

        Args:
            response_format: 回應格式字串

        Returns:
            ResponseFormat: 驗證後的回應格式

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if not isinstance(response_format, str):
            raise ParameterValidationError("回應格式必須是字串")

        response_format = response_format.lower().strip()

        # 將 verbose_json 視為 json 的別名
        if response_format == "verbose_json":
            logger.info("偵測到回應格式 'verbose_json'，將其視為 'json' 處理。")
            response_format = "json"

        try:
            return ResponseFormat(response_format)
        except ValueError:
            valid_formats = [format.value for format in ResponseFormat]
            raise ParameterValidationError(
                f"不支援的回應格式: {response_format}。支援的格式: {', '.join(valid_formats)}"
            )

    def validate_timestamp_granularities(
        self, granularities: Optional[List[str]]
    ) -> Optional[List[TimestampGranularity]]:
        """
        驗證時間戳精度

        Args:
            granularities: 時間戳精度列表

        Returns:
            Optional[List[TimestampGranularity]]: 驗證後的時間戳精度列表

        Raises:
            ParameterValidationError: 驗證失敗
        """
        if granularities is None:
            return None

        if not isinstance(granularities, list):
            raise ParameterValidationError("時間戳精度必須是列表")

        if not granularities:
            return None

        validated_granularities = []
        seen = set()

        for granularity in granularities:
            if not isinstance(granularity, str):
                raise ParameterValidationError("時間戳精度項目必須是字串")

            granularity = granularity.lower().strip()

            if granularity in seen:
                continue  # 跳過重複項目

            try:
                timestamp_granularity = TimestampGranularity(granularity)
                validated_granularities.append(timestamp_granularity)
                seen.add(granularity)
            except ValueError:
                valid_granularities = [g.value for g in TimestampGranularity]
                raise ParameterValidationError(
                    f"不支援的時間戳精度: {granularity}。支援的精度: {', '.join(valid_granularities)}"
                )

        return validated_granularities if validated_granularities else None

    def _check_text_security(self, text: str) -> None:
        """
        檢查文字安全性

        Args:
            text: 待檢查的文字

        Raises:
            SecurityValidationError: 發現安全問題
        """
        # 檢查危險模式
        for pattern in self.dangerous_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                raise SecurityValidationError(f"文字包含潛在危險內容: {pattern}")

        # 檢查過長的內容
        if len(text) > 10000:  # 10K 字元限制
            raise SecurityValidationError("文字內容過長")

        # 檢查異常字元
        try:
            text.encode("utf-8")
        except UnicodeEncodeError:
            raise SecurityValidationError("文字包含無效字元")


class FileValidator:
    """檔案驗證器"""

    def __init__(self):
        """初始化檔案驗證器"""
        self.settings = get_settings()
        self.request_validator = RequestValidator()

    async def validate_upload_file(self, file: UploadFile) -> Dict[str, Any]:
        """
        驗證上傳檔案

        Args:
            file: 上傳的檔案

        Returns:
            Dict[str, Any]: 檔案資訊

        Raises:
            FileValidationError: 檔案驗證失敗
        """
        if not file:
            raise FileValidationError("未提供檔案")

        # 檢查檔案名稱
        if not file.filename:
            raise FileValidationError("檔案名稱為空")

        filename = file.filename
        content_type = file.content_type

        # 安全檢查檔案名稱
        self._validate_filename_security(filename)

        # 讀取檔案內容
        try:
            file_content = await file.read()
            await file.seek(0)  # 重設檔案指標
        except Exception as e:
            raise FileValidationError(f"無法讀取檔案: {str(e)}")

        # 檢查檔案大小
        file_size = len(file_content)
        if file_size == 0:
            raise FileValidationError("檔案為空")

        if file_size > self.settings.max_file_size:
            max_size_mb = self.settings.get_max_file_size_mb()
            raise FileValidationError(
                f"檔案大小 {file_size/1024/1024:.1f}MB 超過限制 {max_size_mb:.1f}MB"
            )

        # 驗證檔案類型
        if not validate_audio_file_type(content_type or "", filename):
            raise FileValidationError("不支援的檔案類型")

        # 驗證檔案內容
        if not is_audio_file(filename, content_type, file_content):
            raise FileValidationError("檔案不是有效的音檔")

        return {
            "filename": filename,
            "content_type": content_type,
            "size": file_size,
            "content": file_content,
        }

    def _validate_filename_security(self, filename: str) -> None:
        """
        驗證檔案名稱安全性

        Args:
            filename: 檔案名稱

        Raises:
            SecurityValidationError: 發現安全問題
        """
        if not filename:
            raise SecurityValidationError("檔案名稱不能為空")

        # 檢查危險字元
        dangerous_chars = ["<", ">", ":", '"', "|", "?", "*", "\x00"]
        for char in dangerous_chars:
            if char in filename:
                raise SecurityValidationError(f"檔案名稱包含危險字元: {char}")

        # 檢查路徑遍歷
        for pattern in self.request_validator.dangerous_patterns:
            if re.search(pattern, filename, re.IGNORECASE):
                raise SecurityValidationError("檔案名稱包含潛在危險路徑")

        # 檢查檔案名稱長度
        if len(filename) > 255:
            raise SecurityValidationError("檔案名稱過長")

        # 檢查保留名稱 (Windows)
        reserved_names = {
            "CON",
            "PRN",
            "AUX",
            "NUL",
            "COM1",
            "COM2",
            "COM3",
            "COM4",
            "COM5",
            "COM6",
            "COM7",
            "COM8",
            "COM9",
            "LPT1",
            "LPT2",
            "LPT3",
            "LPT4",
            "LPT5",
            "LPT6",
            "LPT7",
            "LPT8",
            "LPT9",
        }

        base_name = Path(filename).stem.upper()
        if base_name in reserved_names:
            raise SecurityValidationError(f"檔案名稱是保留名稱: {base_name}")


class TranscriptionRequestValidator:
    """轉錄請求驗證器"""

    def __init__(self):
        """初始化請求驗證器"""
        self.request_validator = RequestValidator()
        self.file_validator = FileValidator()

    async def validate_transcription_request(
        self,
        file: UploadFile,
        model: str,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        response_format: str = "json",
        temperature: float = 0.0,
        timestamp_granularities: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        驗證完整的轉錄請求

        Args:
            file: 音檔檔案
            model: 模型名稱
            language: 語言代碼
            prompt: 引導文字
            response_format: 回應格式
            temperature: 溫度
            timestamp_granularities: 時間戳精度

        Returns:
            Dict[str, Any]: 驗證後的請求資料

        Raises:
            ValidationError: 驗證失敗
        """
        try:
            # 驗證檔案
            file_info = await self.file_validator.validate_upload_file(file)

            # 驗證參數
            validated_model = self.request_validator.validate_model_name(model)
            validated_language = self.request_validator.validate_language(language)
            validated_prompt = self.request_validator.validate_prompt(prompt)
            validated_response_format = self.request_validator.validate_response_format(
                response_format
            )
            validated_temperature = self.request_validator.validate_temperature(
                temperature
            )
            validated_granularities = (
                self.request_validator.validate_timestamp_granularities(
                    timestamp_granularities
                )
            )

            return {
                "file_info": file_info,
                "model": validated_model,
                "language": validated_language,
                "prompt": validated_prompt,
                "response_format": validated_response_format,
                "temperature": validated_temperature,
                "timestamp_granularities": validated_granularities,
            }

        except (
            ParameterValidationError,
            FileValidationError,
            SecurityValidationError,
        ) as e:
            # 重新拋出驗證錯誤
            raise e
        except Exception as e:
            # 捕獲其他未預期的錯誤
            logger.error(f"驗證過程中發生未預期錯誤: {str(e)}", exc_info=True)
            raise ValidationError(f"請求驗證失敗: {str(e)}")


# 全域驗證器實例
request_validator = RequestValidator()
file_validator = FileValidator()
transcription_request_validator = TranscriptionRequestValidator()


# 便利函數


def validate_model_name(model_name: str) -> str:
    """驗證模型名稱"""
    return request_validator.validate_model_name(model_name)


def validate_language_code(language: Optional[str]) -> Optional[str]:
    """驗證語言代碼"""
    return request_validator.validate_language(language)


def validate_prompt_text(prompt: Optional[str]) -> Optional[str]:
    """驗證引導文字"""
    return request_validator.validate_prompt(prompt)


def validate_temperature_value(temperature: float) -> float:
    """驗證溫度值"""
    return request_validator.validate_temperature(temperature)


def validate_response_format_value(response_format: str) -> ResponseFormat:
    """驗證回應格式"""
    return request_validator.validate_response_format(response_format)


async def validate_audio_upload(file: UploadFile) -> Dict[str, Any]:
    """驗證音檔上傳"""
    return await file_validator.validate_upload_file(file)


async def validate_complete_transcription_request(
    file: UploadFile, model: str, **kwargs
) -> Dict[str, Any]:
    """驗證完整轉錄請求"""
    return await transcription_request_validator.validate_transcription_request(
        file, model, **kwargs
    )


def get_supported_languages() -> set:
    """取得支援的語言代碼"""
    return request_validator.supported_languages.copy()


def is_supported_language(language: str) -> bool:
    """檢查是否為支援的語言"""
    return language.lower() in request_validator.supported_languages


def sanitize_filename(filename: str) -> str:
    """
    清理檔案名稱，移除危險字元

    Args:
        filename: 原始檔案名稱

    Returns:
        str: 清理後的檔案名稱
    """
    if not filename:
        return "unnamed_file"

    # 移除危險字元
    safe_filename = re.sub(r'[<>:"|?*\x00]', "", filename)

    # 移除路徑分隔符
    safe_filename = safe_filename.replace("/", "_").replace("\\", "_")

    # 限制長度
    if len(safe_filename) > 200:
        name, ext = Path(safe_filename).stem, Path(safe_filename).suffix
        safe_filename = name[: 200 - len(ext)] + ext

    return safe_filename or "unnamed_file"
