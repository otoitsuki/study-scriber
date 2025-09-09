#!/usr/bin/env python3
"""
MLX Whisper API 效能測試工具

測試 API 的各項效能指標，包括：
- 請求處理時間
- 模型載入時間
- 記憶體使用情況
- 併發處理能力
- 不同模型的效能對比
"""

import argparse
import asyncio
import json
import logging
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Dict, Any, Optional

import aiohttp
import psutil
import requests
from requests_toolbelt.multipart.encoder import MultipartEncoder

# 設定日誌
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


class BenchmarkResult:
    """效能測試結果"""

    def __init__(self):
        self.test_name = ""
        self.total_requests = 0
        self.successful_requests = 0
        self.failed_requests = 0
        self.total_time = 0.0
        self.response_times = []
        self.errors = []
        self.model_name = ""
        self.file_size = 0
        self.audio_duration = 0.0

    def add_result(self, response_time: float, success: bool, error: str = None):
        """添加單次測試結果"""
        self.total_requests += 1
        self.response_times.append(response_time)

        if success:
            self.successful_requests += 1
        else:
            self.failed_requests += 1
            if error:
                self.errors.append(error)

    def get_statistics(self) -> Dict[str, Any]:
        """計算統計資料"""
        if not self.response_times:
            return {}

        return {
            "test_name": self.test_name,
            "model": self.model_name,
            "total_requests": self.total_requests,
            "successful_requests": self.successful_requests,
            "failed_requests": self.failed_requests,
            "success_rate": (self.successful_requests / self.total_requests) * 100,
            "total_time": self.total_time,
            "avg_response_time": statistics.mean(self.response_times),
            "min_response_time": min(self.response_times),
            "max_response_time": max(self.response_times),
            "median_response_time": statistics.median(self.response_times),
            "std_response_time": (
                statistics.stdev(self.response_times)
                if len(self.response_times) > 1
                else 0
            ),
            "requests_per_second": (
                self.successful_requests / self.total_time if self.total_time > 0 else 0
            ),
            "audio_duration": self.audio_duration,
            "file_size_mb": self.file_size / (1024 * 1024) if self.file_size > 0 else 0,
            "processing_speed_ratio": (
                self.audio_duration / statistics.mean(self.response_times)
                if self.response_times and self.audio_duration > 0
                else 0
            ),
            "errors": self.errors[:5],  # 只保留前5個錯誤
        }


class APIBenchmark:
    """API 效能測試器"""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    async def check_health(self) -> bool:
        """檢查 API 健康狀態"""
        try:
            response = requests.get(f"{self.base_url}/health", timeout=10)
            return response.status_code == 200
        except Exception as e:
            logger.error(f"健康檢查失敗: {str(e)}")
            return False

    def get_system_info(self) -> Dict[str, Any]:
        """取得系統資訊"""
        return {
            "cpu_count": psutil.cpu_count(),
            "memory_total": psutil.virtual_memory().total,
            "memory_available": psutil.virtual_memory().available,
            "memory_percent": psutil.virtual_memory().percent,
        }

    def create_test_audio(self, duration: int = 10) -> bytes:
        """創建測試音頻檔案（簡單的靜音 WAV）"""
        import wave
        import struct
        import io

        # 創建簡單的 WAV 檔案
        sample_rate = 16000
        num_samples = sample_rate * duration

        # 創建靜音
        audio_data = [0] * num_samples

        # 寫入 WAV 檔案
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(1)  # 單聲道
            wav_file.setsampwidth(2)  # 16 bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(struct.pack("<" + "h" * len(audio_data), *audio_data))

        buffer.seek(0)
        return buffer.read()

    def single_transcription_test(
        self,
        audio_data: bytes,
        model: str = "whisper-base",
        language: str = None,
        response_format: str = "json",
    ) -> tuple:
        """單次轉錄測試"""
        start_time = time.time()

        try:
            # 準備檔案
            files = {
                "file": ("test_audio.wav", audio_data, "audio/wav"),
                "model": (None, model),
                "response_format": (None, response_format),
            }

            if language:
                files["language"] = (None, language)

            # 發送請求
            response = self.session.post(
                f"{self.base_url}/v1/audio/transcriptions",
                files=files,
                timeout=300,  # 5分鐘超時
            )

            response_time = time.time() - start_time

            if response.status_code == 200:
                return (
                    response_time,
                    True,
                    response.json() if response_format == "json" else response.text,
                )
            else:
                return (
                    response_time,
                    False,
                    f"HTTP {response.status_code}: {response.text}",
                )

        except Exception as e:
            response_time = time.time() - start_time
            return response_time, False, str(e)

    def concurrent_test(
        self,
        audio_data: bytes,
        model: str = "whisper-base",
        num_requests: int = 10,
        max_workers: int = 4,
    ) -> BenchmarkResult:
        """併發測試"""
        logger.info(f"開始併發測試: {num_requests} 個請求，最大 {max_workers} 個併發")

        result = BenchmarkResult()
        result.test_name = "併發處理測試"
        result.model_name = model
        result.file_size = len(audio_data)

        start_time = time.time()

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []

            for i in range(num_requests):
                future = executor.submit(
                    self.single_transcription_test, audio_data, model, None, "json"
                )
                futures.append(future)

            # 收集結果
            for i, future in enumerate(futures):
                try:
                    response_time, success, response_data = future.result()
                    result.add_result(
                        response_time, success, None if success else response_data
                    )

                    if i % 5 == 0:
                        logger.info(f"完成 {i+1}/{num_requests} 個請求")

                except Exception as e:
                    result.add_result(0, False, str(e))

        result.total_time = time.time() - start_time
        return result

    def model_comparison_test(
        self, audio_data: bytes, models: List[str], num_requests: int = 3
    ) -> Dict[str, BenchmarkResult]:
        """模型效能對比測試"""
        logger.info(f"開始模型對比測試: {models}")

        results = {}

        for model in models:
            logger.info(f"測試模型: {model}")

            result = BenchmarkResult()
            result.test_name = "模型效能對比"
            result.model_name = model
            result.file_size = len(audio_data)

            start_time = time.time()

            for i in range(num_requests):
                response_time, success, response_data = self.single_transcription_test(
                    audio_data, model, None, "json"
                )
                result.add_result(
                    response_time, success, None if success else response_data
                )

                logger.info(
                    f"  {model} - 請求 {i+1}/{num_requests}: {response_time:.2f}s"
                )

            result.total_time = time.time() - start_time
            results[model] = result

        return results

    def memory_stress_test(
        self,
        large_audio_data: bytes,
        model: str = "whisper-base",
        num_requests: int = 5,
    ) -> BenchmarkResult:
        """記憶體壓力測試"""
        logger.info("開始記憶體壓力測試")

        result = BenchmarkResult()
        result.test_name = "記憶體壓力測試"
        result.model_name = model
        result.file_size = len(large_audio_data)

        # 記錄初始記憶體使用
        initial_memory = psutil.virtual_memory().percent
        logger.info(f"初始記憶體使用: {initial_memory:.1f}%")

        start_time = time.time()

        for i in range(num_requests):
            # 監控記憶體使用
            current_memory = psutil.virtual_memory().percent
            logger.info(f"  請求 {i+1} 開始 - 記憶體使用: {current_memory:.1f}%")

            response_time, success, response_data = self.single_transcription_test(
                large_audio_data, model, None, "json"
            )
            result.add_result(
                response_time, success, None if success else response_data
            )

            # 等待記憶體回收
            time.sleep(2)

        result.total_time = time.time() - start_time

        final_memory = psutil.virtual_memory().percent
        logger.info(
            f"最終記憶體使用: {final_memory:.1f}% (增加: {final_memory - initial_memory:.1f}%)"
        )

        return result


def print_results(results: Dict[str, Any]):
    """美化輸出測試結果"""
    print("\n" + "=" * 80)
    print("🎯 MLX Whisper API 效能測試報告")
    print("=" * 80)

    # 系統資訊
    if "system_info" in results:
        sys_info = results["system_info"]
        print(f"\n💻 系統資訊:")
        print(f"   CPU 核心數: {sys_info.get('cpu_count', 'N/A')}")
        print(f"   總記憶體: {sys_info.get('memory_total', 0) / (1024**3):.1f} GB")
        print(
            f"   可用記憶體: {sys_info.get('memory_available', 0) / (1024**3):.1f} GB"
        )
        print(f"   記憶體使用率: {sys_info.get('memory_percent', 0):.1f}%")

    # 測試結果
    for test_name, result in results.items():
        if test_name == "system_info":
            continue

        if isinstance(result, dict) and "test_name" in result:
            print(f"\n📊 {result['test_name']} ({result.get('model', 'N/A')})")
            print("-" * 60)
            print(f"   總請求數: {result['total_requests']}")
            print(f"   成功請求: {result['successful_requests']}")
            print(f"   失敗請求: {result['failed_requests']}")
            print(f"   成功率: {result['success_rate']:.1f}%")
            print(f"   總耗時: {result['total_time']:.2f}s")
            print(f"   平均回應時間: {result['avg_response_time']:.2f}s")
            print(f"   最小回應時間: {result['min_response_time']:.2f}s")
            print(f"   最大回應時間: {result['max_response_time']:.2f}s")
            print(f"   每秒請求數: {result['requests_per_second']:.2f}")

            if result.get("processing_speed_ratio", 0) > 0:
                print(f"   處理速度比率: {result['processing_speed_ratio']:.2f}x")

            if result.get("errors"):
                print(f"   錯誤範例: {result['errors'][0]}")

        elif isinstance(result, dict):  # 模型對比結果
            print(f"\n📊 {test_name}")
            print("-" * 60)

            for model_name, model_result in result.items():
                stats = (
                    model_result.get_statistics()
                    if hasattr(model_result, "get_statistics")
                    else model_result
                )
                print(f"   {model_name}:")
                print(f"     平均回應時間: {stats['avg_response_time']:.2f}s")
                print(f"     成功率: {stats['success_rate']:.1f}%")
                print(f"     每秒請求數: {stats['requests_per_second']:.2f}")


def main():
    """主函數"""
    parser = argparse.ArgumentParser(description="MLX Whisper API 效能測試")

    parser.add_argument(
        "--base-url", default="http://localhost:8000", help="API 基礎 URL"
    )

    parser.add_argument(
        "--test-type",
        choices=["single", "concurrent", "models", "memory", "all"],
        default="all",
        help="測試類型",
    )

    parser.add_argument("--model", default="whisper-base", help="測試模型")

    parser.add_argument("--num-requests", type=int, default=10, help="請求數量")

    parser.add_argument("--max-workers", type=int, default=4, help="最大併發數")

    parser.add_argument(
        "--audio-duration", type=int, default=10, help="測試音頻長度（秒）"
    )

    parser.add_argument("--output", type=Path, help="結果輸出檔案 (JSON 格式)")

    args = parser.parse_args()

    # 初始化測試器
    benchmark = APIBenchmark(args.base_url)

    # 檢查 API 健康狀態
    logger.info("檢查 API 健康狀態...")
    if not asyncio.run(benchmark.check_health()):
        logger.error("❌ API 服務不可用，請先啟動服務")
        sys.exit(1)

    logger.info("✅ API 服務正常")

    # 準備測試音頻
    logger.info(f"準備測試音頻 ({args.audio_duration}秒)...")
    audio_data = benchmark.create_test_audio(args.audio_duration)
    large_audio_data = benchmark.create_test_audio(60)  # 1分鐘音頻用於壓力測試

    # 收集結果
    all_results = {"system_info": benchmark.get_system_info(), "timestamp": time.time()}

    # 執行測試
    if args.test_type in ["single", "all"]:
        logger.info("執行單次請求測試...")
        response_time, success, _ = benchmark.single_transcription_test(
            audio_data, args.model
        )

        result = BenchmarkResult()
        result.test_name = "單次請求測試"
        result.model_name = args.model
        result.add_result(response_time, success)
        result.total_time = response_time

        all_results["single_request"] = result.get_statistics()

    if args.test_type in ["concurrent", "all"]:
        logger.info("執行併發測試...")
        result = benchmark.concurrent_test(
            audio_data, args.model, args.num_requests, args.max_workers
        )
        all_results["concurrent"] = result.get_statistics()

    if args.test_type in ["models", "all"]:
        logger.info("執行模型對比測試...")
        models = ["whisper-tiny", "whisper-base", "whisper-small"]
        results = benchmark.model_comparison_test(audio_data, models, 3)
        all_results["model_comparison"] = {
            model: result.get_statistics() for model, result in results.items()
        }

    if args.test_type in ["memory", "all"]:
        logger.info("執行記憶體壓力測試...")
        result = benchmark.memory_stress_test(large_audio_data, args.model, 3)
        all_results["memory_stress"] = result.get_statistics()

    # 輸出結果
    print_results(all_results)

    # 儲存結果檔案
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(all_results, f, indent=2, ensure_ascii=False)
        logger.info(f"📄 結果已儲存至: {args.output}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("🛑 測試被用戶中斷")
        sys.exit(130)
    except Exception as e:
        logger.error(f"❌ 測試過程中發生錯誤: {str(e)}", exc_info=True)
        sys.exit(1)
