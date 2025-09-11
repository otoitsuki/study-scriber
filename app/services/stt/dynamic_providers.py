"""
動態配置的 STT Providers
支援從 session 配置建立，而非只從環境變數
"""
from typing import Optional, Dict, Any
from uuid import UUID
import logging
import asyncio
from openai import AsyncOpenAI, AsyncAzureOpenAI, RateLimitError

from app.services.stt.interfaces import ISTTProvider
from app.core.ffmpeg import detect_audio_format, webm_to_wav
from app.core.config import get_settings
from app.db.database import get_supabase_client
from app.utils.timer import PerformanceTimer
from app.utils.timing import calc_times
from app.lib.httpx_timeout import get_httpx_timeout
from app.utils.text_quality import check_transcription_quality

logger = logging.getLogger(__name__)
settings = get_settings()


class WhisperProviderDynamic(ISTTProvider):
    """動態配置的 Whisper Provider"""

    name = "whisper-dynamic"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        api_version: Optional[str] = None
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.api_version = api_version

        # 建立客戶端
        if "openai.azure.com" in base_url.lower():
            self.client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=base_url,
                api_version=api_version or "2024-06-01",
                timeout=(5, 55),
                max_retries=2
            )
            self.is_azure = True
        else:
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
                timeout=(5, 55),
                max_retries=2
            )
            self.is_azure = False

        logger.info(f"✅ Created WhisperProviderDynamic: {'Azure' if self.is_azure else 'OpenAI'}, model={model}")

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
        *,
        api_language: str = "zh-TW",
        canonical_lang: str = "zh-TW"
    ) -> Optional[Dict[str, Any]]:
        """轉錄音訊"""

        with PerformanceTimer(f"WhisperDynamic chunk {chunk_seq}"):
            # 1. 檢測音訊格式並轉換
            fmt = detect_audio_format(audio)
            if fmt not in ("webm", "wav"):
                logger.error(f"Whisper 不支援格式 {fmt}")
                return None

            wav_bytes = await webm_to_wav(audio) if fmt == "webm" else audio
            if not wav_bytes:
                logger.error(f"WebM→WAV 轉換失敗 session={session_id} seq={chunk_seq}")
                return None

            # 2. 呼叫 Whisper API
            try:
                file_tuple = ("chunk.wav", wav_bytes, "audio/wav")
                response = await self.client.audio.transcriptions.create(
                    model=self.model,
                    file=file_tuple,
                    language=self._convert_language_code(canonical_lang),
                    response_format="json"
                )

                text = getattr(response, "text", "").strip()
                if not text:
                    logger.info(f"Whisper 回傳空文字 session={session_id} seq={chunk_seq}")
                    return None

                # 3. 計算時間戳
                start_time, end_time = calc_times(chunk_seq)

                return {
                    "text": text,
                    "start_time": start_time,
                    "end_time": end_time,
                    "chunk_sequence": chunk_seq,
                    "provider": "whisper-dynamic",
                    "model": self.model,
                    "language": canonical_lang,
                    "lang_code": canonical_lang  # 添加 lang_code 欄位
                }

            except RateLimitError as e:
                logger.warning(f"Whisper 429 限流: {e}")
                raise
            except Exception as e:
                logger.error(f"Whisper API 錯誤: {e}", exc_info=True)
                return None

    def _convert_language_code(self, canonical_lang: str) -> str:
        """轉換語言代碼為 Whisper 支援的格式"""
        lang_map = {
            "zh-TW": "zh",
            "en-US": "en",
            "ja-JP": "ja",
            "ko-KR": "ko"
        }
        return lang_map.get(canonical_lang, "zh")


class GPT4oProviderDynamic(ISTTProvider):
    """動態配置的 GPT-4o Provider"""

    name = "gpt4o-dynamic"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        api_version: Optional[str] = None
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.api_version = api_version

        # 建立客戶端
        if "openai.azure.com" in base_url.lower():
            self.client = AsyncAzureOpenAI(
                api_key=api_key,
                azure_endpoint=base_url,
                api_version=api_version or "2024-06-01",
                timeout=(5, 55),
                max_retries=2
            )
            self.is_azure = True
        else:
            self.client = AsyncOpenAI(
                api_key=api_key,
                base_url=base_url,
                timeout=(5, 55),
                max_retries=2
            )
            self.is_azure = False

        logger.info(f"✅ Created GPT4oProviderDynamic: {'Azure' if self.is_azure else 'OpenAI'}, model={model}")

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
        *,
        api_language: str = "zh-TW",
        canonical_lang: str = "zh-TW"
    ) -> Optional[Dict[str, Any]]:
        """轉錄音訊"""

        with PerformanceTimer(f"GPT4oDynamic chunk {chunk_seq}"):
            # 1. 檢測音訊格式並轉換
            fmt = detect_audio_format(audio)
            if fmt not in ("webm", "wav"):
                logger.error(f"GPT4o 不支援格式 {fmt}")
                return None

            wav_bytes = await webm_to_wav(audio) if fmt == "webm" else audio
            if not wav_bytes:
                logger.error(f"WebM→WAV 轉換失敗 session={session_id} seq={chunk_seq}")
                return None

            # 2. 呼叫 GPT-4o Audio API
            try:
                file_tuple = ("chunk.wav", wav_bytes, "audio/wav")
                response = await self.client.audio.transcriptions.create(
                    model=self.model,
                    file=file_tuple,
                    language=self._convert_language_code(canonical_lang),
                    response_format="json",
                    # GPT-4o 可能支援自訂 prompt
                    prompt=self._get_transcription_prompt(canonical_lang)
                )

                text = getattr(response, "text", "").strip()
                if not text:
                    logger.info(f"GPT4o 回傳空文字 session={session_id} seq={chunk_seq}")
                    return None

                # 3. 計算時間戳
                start_time, end_time = calc_times(chunk_seq)

                return {
                    "text": text,
                    "start_time": start_time,
                    "end_time": end_time,
                    "chunk_sequence": chunk_seq,
                    "provider": "gpt4o-dynamic",
                    "model": self.model,
                    "language": canonical_lang,
                    "lang_code": canonical_lang  # 添加 lang_code 欄位
                }

            except RateLimitError as e:
                logger.warning(f"GPT4o 429 限流: {e}")
                raise
            except Exception as e:
                logger.error(f"GPT4o API 錯誤: {e}", exc_info=True)
                return None

    def _convert_language_code(self, canonical_lang: str) -> str:
        """轉換語言代碼為 GPT-4o 支援的格式"""
        lang_map = {
            "zh-TW": "zh",
            "en-US": "en",
            "ja-JP": "ja",
            "ko-KR": "ko"
        }
        return lang_map.get(canonical_lang, "zh")

    def _get_transcription_prompt(self, canonical_lang: str) -> Optional[str]:
        """取得轉錄提示詞"""
        prompts = {
            "zh-TW": "請輸出繁體中文逐字稿",
            "en-US": "Please output English transcription",
            "ja-JP": "日本語の文字起こしを出力してください"
        }
        return prompts.get(canonical_lang)


class GeminiProviderDynamic(ISTTProvider):
    """動態配置的 Gemini Provider（佔位符）"""

    name = "gemini-dynamic"

    def __init__(
        self,
        api_key: str,
        model: str,
        endpoint: Optional[str] = None
    ):
        self.api_key = api_key
        self.model = model
        self.endpoint = endpoint

        # TODO: 實作 Gemini 客戶端
        logger.info(f"✅ Created GeminiProviderDynamic: model={model}")

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
        *,
        api_language: str = "zh-TW",
        canonical_lang: str = "zh-TW"
    ) -> Optional[Dict[str, Any]]:
        """轉錄音訊（Gemini 實作）"""

        # TODO: 實作 Gemini API 呼叫
        logger.warning("GeminiProviderDynamic 尚未實作")
        return None


class LocalhostWhisperProviderDynamic(ISTTProvider):
    """動態配置的 Localhost Whisper Provider"""

    name = "localhost-whisper-dynamic"

    def __init__(
        self,
        base_url: str,
        api_key: str = "dummy",  # localhost 不需要真實 API key
        model: str = "breeze-asr-25"
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model

        # 確保 base_url 格式正確
        if not self.base_url.startswith("http"):
            self.base_url = f"http://{self.base_url}"

        # 正確處理 URL 構建
        if self.base_url.endswith("/v1"):
            # 如果 base_url 已包含 /v1，直接使用
            self.transcription_url = f"{self.base_url}/audio/transcriptions"
            self.health_url = self.base_url.replace("/v1", "/health")
        else:
            # 如果 base_url 不包含 /v1，添加它
            self.transcription_url = f"{self.base_url}/v1/audio/transcriptions"
            self.health_url = f"{self.base_url}/health"

        logger.info(f"✅ Created LocalhostWhisperProviderDynamic: endpoint={self.base_url}, model={model}")


    async def _check_service_health(self) -> bool:
        """檢查 localhost whisper 服務是否可用"""
        import httpx
        try:
            # 使用較長的超時進行健康檢查，因為模型載入可能需要時間
            health_timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)
            async with httpx.AsyncClient(timeout=health_timeout) as client:
                response = await client.get(self.health_url)
                return response.status_code == 200
        except Exception as e:
            logger.warning(f"Localhost Whisper 服務健康檢查失敗: {e}")
            return False

    async def transcribe(
        self,
        audio: bytes,
        session_id: UUID,
        chunk_seq: int,
        *,
        api_language: str = "zh-TW",
        canonical_lang: str = "zh-TW"
    ) -> Optional[Dict[str, Any]]:
        """轉錄音訊"""
        import httpx

        with PerformanceTimer(f"LocalhostWhisperDynamic chunk {chunk_seq}"):
            # 1. 檢查服務健康狀態
            if not await self._check_service_health():
                logger.error(f"Localhost Whisper 服務不可用: {self.base_url}")
                return None

            try:
                # 2. 檢測音訊格式並轉換為 WAV
                fmt = detect_audio_format(audio)
                if fmt not in ("webm", "wav"):
                    logger.error(f"Localhost Whisper 不支援格式 {fmt}")
                    return None

                wav_bytes = await webm_to_wav(audio) if fmt == "webm" else audio
                if not wav_bytes:
                    logger.error(f"WebM→WAV 轉換失敗 session={session_id} seq={chunk_seq}")
                    return None

                # 3. 準備請求數據
                files = {
                    "file": ("chunk.wav", wav_bytes, "audio/wav")
                }
                data = {
                    "model": self.model,
                    "language": self._convert_language_code(canonical_lang),
                    "response_format": "json",
                    "temperature": 0
                }

                # 4. 調用 localhost Whisper API，使用配置的超時設定和重試機制
                timeout = get_httpx_timeout()
                max_retries = settings.MAX_RETRIES
                retry_delay = settings.RETRY_DELAY_SEC

                for attempt in range(max_retries):
                    try:
                        async with httpx.AsyncClient(timeout=timeout) as client:
                            logger.info(f"🔄 嘗試轉錄 (第 {attempt + 1}/{max_retries} 次): session={session_id}, seq={chunk_seq}")

                            response = await client.post(
                                self.transcription_url,
                                files=files,
                                data=data
                            )

                            if response.status_code != 200:
                                logger.error(f"Localhost Whisper API 錯誤: {response.status_code} - {response.text}")
                                if attempt < max_retries - 1:
                                    logger.info(f"⏳ 等待 {retry_delay} 秒後重試...")
                                    await asyncio.sleep(retry_delay)
                                    continue
                                return None

                            result = response.json()
                            logger.info(f"✅ 轉錄成功: session={session_id}, seq={chunk_seq}")
                            break

                    except httpx.ReadTimeout as e:
                        logger.warning(f"⚠️ 轉錄超時 (第 {attempt + 1}/{max_retries} 次): {e}")
                        if attempt < max_retries - 1:
                            logger.info(f"⏳ 等待 {retry_delay} 秒後重試...")
                            await asyncio.sleep(retry_delay)
                            continue
                        logger.error(f"❌ 轉錄最終失敗，已達最大重試次數: session={session_id}, seq={chunk_seq}")
                        return None
                    except Exception as e:
                        logger.error(f"❌ 轉錄請求異常 (第 {attempt + 1}/{max_retries} 次): {e}")
                        if attempt < max_retries - 1:
                            logger.info(f"⏳ 等待 {retry_delay} 秒後重試...")
                            await asyncio.sleep(retry_delay)
                            continue
                        return None

                # 5. 檢查是否被過濾
                if result.get("_filtered"):
                    logger.info(f"LocalhostWhisperDynamic 結果被品質過濾: session={session_id}, chunk={chunk_seq}")
                    return None
                
                text = result.get("text", "").strip()
                if not text:
                    logger.info(f"Localhost Whisper 回傳空文字 session={session_id} seq={chunk_seq}")
                    return None
                
                # 6. 額外的品質檢查（雙重保險）
                if not check_transcription_quality(text, "LocalhostWhisperDynamic"):
                    logger.info(f"DynamicProvider 層品質檢查失敗，過濾結果: session={session_id}, chunk={chunk_seq}")
                    return None

                # 7. 計算時間戳
                start_time, end_time = calc_times(chunk_seq)

                return {
                    "text": text,
                    "start_time": start_time,
                    "end_time": end_time,
                    "chunk_sequence": chunk_seq,
                    "provider": "localhost-whisper-dynamic",
                    "model": self.model,
                    "language": canonical_lang,
                    "lang_code": canonical_lang  # 添加 lang_code 欄位
                }

            except Exception as e:
                logger.error(f"Localhost Whisper API 錯誤: {e}", exc_info=True)
                return None

    def _convert_language_code(self, canonical_lang: str) -> str:
        """轉換語言代碼為 Whisper 支援的格式"""
        lang_map = {
            "zh-TW": "zh",
            "en-US": "en",
            "ja-JP": "ja",
            "ko-KR": "ko"
        }
        return lang_map.get(canonical_lang, "zh")

