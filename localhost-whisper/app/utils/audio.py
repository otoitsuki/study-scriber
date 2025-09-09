"""
MLX Whisper API 音檔處理工具

提供音檔格式驗證、轉換、品質檢查等工具函數，
支援多種音檔格式和轉換需求。
"""

import io
import logging
import mimetypes
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union, Any

import librosa
import numpy as np
import soundfile as sf
from pydantic import BaseModel

from app.config import get_settings


logger = logging.getLogger(__name__)


class AudioInfo(BaseModel):
    """音檔資訊模型"""

    duration: float  # 音檔長度（秒）
    sample_rate: int  # 取樣率
    channels: int  # 聲道數
    format: str  # 檔案格式
    bitrate: Optional[int] = None  # 位元率
    size: int  # 檔案大小（bytes）
    is_valid: bool = True  # 是否為有效音檔
    quality_score: Optional[float] = None  # 品質評分（0-1）


class AudioValidationError(Exception):
    """音檔驗證錯誤"""

    pass


class AudioProcessingError(Exception):
    """音檔處理錯誤"""

    pass


class AudioValidator:
    """音檔驗證器"""

    def __init__(self):
        """初始化驗證器"""
        self.settings = get_settings()

        # 支援的音檔格式
        self.supported_formats = {
            "flac": ["audio/flac", "audio/x-flac"],
            "mp3": ["audio/mp3", "audio/mpeg"],
            "mp4": ["audio/mp4", "audio/x-m4a", "video/mp4"],
            "m4a": ["audio/x-m4a", "audio/m4a"],
            "ogg": ["audio/ogg", "audio/x-ogg"],
            "wav": ["audio/wav", "audio/x-wav", "audio/wave"],
            "webm": ["audio/webm", "video/webm"],
            "aac": ["audio/aac", "audio/x-aac"],
            "wma": ["audio/x-ms-wma"],
        }

        # 支援的副檔名
        self.supported_extensions = {
            ".flac",
            ".mp3",
            ".mp4",
            ".m4a",
            ".ogg",
            ".wav",
            ".webm",
            ".aac",
            ".wma",
            ".mpeg",
            ".mpga",
        }

        # 最小和最大參數
        self.min_duration = 0.1  # 最短 0.1 秒
        self.max_duration = 3600  # 最長 1 小時
        self.min_sample_rate = 8000  # 最低取樣率
        self.max_sample_rate = 192000  # 最高取樣率

    def validate_file_format(
        self,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
        file_data: Optional[bytes] = None,
    ) -> bool:
        """
        驗證檔案格式

        Args:
            filename: 檔案名稱
            content_type: MIME 類型
            file_data: 檔案資料（用於內容檢測）

        Returns:
            bool: 是否為支援的格式
        """
        try:
            # 檢查 MIME 類型
            if content_type:
                for format_name, mime_types in self.supported_formats.items():
                    if content_type.lower() in [mt.lower() for mt in mime_types]:
                        return True

            # 檢查副檔名
            if filename:
                file_path = Path(filename)
                if file_path.suffix.lower() in self.supported_extensions:
                    return True

                # 嘗試從檔名推測 MIME 類型
                guessed_type, _ = mimetypes.guess_type(filename)
                if guessed_type:
                    for format_name, mime_types in self.supported_formats.items():
                        if guessed_type.lower() in [mt.lower() for mt in mime_types]:
                            return True

            # 如果有檔案資料，嘗試內容檢測
            if file_data:
                return self._detect_audio_format_from_content(file_data)

            return False

        except Exception as e:
            logger.warning(f"格式驗證失敗: {str(e)}")
            return False

    def _detect_audio_format_from_content(self, file_data: bytes) -> bool:
        """
        從檔案內容檢測音檔格式

        Args:
            file_data: 檔案二進位資料

        Returns:
            bool: 是否為音檔
        """
        try:
            # 檢查常見的音檔檔頭標識
            if len(file_data) < 12:
                return False

            # MP3 檔頭
            if file_data[:3] == b"ID3" or file_data[:2] == b"\xff\xfb":
                return True

            # WAV 檔頭
            if file_data[:4] == b"RIFF" and file_data[8:12] == b"WAVE":
                return True

            # FLAC 檔頭
            if file_data[:4] == b"fLaC":
                return True

            # OGG 檔頭
            if file_data[:4] == b"OggS":
                return True

            # M4A/MP4 檔頭
            if file_data[4:8] == b"ftyp":
                return True

            # 嘗試使用 librosa 載入（最後手段）
            try:
                audio_io = io.BytesIO(file_data)
                y, sr = librosa.load(audio_io, sr=None, duration=0.1)
                return len(y) > 0 and sr > 0
            except:
                return False

        except Exception:
            return False

    def validate_audio_content(self, file_data: bytes) -> AudioInfo:
        """
        驗證音檔內容並提取資訊

        Args:
            file_data: 音檔二進位資料

        Returns:
            AudioInfo: 音檔資訊

        Raises:
            AudioValidationError: 驗證失敗
        """
        try:
            # 載入音檔
            audio_io = io.BytesIO(file_data)
            y, sr = librosa.load(audio_io, sr=None, mono=False)

            # 處理單聲道/立體聲
            if y.ndim == 1:
                channels = 1
                duration = len(y) / sr
            else:
                channels = y.shape[0]
                duration = y.shape[1] / sr

            # 基本驗證
            if duration < self.min_duration:
                raise AudioValidationError(
                    f"音檔太短: {duration:.2f}s (最小 {self.min_duration}s)"
                )

            if duration > self.max_duration:
                raise AudioValidationError(
                    f"音檔太長: {duration:.2f}s (最大 {self.max_duration}s)"
                )

            if sr < self.min_sample_rate:
                raise AudioValidationError(
                    f"取樣率太低: {sr}Hz (最小 {self.min_sample_rate}Hz)"
                )

            if sr > self.max_sample_rate:
                raise AudioValidationError(
                    f"取樣率太高: {sr}Hz (最大 {self.max_sample_rate}Hz)"
                )

            # 檢查是否為靜音檔案
            if self._is_silent(y):
                raise AudioValidationError("檔案似乎是靜音的")

            # 計算品質評分
            quality_score = self._calculate_quality_score(y, sr)

            # 估計位元率（近似值）
            estimated_bitrate = (
                int((len(file_data) * 8) / duration) if duration > 0 else None
            )

            return AudioInfo(
                duration=duration,
                sample_rate=sr,
                channels=channels,
                format="unknown",  # 由調用者設定
                bitrate=estimated_bitrate,
                size=len(file_data),
                is_valid=True,
                quality_score=quality_score,
            )

        except Exception as e:
            if isinstance(e, AudioValidationError):
                raise
            else:
                raise AudioValidationError(f"音檔內容驗證失敗: {str(e)}")

    def _is_silent(self, audio_data: np.ndarray, threshold: float = 0.001) -> bool:
        """
        檢查音檔是否為靜音

        Args:
            audio_data: 音檔資料
            threshold: 靜音閾值

        Returns:
            bool: 是否為靜音
        """
        try:
            # 計算 RMS（均方根）能量
            if audio_data.ndim == 1:
                rms = np.sqrt(np.mean(audio_data**2))
            else:
                rms = np.sqrt(np.mean(audio_data**2, axis=1)).mean()

            return rms < threshold
        except:
            return False

    def _calculate_quality_score(self, audio_data: np.ndarray, sr: int) -> float:
        """
        計算音檔品質評分

        Args:
            audio_data: 音檔資料
            sr: 取樣率

        Returns:
            float: 品質評分 (0-1)
        """
        try:
            score = 0.0

            # 取樣率評分 (0.3 權重)
            if sr >= 44100:
                score += 0.3
            elif sr >= 22050:
                score += 0.2
            elif sr >= 16000:
                score += 0.15
            else:
                score += 0.1

            # 動態範圍評分 (0.3 權重)
            if audio_data.ndim == 1:
                dynamic_range = np.max(audio_data) - np.min(audio_data)
            else:
                dynamic_range = np.mean([np.max(ch) - np.min(ch) for ch in audio_data])

            if dynamic_range > 0.8:
                score += 0.3
            elif dynamic_range > 0.5:
                score += 0.2
            elif dynamic_range > 0.2:
                score += 0.1
            else:
                score += 0.05

            # 頻率範圍評分 (0.2 權重)
            try:
                # 計算頻譜
                if audio_data.ndim > 1:
                    audio_mono = np.mean(audio_data, axis=0)
                else:
                    audio_mono = audio_data

                fft = np.fft.fft(audio_mono[: min(len(audio_mono), sr)])  # 只分析前1秒
                freqs = np.fft.fftfreq(len(fft), 1 / sr)
                magnitude = np.abs(fft)

                # 檢查高頻內容
                high_freq_energy = np.sum(magnitude[freqs > 4000]) / np.sum(magnitude)
                if high_freq_energy > 0.1:
                    score += 0.2
                elif high_freq_energy > 0.05:
                    score += 0.1
                else:
                    score += 0.05
            except:
                score += 0.1  # 預設分數

            # 雜訊評分 (0.2 權重)
            try:
                # 簡單的雜訊檢測
                if audio_data.ndim == 1:
                    noise_estimate = np.std(audio_data - np.mean(audio_data))
                else:
                    noise_estimate = np.mean(
                        [np.std(ch - np.mean(ch)) for ch in audio_data]
                    )

                if noise_estimate < 0.05:  # 低雜訊
                    score += 0.2
                elif noise_estimate < 0.1:
                    score += 0.15
                elif noise_estimate < 0.2:
                    score += 0.1
                else:
                    score += 0.05
            except:
                score += 0.1

            return min(1.0, score)

        except Exception:
            return 0.5  # 預設評分


class AudioProcessor:
    """音檔處理器"""

    def __init__(self):
        """初始化處理器"""
        self.settings = get_settings()
        self.validator = AudioValidator()

    def convert_to_whisper_format(
        self, audio_data: bytes, target_sr: int = 16000
    ) -> Tuple[np.ndarray, int]:
        """
        轉換音檔為 Whisper 所需格式

        Args:
            audio_data: 原始音檔資料
            target_sr: 目標取樣率

        Returns:
            Tuple[np.ndarray, int]: 處理後的音檔陣列和取樣率

        Raises:
            AudioProcessingError: 處理失敗
        """
        try:
            # 載入音檔
            audio_io = io.BytesIO(audio_data)
            y, sr = librosa.load(
                audio_io,
                sr=target_sr,  # 重新取樣到目標取樣率
                mono=True,  # 轉換為單聲道
                dtype=np.float32,
            )

            # 正規化音量
            y = self._normalize_audio(y)

            # 移除靜音段落（可選）
            y = self._trim_silence(y, sr)

            logger.debug(f"音檔轉換完成: shape={y.shape}, sr={sr}")

            return y, sr

        except Exception as e:
            raise AudioProcessingError(f"音檔轉換失敗: {str(e)}")

    def _normalize_audio(self, audio: np.ndarray) -> np.ndarray:
        """
        正規化音檔音量

        Args:
            audio: 音檔陣列

        Returns:
            np.ndarray: 正規化後的音檔
        """
        try:
            # 避免除零錯誤
            max_val = np.max(np.abs(audio))
            if max_val > 0:
                return audio / max_val * 0.95  # 留一點裕度避免削波
            return audio
        except:
            return audio

    def _trim_silence(self, audio: np.ndarray, sr: int, top_db: int = 20) -> np.ndarray:
        """
        移除音檔開頭和結尾的靜音

        Args:
            audio: 音檔陣列
            sr: 取樣率
            top_db: 靜音閾值（dB）

        Returns:
            np.ndarray: 去除靜音後的音檔
        """
        try:
            trimmed, _ = librosa.effects.trim(audio, top_db=top_db)

            # 確保至少保留一些內容
            if len(trimmed) < sr * 0.1:  # 少於 0.1 秒
                return audio  # 返回原始音檔

            return trimmed
        except:
            return audio

    def resample_audio(
        self, audio: np.ndarray, orig_sr: int, target_sr: int
    ) -> np.ndarray:
        """
        重新取樣音檔

        Args:
            audio: 音檔陣列
            orig_sr: 原始取樣率
            target_sr: 目標取樣率

        Returns:
            np.ndarray: 重新取樣後的音檔
        """
        try:
            if orig_sr == target_sr:
                return audio

            return librosa.resample(audio, orig_sr=orig_sr, target_sr=target_sr)
        except Exception as e:
            raise AudioProcessingError(f"音檔重新取樣失敗: {str(e)}")

    def convert_to_mono(self, audio: np.ndarray) -> np.ndarray:
        """
        轉換為單聲道

        Args:
            audio: 音檔陣列

        Returns:
            np.ndarray: 單聲道音檔
        """
        try:
            if audio.ndim == 1:
                return audio
            elif audio.ndim == 2:
                return np.mean(audio, axis=0)
            else:
                raise AudioProcessingError(f"不支援的音檔維度: {audio.ndim}")
        except Exception as e:
            raise AudioProcessingError(f"單聲道轉換失敗: {str(e)}")

    def save_audio(
        self, audio: np.ndarray, sr: int, output_path: str, format: str = "wav"
    ) -> None:
        """
        儲存音檔

        Args:
            audio: 音檔陣列
            sr: 取樣率
            output_path: 輸出路徑
            format: 輸出格式
        """
        try:
            sf.write(output_path, audio, sr, format=format)
            logger.debug(f"音檔已儲存: {output_path}")
        except Exception as e:
            raise AudioProcessingError(f"音檔儲存失敗: {str(e)}")


# 全域實例
audio_validator = AudioValidator()
audio_processor = AudioProcessor()


# 便利函數


def validate_audio_file(
    file_data: bytes, filename: Optional[str] = None, content_type: Optional[str] = None
) -> AudioInfo:
    """
    驗證音檔檔案

    Args:
        file_data: 檔案資料
        filename: 檔案名稱
        content_type: MIME 類型

    Returns:
        AudioInfo: 音檔資訊
    """
    # 先驗證格式
    if not audio_validator.validate_file_format(filename, content_type, file_data):
        raise AudioValidationError("不支援的音檔格式")

    # 驗證內容
    audio_info = audio_validator.validate_audio_content(file_data)

    # 設定格式資訊
    if filename:
        audio_info.format = Path(filename).suffix.lower().lstrip(".")
    elif content_type:
        for format_name, mime_types in audio_validator.supported_formats.items():
            if content_type.lower() in [mt.lower() for mt in mime_types]:
                audio_info.format = format_name
                break

    return audio_info


def convert_audio_for_whisper(audio_data: bytes) -> Tuple[np.ndarray, int]:
    """
    轉換音檔為 Whisper 格式

    Args:
        audio_data: 原始音檔資料

    Returns:
        Tuple[np.ndarray, int]: 處理後的音檔和取樣率
    """
    return audio_processor.convert_to_whisper_format(audio_data)


def get_supported_formats() -> Dict[str, List[str]]:
    """取得支援的音檔格式"""
    return audio_validator.supported_formats.copy()


def get_supported_extensions() -> set:
    """取得支援的副檔名"""
    return audio_validator.supported_extensions.copy()


def is_audio_file(
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
    file_data: Optional[bytes] = None,
) -> bool:
    """
    檢查是否為音檔

    Args:
        filename: 檔案名稱
        content_type: MIME 類型
        file_data: 檔案資料

    Returns:
        bool: 是否為音檔
    """
    return audio_validator.validate_file_format(filename, content_type, file_data)
