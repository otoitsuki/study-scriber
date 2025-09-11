"""
MLX Whisper API 轉錄服務

實作音檔轉錄的核心邏輯，包括音檔處理、
MLX Whisper 模型調用、結果格式化等功能。
"""

import asyncio
import io
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Any, Tuple, Union

import librosa
import numpy as np
import mlx_whisper

from app.config import get_settings
from app.models.schemas import (
    TranscriptionResponse,
    SegmentInfo,
    WordInfo,
    TimestampGranularity,
    ProcessingStats,
    AudioFileInfo,
)
from app.services.model_manager import get_model_manager


logger = logging.getLogger(__name__)


class TranscriptionError(Exception):
    """轉錄錯誤異常"""

    pass


class AudioProcessingError(Exception):
    """音檔處理錯誤異常"""

    pass


class TranscriptionService:
    """轉錄服務"""

    def __init__(self):
        """初始化轉錄服務"""
        self.settings = get_settings()
        self.model_manager = get_model_manager()

        # 音檔處理執行緒池
        self._audio_executor = ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="audio_processor"
        )

        # 轉錄執行緒池
        self._transcription_executor = ThreadPoolExecutor(
            max_workers=self.settings.max_concurrent_per_worker,
            thread_name_prefix="mlx_transcriber",
        )

        # 統計資訊
        self._stats = {
            "total_transcriptions": 0,
            "total_audio_duration": 0.0,
            "total_processing_time": 0.0,
            "failed_transcriptions": 0,
        }

        logger.info("轉錄服務已初始化")

    async def get_service_status(self) -> Dict[str, Any]:
        """
        獲取轉錄服務狀態

        Returns:
            Dict: 服務狀態資訊
        """
        return {
            "available": True,
            "active_requests": 0,  # 這裡可以根據實際情況實現
            "max_concurrent": self.settings.max_concurrent_per_worker,
            "stats": self.get_stats(),
        }

    async def transcribe_audio(
        self,
        audio_data: bytes,
        model_name: str,
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        temperature: float = 0.0,
        timestamp_granularities: Optional[List[TimestampGranularity]] = None,
        content_type: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> TranscriptionResponse:
        """
        轉錄音檔

        Args:
            audio_data: 音檔二進位資料
            model_name: 使用的模型名稱
            language: 音檔語言
            prompt: 引導文字
            temperature: 取樣溫度
            timestamp_granularities: 時間戳精度
            content_type: 檔案MIME類型
            filename: 檔案名稱

        Returns:
            TranscriptionResponse: 轉錄結果

        Raises:
            TranscriptionError: 轉錄失敗
            AudioProcessingError: 音檔處理失敗
        """
        start_time = time.time()

        try:
            logger.info(
                f"開始轉錄: model={model_name}, language={language}, "
                f"temp={temperature}, filename={filename}"
            )

            # 1. 預處理音檔
            audio_info = await self._process_audio(audio_data, content_type, filename)

            # 2. 驗證模型名稱
            model_load_start = time.time()
            verified_model_name = await self.model_manager.get_model(model_name)
            model_load_time = time.time() - model_load_start

            # 3. 執行轉錄
            result = await self._execute_transcription(
                audio_info.audio_array,  # <-- 我們需要 audio_array
                verified_model_name,  # <-- 傳遞模型名稱字串
                language,
                prompt,
                temperature,
                timestamp_granularities,
            )

            # 4. 建構回應
            total_processing_time = time.time() - start_time

            response = TranscriptionResponse(
                text=result["text"].strip(),
                task="transcribe",
                language=result.get("language", language or "unknown"),
                duration=audio_info.duration,
                segments=result.get("segments"),
                words=result.get("words"),
            )

            # 5. 更新統計
            self._update_stats(
                total_processing_time, audio_info.duration or 0, success=True
            )

            logger.info(
                f"轉錄完成: 處理時間={total_processing_time:.2f}s, "
                f"音檔長度={audio_info.duration:.2f}s, "
                f"速度比率={((audio_info.duration or 0) / total_processing_time):.2f}x"
            )

            return response

        except Exception as e:
            # 更新失敗統計
            self._update_stats(0, 0, success=False)

            logger.error(f"轉錄失敗: {str(e)}", exc_info=True)

            if isinstance(e, (TranscriptionError, AudioProcessingError)):
                raise
            else:
                raise TranscriptionError(f"轉錄過程發生未知錯誤: {str(e)}")

    async def _process_audio(
        self,
        audio_data: bytes,
        content_type: Optional[str] = None,
        filename: Optional[str] = None,
    ) -> AudioFileInfo:
        """
        處理音檔，載入並轉換為適合的格式

        Args:
            audio_data: 音檔二進位資料
            content_type: MIME類型
            filename: 檔案名稱

        Returns:
            AudioFileInfo: 處理後的音檔資訊

        Raises:
            AudioProcessingError: 音檔處理失敗
        """
        try:
            logger.debug(
                f"開始處理音檔: size={len(audio_data)}bytes, "
                f"type={content_type}, name={filename}"
            )

            # 在執行緒池中處理音檔（避免阻塞事件循環）
            loop = asyncio.get_event_loop()
            audio_array, sample_rate, duration = await loop.run_in_executor(
                self._audio_executor, self._load_audio_sync, audio_data
            )

            # 建立音檔資訊
            audio_info = AudioFileInfo(
                filename=filename or "unknown.audio",
                size=len(audio_data),
                content_type=content_type or "application/octet-stream",
                duration=duration,
                sample_rate=sample_rate,
                channels=1,  # librosa 已轉換為單聲道
            )

            # 將處理後的音檔陣列儲存到 audio_info（用於後續轉錄）
            audio_info.audio_array = audio_array

            logger.debug(
                f"音檔處理完成: duration={duration:.2f}s, "
                f"sample_rate={sample_rate}Hz"
            )

            return audio_info

        except Exception as e:
            logger.error(f"音檔處理失敗: {str(e)}", exc_info=True)
            raise AudioProcessingError(f"無法處理音檔: {str(e)}")

    def _load_audio_sync(self, audio_data: bytes) -> Tuple[np.ndarray, int, float]:
        """
        同步載入音檔（在執行緒池中執行）

        Args:
            audio_data: 音檔二進位資料

        Returns:
            Tuple[np.ndarray, int, float]: 音檔陣列、取樣率、時長

        Raises:
            AudioProcessingError: 載入失敗
        """
        try:
            # 使用 librosa 載入音檔
            audio_io = io.BytesIO(audio_data)

            # 載入並轉換為 Whisper 需要的格式
            audio_array, sample_rate = librosa.load(
                audio_io,
                sr=16000,  # Whisper 使用 16kHz
                mono=True,  # 轉換為單聲道
                dtype=np.float32,
            )

            # 計算時長
            duration = len(audio_array) / sample_rate

            logger.debug(
                f"音檔載入成功: shape={audio_array.shape}, "
                f"sr={sample_rate}, duration={duration:.2f}s"
            )

            return audio_array, sample_rate, duration

        except Exception as e:
            logger.error(f"音檔載入失敗: {str(e)}")
            raise AudioProcessingError(f"無法載入音檔: {str(e)}")

    def _is_audio_silent(self, audio_array: np.ndarray,
                        energy_threshold: float = 0.001,
                        silence_ratio_threshold: float = 0.9) -> bool:
        """
        檢測音頻是否為靜音或低能量

        Args:
            audio_array: 音頻陣列
            energy_threshold: 能量門檻
            silence_ratio_threshold: 靜音比例門檻

        Returns:
            bool: 是否為靜音
        """
        try:
            # 計算音頻能量（RMS）
            energy = np.sqrt(np.mean(audio_array ** 2))

            # 如果整體能量過低，直接判定為靜音
            if energy < energy_threshold:
                logger.debug(f"🔇 [靜音檢測] 整體能量過低: {energy:.6f} < {energy_threshold}")
                return True

            # 分段檢測靜音
            frame_length = int(0.1 * 16000)  # 100ms 窗口
            hop_length = frame_length // 2

            silent_frames = 0
            total_frames = 0

            for i in range(0, len(audio_array) - frame_length, hop_length):
                frame = audio_array[i:i + frame_length]
                frame_energy = np.sqrt(np.mean(frame ** 2))

                total_frames += 1
                if frame_energy < energy_threshold:
                    silent_frames += 1

            silence_ratio = silent_frames / total_frames if total_frames > 0 else 1.0

            is_silent = silence_ratio >= silence_ratio_threshold
            logger.debug(
                f"🔇 [靜音檢測] 能量: {energy:.6f}, 靜音比例: {silence_ratio:.2f}, "
                f"是否靜音: {is_silent}"
            )

            return is_silent

        except Exception as e:
            logger.warning(f"靜音檢測失敗: {str(e)}")
            return False  # 檢測失敗時預設為非靜音，避免過度過濾

    def _is_repetitive_text(self, text: str,
                          max_repetition_ratio: float = 0.6,
                          min_char_threshold: int = 3) -> bool:
        """
        檢測文本是否為重複字符模式（幻覺輸出）
        (為了保持與現有邏輯的兼容性，保留此方法)
        """
        # 導入共用工具函數
        import sys
        import os
        sys.path.append(os.path.join(os.path.dirname(__file__), '../../..'))

        try:
            from app.utils.text_quality import is_repetitive_text
            return is_repetitive_text(text, max_repetition_ratio, min_char_threshold)
        except ImportError:
            # 如果無法導入共用函數，使用本地實現作為備用
            logger.warning("無法導入共用文本品質檢查函數，使用本地實現")
            return self._is_repetitive_text_local(text, max_repetition_ratio, min_char_threshold)

    def _is_repetitive_text_local(self, text: str,
                                max_repetition_ratio: float = 0.6,
                                min_char_threshold: int = 3) -> bool:
        """本地實現的重複文本檢測（備用）"""
        try:
            if not text or len(text.strip()) < min_char_threshold:
                return True  # 空文本或過短文本視為低品質

            text = text.strip()

            # 檢測單字符重複模式
            char_counts = {}
            for char in text:
                if char.strip():  # 忽略空白字符
                    char_counts[char] = char_counts.get(char, 0) + 1

            if char_counts:
                # 計算最高頻字符的比例
                max_char_count = max(char_counts.values())
                repetition_ratio = max_char_count / len(text.replace(' ', ''))

                if repetition_ratio > max_repetition_ratio:
                    logger.debug(
                        f"🔄 [重複檢測] 高重複比例: {repetition_ratio:.2f} > {max_repetition_ratio}, "
                        f"文本: '{text[:20]}...'"
                    )
                    return True

            # 檢測常見的 Whisper 幻覺模式
            hallucination_patterns = [
                r'^([乖嗯呃啊哦]{3,})',  # 重複的中文字符
                r'^([a-zA-Z])\1{4,}',      # 重複的英文字符
                r'^(.{1,2})\1{3,}',       # 短模式重複
                r'(謝謝觀看|謝謝收聽|謝謝|感謝|Subscribe)',  # 常見的幻覺短語
            ]

            import re
            for pattern in hallucination_patterns:
                if re.search(pattern, text):
                    logger.debug(f"🔄 [模式檢測] 檢測到幻覺模式: '{text[:20]}...'")
                    return True

            return False

        except Exception as e:
            logger.warning(f"重複文本檢測失敗: {str(e)}")
            return False  # 檢測失敗時預設為非重複

    def _filter_transcription_result(self, result: Dict[str, Any], audio_array: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        過濾轉錄結果，移除低品質輸出

        Args:
            result: 轉錄結果
            audio_array: 音頻陣列

        Returns:
            過濾後的結果，如果應該被過濾則返回 None
        """
        try:
            # 1. 檢查音頻是否為靜音
            if self._is_audio_silent(audio_array):
                logger.info("🔇 [品質過濾] 音頻為靜音，過濾轉錄結果")
                return None

            # 2. 檢查文本品質
            text = result.get("text", "").strip()
            if not text:
                logger.info("🔇 [品質過濾] 轉錄結果為空，過濾")
                return None

            # 3. 檢測重複模式
            if self._is_repetitive_text(text):
                logger.info(f"🔄 [品質過濾] 檢測到重複模式，過濾: '{text[:30]}...'")
                return None

            # 4. 檢查文本長度合理性
            if len(text) > 500:  # 15秒音頻不應該產生過長文本
                logger.warning(f"🔇 [品質過濾] 文本過長，可能為幻覺: {len(text)} 字符")
                return None

            logger.debug(f"✅ [品質過濾] 轉錄結果通過品質檢查: '{text[:50]}...'")
            return result

        except Exception as e:
            logger.warning(f"品質過濾失敗: {str(e)}")
            return result  # 過濾失敗時返回原結果

    async def _execute_transcription(
        self,
        audio_array: np.ndarray,  # <--- 接收 audio_array
        model_name: str,  # <--- 接收模型名稱
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        temperature: float = 0.0,
        timestamp_granularities: Optional[List[TimestampGranularity]] = None,
    ) -> Dict[str, Any]:
        """
        執行 MLX Whisper 轉錄

        Args:
            audio_array: 預處理的音檔陣列
            model_name: 模型名稱
            language: 語言
            prompt: 引導文字
            temperature: 溫度
            timestamp_granularities: 時間戳精度

        Returns:
            Dict: 轉錄結果

        Raises:
            TranscriptionError: 轉錄失敗
        """
        try:
            # 在執行緒池中執行轉錄（MLX Whisper 是同步的）
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self._transcription_executor,
                self._transcribe_sync,
                audio_array,
                model_name,  # <-- 傳遞模型名稱
                language,
                prompt,
                temperature,
                timestamp_granularities,
            )

            return result

        except Exception as e:
            logger.error(f"MLX Whisper 轉錄失敗: {str(e)}", exc_info=True)
            raise TranscriptionError(f"轉錄執行失敗: {str(e)}")

    def _transcribe_sync(
        self,
        audio_array: np.ndarray,
        model_name: str,  # <--- 接收模型名稱
        language: Optional[str] = None,
        prompt: Optional[str] = None,
        temperature: float = 0.0,
        timestamp_granularities: Optional[List[TimestampGranularity]] = None,
    ) -> Dict[str, Any]:
        """
        同步執行 MLX Whisper 轉錄

        Args:
            audio_array: 預處理的音檔陣列
            model_name: 模型名稱
            language: 語言
            prompt: 引導文字
            temperature: 溫度
            timestamp_granularities: 時間戳精度

        Returns:
            Dict: 轉錄結果
        """
        try:
            # 準備 MLX Whisper 參數
            transcribe_options = {"verbose": False}

            # 設定語言
            if language and language != "auto":
                transcribe_options["language"] = language

            # 設定引導文字
            # 對中文添加繁體中文引導，確保輸出繁體中文而非簡體中文
            traditional_chinese_prompt = ""
            if language and language.lower() in ["zh", "chinese", "zh-tw", "zh-cn"]:
                traditional_chinese_prompt = "以下是繁體中文的句子。"

            if prompt:
                if traditional_chinese_prompt:
                    transcribe_options["initial_prompt"] = f"{traditional_chinese_prompt} {prompt}"
                else:
                    transcribe_options["initial_prompt"] = prompt
            elif traditional_chinese_prompt:
                transcribe_options["initial_prompt"] = traditional_chinese_prompt

            # 設定溫度（降低溫度減少幻覺）
            transcribe_options["temperature"] = max(0.0, min(temperature, 0.2))

            # ===============================
            # 防疊字核心參數設定
            # ===============================
            # 注意：MLX Whisper 不支援 no_repeat_ngram_size 和 repetition_penalty 參數
            # 改用其他方式來減少重複

            # 1. Beam search 設定（提升解碼品質）
            # 注意：當前版本的 MLX Whisper 不支援 beam search，暫時移除
            # transcribe_options["beam_size"] = 5  # 使用 beam search
            # transcribe_options["best_of"] = 3    # 從多個候選中選最佳

            # 2. 長度懲罰（避免過短或過長輸出）
            transcribe_options["length_penalty"] = 1.0

            # ===============================
            # 抑制幻覺 Token 設定
            # ===============================

            # 添加 suppress_tokens 來抑制常見的幻覺 token
            suppress_tokens = [
                # 常見的重複字符和無意義音素
                50257,  # <endoftext>
                50362,  # (music)
                50363,  # (applause)
                50364,  # (laughter)
                50365,  # [BLANK_AUDIO]
                # 可以根據需要添加更多 token
            ]

            # 對於中文，添加額外的抑制策略
            if language and language.lower() in ["zh", "chinese", "zh-tw", "zh-cn"]:
                # 中文常見幻覺模式的額外抑制
                # 這些 token ID 可能需要根據實際觀察到的幻覺進行調整
                chinese_hallucination_tokens = [
                    # 可以根據觀察到的特定幻覺模式添加對應的 token ID
                ]
                suppress_tokens.extend(chinese_hallucination_tokens)

                logger.debug(f"🇹🇼 為中文模式添加額外幻覺抑制 tokens: {len(chinese_hallucination_tokens)} 個")

            transcribe_options["suppress_tokens"] = suppress_tokens

            # ===============================
            # 品質控制參數
            # ===============================

            # 設定其他參數來減少幻覺
            transcribe_options["no_speech_threshold"] = 0.4     # 提高靜音檢測門檻
            transcribe_options["logprob_threshold"] = -0.8      # 提高置信度門檻
            transcribe_options["compression_ratio_threshold"] = 2.0  # 降低重複內容門檻（更嚴格）

            # 條件熵設定（MLX Whisper 支援此參數）
            transcribe_options["condition_on_previous_text"] = False  # 不依賴前文，減少累積錯誤

            # 設定時間戳
            # 根據請求的 granularities 決定是否啟用 word_timestamps
            granularities_set = set(timestamp_granularities or [])
            if TimestampGranularity.WORD in granularities_set:
                transcribe_options["word_timestamps"] = True
            elif (
                TimestampGranularity.SEGMENT in granularities_set
                or not granularities_set
            ):
                # 對於 segment 或預設情況，不啟用 word_timestamps 以提升效能
                transcribe_options["word_timestamps"] = False

            logger.debug(f"開始 MLX Whisper 轉錄: options={transcribe_options}")

            # 記錄繁體中文引導狀態
            if "initial_prompt" in transcribe_options:
                logger.info(f"使用引導文字確保繁體中文輸出: {transcribe_options['initial_prompt'][:30]}...")

            # 取得模型資訊，決定使用本地路徑還是 HuggingFace repo
            model_info = self.settings.get_model_info(model_name)
            if model_info and model_info.get("hf_repo"):
                # 使用 HuggingFace repo
                path_or_hf_repo = model_info["hf_repo"]
                logger.debug(f"使用 HuggingFace 模型: {path_or_hf_repo}")
            else:
                # 使用本地模型路徑
                path_or_hf_repo = os.path.join(
                    self.settings.model_cache_dir, model_name
                )
                logger.debug(f"使用本地模型路徑: {path_or_hf_repo}")

            # 執行轉錄
            result = mlx_whisper.transcribe(
                audio_array, path_or_hf_repo=path_or_hf_repo, **transcribe_options
            )

            # 調試：記錄原始結果結構
            logger.debug(f"MLX Whisper 原始結果類型: {type(result)}")
            logger.debug(
                f"MLX Whisper 原始結果鍵值: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}"
            )
            if isinstance(result, dict):
                logger.debug(
                    f"MLX Whisper segments 類型: {type(result.get('segments'))}"
                )
                logger.debug(f"MLX Whisper segments 內容: {result.get('segments')}")
                logger.debug(
                    f"MLX Whisper text 內容: {result.get('text', '')[:100]}..."
                )

            # 處理結果
            processed_result = self._process_transcription_result(
                result, timestamp_granularities
            )

            # 品質過濾和後處理
            filtered_result = self._filter_transcription_result(processed_result, audio_array)
            if filtered_result is None:
                # 返回空結果表示被過濾
                logger.info("🔇 [Whisper] 轉錄結果被品質過濾器過濾")
                return {
                    "text": "",
                    "language": result.get("language", "unknown"),
                    "segments": [],
                    "words": [],
                    "_filtered": True  # 標記為已過濾
                }

            # 應用後處理去重
            if filtered_result.get("text"):
                try:
                    # 導入後處理函數
                    import sys
                    import os
                    sys.path.append(os.path.join(os.path.dirname(__file__), '../../../'))
                    from app.utils.text_quality import postprocess_transcription_text

                    original_text = filtered_result["text"]
                    processed_text = postprocess_transcription_text(original_text, "MLX-Whisper")

                    if processed_text != original_text:
                        logger.info(f"🔧 [後處理] 文本去重完成: '{original_text[:30]}...' -> '{processed_text[:30]}...'")
                        filtered_result["text"] = processed_text

                        # 如果後處理後文本為空，標記為過濾
                        if not processed_text.strip():
                            logger.info("🔇 [後處理] 去重後文本為空，標記為過濾")
                            return {
                                "text": "",
                                "language": result.get("language", "unknown"),
                                "segments": [],
                                "words": [],
                                "_filtered": True,
                                "_postprocessed": True
                            }

                except ImportError as e:
                    logger.warning(f"無法導入後處理函數，跳過去重步驟: {e}")
                except Exception as e:
                    logger.error(f"後處理過程發生錯誤: {e}")
                    # 發生錯誤時使用原始結果

            logger.debug(
                f"MLX Whisper 轉錄完成，文字長度: {len(filtered_result['text'])}, segments_count: {len(filtered_result['segments'])}"
            )

            return filtered_result

        except Exception as e:
            logger.error(f"同步轉錄失敗: {str(e)}")
            raise TranscriptionError(f"MLX Whisper 轉錄失敗: {str(e)}")

    def _process_transcription_result(
        self,
        result: Dict[str, Any],
        timestamp_granularities: Optional[List[TimestampGranularity]] = None,
    ) -> Dict[str, Any]:
        """
        處理轉錄結果，格式化為統一的回應格式
        """
        try:
            processed = {
                "text": result.get("text", "").strip(),
                "language": result.get("language", "unknown"),
                "segments": [],
                "words": [],
            }

            # 確保 timestamp_granularities 是一個集合以便快速查找
            granularities_set = set(timestamp_granularities or [])

            # 處理段落資訊
            # 注意：即使只請求 word，我們也通常會回傳 segment，這符合 OpenAI 行為
            # 如果沒有指定 granularities，預設包含 segments
            should_include_segments = (
                TimestampGranularity.SEGMENT in granularities_set
                or TimestampGranularity.WORD in granularities_set
                or not granularities_set  # 如果沒有指定，預設包含
            )

            if should_include_segments and result.get("segments"):
                segments = []
                for i, segment in enumerate(result["segments"]):
                    if segment and isinstance(
                        segment, dict
                    ):  # 確保 segment 不是 None 且是字典
                        segments.append(
                            SegmentInfo(
                                id=i,
                                start=float(segment.get("start", 0)),
                                end=float(segment.get("end", 0)),
                                text=segment.get("text", "").strip(),
                            )
                        )
                processed["segments"] = segments

            # 處理單詞資訊
            if TimestampGranularity.WORD in granularities_set and result.get("words"):
                words = []
                for word_data in result.get("words", []):
                    if word_data and isinstance(
                        word_data, dict
                    ):  # 確保 word_data 不是 None 且是字典
                        words.append(
                            WordInfo(
                                word=word_data.get("word", ""),
                                start=float(word_data.get("start", 0)),
                                end=float(word_data.get("end", 0)),
                            )
                        )
                processed["words"] = words
            else:
                # 如果沒有請求 words 或沒有 words 資料，設為空陣列
                processed["words"] = []

            logger.debug(
                f"處理轉錄結果完成: text_length={len(processed['text'])}, segments_count={len(processed['segments'])}, words_count={len(processed['words'])}"
            )

            return processed

        except Exception as e:
            logger.error(f"處理轉錄結果時發生錯誤: {str(e)}", exc_info=True)
            # 返回基本的結果，確保不會因為處理錯誤而完全失敗
            return {
                "text": result.get("text", "").strip(),
                "language": result.get("language", "unknown"),
                "segments": [],
                "words": [],
            }

    def _update_stats(
        self, processing_time: float, audio_duration: float, success: bool = True
    ) -> None:
        """更新統計資訊"""
        if success:
            self._stats["total_transcriptions"] += 1
            self._stats["total_processing_time"] += processing_time
            self._stats["total_audio_duration"] += audio_duration
        else:
            self._stats["failed_transcriptions"] += 1

    def get_stats(self) -> Dict[str, Any]:
        """獲取服務統計資訊"""
        total_transcriptions = self._stats["total_transcriptions"]

        stats = dict(self._stats)

        if total_transcriptions > 0:
            stats["avg_processing_time"] = (
                self._stats["total_processing_time"] / total_transcriptions
            )
            stats["avg_audio_duration"] = (
                self._stats["total_audio_duration"] / total_transcriptions
            )
            stats["avg_speed_ratio"] = (
                self._stats["total_audio_duration"]
                / self._stats["total_processing_time"]
                if self._stats["total_processing_time"] > 0
                else 0
            )
            stats["success_rate"] = total_transcriptions / (
                total_transcriptions + self._stats["failed_transcriptions"]
            )
        else:
            stats.update(
                {
                    "avg_processing_time": 0,
                    "avg_audio_duration": 0,
                    "avg_speed_ratio": 0,
                    "success_rate": 1.0,
                }
            )

        return stats

    async def shutdown(self) -> None:
        """關閉轉錄服務，清理資源"""
        logger.info("正在關閉轉錄服務...")

        # 關閉執行緒池
        self._audio_executor.shutdown(wait=True)
        self._transcription_executor.shutdown(wait=True)

        logger.info("轉錄服務已關閉")


# 全域轉錄服務實例
_transcription_service_instance: Optional[TranscriptionService] = None


def get_transcription_service() -> TranscriptionService:
    """
    獲取全域轉錄服務實例（單例模式）

    Returns:
        TranscriptionService: 轉錄服務實例
    """
    global _transcription_service_instance

    if _transcription_service_instance is None:
        _transcription_service_instance = TranscriptionService()

    return _transcription_service_instance


# 全域實例
transcription_service = get_transcription_service()


# 便利函數


async def transcribe_audio_file(
    audio_data: bytes, model_name: str, **kwargs
) -> TranscriptionResponse:
    """便利函數：轉錄音檔"""
    return await transcription_service.transcribe_audio(
        audio_data, model_name, **kwargs
    )


def get_transcription_stats() -> Dict[str, Any]:
    """便利函數：獲取轉錄統計"""
    return transcription_service.get_stats()
