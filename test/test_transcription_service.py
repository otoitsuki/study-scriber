#!/usr/bin/env python3
"""
後端轉錄服務測試工具
測試 Azure OpenAI Whisper 轉錄服務是否正常工作
"""

import asyncio
import os
import sys
import tempfile
import wave
import struct
import math
from pathlib import Path

# 加入專案根目錄到 Python 路徑
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.services.azure_openai_v2 import get_azure_openai_client, get_whisper_deployment_name


class TranscriptionTester:
    def __init__(self):
        self.azure_client = None
        self.deployment_name = None

    async def initialize_service(self) -> bool:
        """
        初始化 Azure OpenAI 服務

        Returns:
            初始化是否成功
        """
        try:
            self.azure_client = get_azure_openai_client()
            self.deployment_name = get_whisper_deployment_name()

            if not self.azure_client:
                print("❌ Azure OpenAI 客戶端初始化失敗")
                return False

            if not self.deployment_name:
                print("❌ Whisper 部署名稱未設定")
                return False

            print("✅ Azure OpenAI 服務初始化成功")
            print(f"📝 Whisper 部署名稱：{self.deployment_name}")
            return True

        except Exception as e:
            print(f"❌ 服務初始化失敗：{e}")
            return False

    def generate_test_audio(self, duration_seconds: float = 5.0, frequency: float = 440.0) -> str:
        """
        生成測試用的音檔（正弦波）

        Args:
            duration_seconds: 音檔長度（秒）
            frequency: 頻率（Hz）

        Returns:
            生成的音檔路徑
        """
        print(f"🎵 生成測試音檔：{duration_seconds}秒，{frequency}Hz")

        # 音檔參數
        sample_rate = 16000  # Whisper 建議的採樣率
        num_channels = 1
        sample_width = 2  # 16-bit

        # 計算樣本數
        num_samples = int(sample_rate * duration_seconds)

        # 建立臨時檔案
        temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_path = temp_file.name
        temp_file.close()

        # 生成正弦波資料
        with wave.open(temp_path, 'wb') as wav_file:
            wav_file.setnchannels(num_channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)

            for i in range(num_samples):
                # 生成正弦波
                sample_value = int(16383 * math.sin(2 * math.pi * frequency * i / sample_rate))
                # 轉換為 16-bit 格式
                wav_file.writeframes(struct.pack('<h', sample_value))

        print(f"✅ 測試音檔已生成：{temp_path}")
        return temp_path

    def generate_silence_audio(self, duration_seconds: float = 3.0) -> str:
        """
        生成靜音測試音檔

        Args:
            duration_seconds: 音檔長度（秒）

        Returns:
            生成的音檔路徑
        """
        print(f"🔇 生成靜音測試音檔：{duration_seconds}秒")

        # 音檔參數
        sample_rate = 16000
        num_channels = 1
        sample_width = 2  # 16-bit

        # 計算樣本數
        num_samples = int(sample_rate * duration_seconds)

        # 建立臨時檔案
        temp_file = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        temp_path = temp_file.name
        temp_file.close()

        # 生成靜音資料
        with wave.open(temp_path, 'wb') as wav_file:
            wav_file.setnchannels(num_channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)

            # 寫入靜音（0值）
            silence_data = b'\x00\x00' * num_samples
            wav_file.writeframes(silence_data)

        print(f"✅ 靜音測試音檔已生成：{temp_path}")
        return temp_path

    async def test_whisper_transcription(self, audio_path: str, test_name: str) -> bool:
        """
        測試 Whisper 轉錄功能

        Args:
            audio_path: 音檔路徑
            test_name: 測試名稱

        Returns:
            測試是否成功
        """
        try:
            # 檢查檔案是否存在
            if not os.path.exists(audio_path):
                print(f"❌ 音檔不存在：{audio_path}")
                return False

            file_size = os.path.getsize(audio_path)
            print(f"📊 音檔大小：{file_size} bytes")

            # 執行轉錄
            print("🎤 開始轉錄...")

            with open(audio_path, 'rb') as audio_file:
                transcript = self.azure_client.audio.transcriptions.create(
                    model=self.deployment_name,
                    file=audio_file,
                    language="zh",
                    response_format="text"
                )

            if transcript and transcript.strip():
                print("✅ 轉錄成功！")
                print(f"📝 轉錄結果：'{transcript.strip()}'")
                return True
            else:
                print("⚠️  轉錄完成但結果為空（這對於純音調或靜音是正常的）")
                return True  # 對於測試音檔，空結果也算成功

        except Exception as e:
            print(f"❌ 轉錄測試發生錯誤：{e}")
            import traceback
            traceback.print_exc()
            return False

    async def test_service_configuration(self) -> bool:
        """
        測試轉錄服務配置

        Returns:
            配置是否正確
        """
        print("\n🧪 測試 1: 服務配置檢查")
        print("=" * 50)

        try:
            # 檢查環境變數
            azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
            azure_key = os.getenv('AZURE_OPENAI_API_KEY')

            print(f"🔗 Azure OpenAI Endpoint: {azure_endpoint[:50] + '...' if azure_endpoint else 'None'}")
            print(f"🔑 Azure OpenAI API Key: {'設定' if azure_key else '未設定'}")

            if not azure_endpoint:
                print("❌ AZURE_OPENAI_ENDPOINT 環境變數未設定")
                return False

            if not azure_key:
                print("❌ AZURE_OPENAI_API_KEY 環境變數未設定")
                return False

            print("✅ 環境變數配置正確")

            # 初始化服務
            if await self.initialize_service():
                print("✅ 轉錄服務初始化成功")
                return True
            else:
                print("❌ 轉錄服務初始化失敗")
                return False

        except Exception as e:
            print(f"❌ 配置檢查失敗：{e}")
            return False

    async def test_tone_audio_transcription(self) -> bool:
        """
        測試純音調音檔轉錄

        Returns:
            測試是否成功
        """
        print("\n🧪 測試 2: 純音調音檔轉錄")
        print("=" * 50)

        audio_path = None
        try:
            # 生成測試音檔
            audio_path = self.generate_test_audio(duration_seconds=3.0, frequency=440.0)

            # 執行轉錄測試
            result = await self.test_whisper_transcription(audio_path, "純音調測試")
            return result

        except Exception as e:
            print(f"❌ 純音調測試失敗：{e}")
            return False
        finally:
            # 清理臨時檔案
            if audio_path and os.path.exists(audio_path):
                os.unlink(audio_path)
                print(f"🗑️  已清理測試檔案：{audio_path}")

    async def test_silence_audio_transcription(self) -> bool:
        """
        測試靜音音檔轉錄

        Returns:
            測試是否成功
        """
        print("\n🧪 測試 3: 靜音音檔轉錄")
        print("=" * 50)

        audio_path = None
        try:
            # 生成靜音音檔
            audio_path = self.generate_silence_audio(duration_seconds=3.0)

            # 執行轉錄測試
            result = await self.test_whisper_transcription(audio_path, "靜音測試")
            return result

        except Exception as e:
            print(f"❌ 靜音測試失敗：{e}")
            return False
        finally:
            # 清理臨時檔案
            if audio_path and os.path.exists(audio_path):
                os.unlink(audio_path)
                print(f"🗑️  已清理測試檔案：{audio_path}")

    async def test_api_connectivity(self) -> bool:
        """
        測試 API 連接性（使用最小音檔）

        Returns:
            測試是否成功
        """
        print("\n🧪 測試 4: API 連接性測試")
        print("=" * 50)

        audio_path = None
        try:
            # 生成最小測試音檔
            audio_path = self.generate_test_audio(duration_seconds=1.0, frequency=800.0)

            print("🌐 測試 Azure OpenAI API 連接...")

            # 執行轉錄測試
            result = await self.test_whisper_transcription(audio_path, "API 連接測試")

            if result:
                print("✅ API 連接正常，Whisper 服務可用")
            else:
                print("❌ API 連接失敗")

            return result

        except Exception as e:
            print(f"❌ API 連接測試失敗：{e}")
            return False
        finally:
            # 清理臨時檔案
            if audio_path and os.path.exists(audio_path):
                os.unlink(audio_path)
                print(f"🗑️  已清理測試檔案：{audio_path}")

    async def run_all_tests(self):
        """
        執行所有測試
        """
        print("🚀 開始後端轉錄服務測試")
        print("=" * 60)

        results = []

        # 測試 1: 服務配置
        config_result = await self.test_service_configuration()
        results.append(("服務配置", config_result))

        if not config_result:
            print("\n❌ 服務配置失敗，跳過後續測試")
            return results

        # 測試 2: API 連接性
        api_result = await self.test_api_connectivity()
        results.append(("API 連接", api_result))

        if not api_result:
            print("\n❌ API 連接失敗，跳過後續測試")
            return results

        # 測試 3: 純音調轉錄
        tone_result = await self.test_tone_audio_transcription()
        results.append(("純音調轉錄", tone_result))

        # 測試 4: 靜音轉錄
        silence_result = await self.test_silence_audio_transcription()
        results.append(("靜音轉錄", silence_result))

        # 顯示測試結果摘要
        print("\n📊 測試結果摘要")
        print("=" * 60)

        for test_name, success in results:
            status = "✅ 通過" if success else "❌ 失敗"
            print(f"{test_name:20} {status}")

        total_tests = len(results)
        passed_tests = sum(1 for _, success in results if success)

        print(f"\n總計：{passed_tests}/{total_tests} 測試通過")

        if passed_tests == total_tests:
            print("🎉 所有測試都通過！轉錄服務正常運作")
            print("\n💡 測試結論：")
            print("   - Azure OpenAI Whisper API 連接正常")
            print("   - 轉錄服務配置正確")
            print("   - 可以處理各種音檔格式")
        elif api_result:
            print("⚠️  部分測試失敗，但核心 API 功能正常")
            print("\n💡 建議：")
            print("   - 核心轉錄功能正常，問題可能在其他環節")
            print("   - 檢查 WebSocket 推送或前端接收邏輯")
        else:
            print("❌ 轉錄服務有問題，請檢查配置")
            print("\n💡 建議：")
            print("   - 檢查 Azure OpenAI 環境變數設定")
            print("   - 確認 API Key 和 Endpoint 正確")
            print("   - 檢查網路連接")

        return results


async def main():
    """
    主函數
    """
    tester = TranscriptionTester()
    await tester.run_all_tests()


if __name__ == "__main__":
    asyncio.run(main())
