from __future__ import annotations

import base64
import logging
from datetime import datetime
from typing import Dict, Any
from uuid import UUID

import google.generativeai as genai

from app.core.config import get_settings
from app.core.ffmpeg import webm_to_pcm
from .base import ISTTProvider

logger = logging.getLogger(__name__)
settings = get_settings()


class GeminiProvider(ISTTProvider):
    """使用 Vertex AI Gemini 2.5 Pro 的語音轉文字 Provider。"""

    def __init__(self) -> None:
        # 延遲載入，避免未設定 API Key 仍建立物件
        self._model: genai.GenerativeModel | None = None

    # ------------- 介面實作 -------------
    def name(self) -> str:  # type: ignore[override]
        return "gemini"

    def max_rpm(self) -> int:  # type: ignore[override]
        return settings.GEMINI_MAX_REQUESTS if hasattr(settings, "GEMINI_MAX_REQUESTS") else 60

    async def transcribe(self, webm: bytes, session_id: UUID, chunk_seq: int) -> Dict[str, Any]:  # type: ignore[override]
        """將 WebM 轉為 PCM，送至 Gemini 取得結果。"""
        logger.info(f"🎙️ [Gemini] 開始轉錄 chunk {chunk_seq} (session {session_id})")

        # 初始化模型
        if self._model is None:
            try:
                # 使用新版 google-generativeai 需要先全域設定 API Key
                genai.configure(api_key=settings.GEMINI_API_KEY)
                # 建立模型，不再接受 api_key/base_url 參數
                self._model = genai.GenerativeModel("gemini-2.5-pro-preview")
            except Exception as e:
                logger.error(f"[Gemini] 初始化模型失敗: {e}")
                raise

        # 1. 轉檔
        pcm_bytes = await webm_to_pcm(webm)

        # 2. 組 prompt
        prompt = getattr(settings, "GEMINI_PROMPT", "請輸出逐字稿：")

        # 3. 呼叫 API - 使用 inline_data 方式傳遞音訊 (符合新版 google-generativeai SDK)
        try:
            from google.generativeai import types as genai_types  # type: ignore

            parts = [
                {"text": prompt},
                genai_types.Part.from_bytes(data=pcm_bytes, mime_type="audio/wav"),
            ]

            res = await self._model.generate_content_async(contents=parts)

            text = res.text.strip() if hasattr(res, "text") else ""
        except Exception as e:
            logger.error(f"[Gemini] 轉錄失敗: {e}")
            raise

        logger.info(f"✅ [Gemini] chunk {chunk_seq} 轉錄完成，長度 {len(text)} 字")
        return {
            "text": text,
            "chunk_sequence": chunk_seq,
            "session_id": str(session_id),
            "timestamp": datetime.utcnow().isoformat(),
            "start_time": chunk_seq * settings.AUDIO_CHUNK_DURATION_SEC,
            "end_time": (chunk_seq + 1) * settings.AUDIO_CHUNK_DURATION_SEC,
            "provider": self.name(),
        }
