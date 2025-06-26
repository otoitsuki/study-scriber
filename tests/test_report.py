#!/usr/bin/env python3
"""
StudyScriber 測試報告生成器

為「一段一轉」架構生成詳細的測試報告
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def run_tests_with_report():
    """執行測試並生成報告"""
    print("🧪 StudyScriber「一段一轉」架構測試報告")
    print("=" * 60)
    print(f"📅 測試時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # 執行測試並收集結果
    test_results = {}

        # 1. 轉錄邏輯測試
    print("🔍 執行轉錄邏輯測試...")
    result = subprocess.run([
        "uv", "run", "pytest",
        "tests/unit/test_transcription_logic.py",
        "-v", "--tb=short"
    ], capture_output=True, text=True)

    test_results["transcription_logic"] = {
        "exit_code": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr
    }

    # 2. 整合測試（如果存在）
    integration_test_path = Path("tests/integration/test_one_chunk_one_transcription.py")
    if integration_test_path.exists():
        print("🔗 執行整合測試...")
        result = subprocess.run([
            "uv", "run", "pytest",
            str(integration_test_path),
            "-v", "--tb=short"
        ], capture_output=True, text=True)

        test_results["integration"] = {
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr
        }

    # 生成報告
    generate_report(test_results)


def generate_report(test_results):
    """生成測試報告"""
    print("\n📊 測試結果摘要")
    print("=" * 60)

    total_tests = 0
    passed_tests = 0
    failed_tests = 0

    for test_type, result in test_results.items():
        print(f"\n📋 {test_type.replace('_', ' ').title()} 測試:")

        if result["exit_code"] == 0:
            print("✅ 狀態: 通過")
            # 從輸出中解析測試數量
            stdout = result["stdout"]
            if "passed" in stdout:
                import re
                match = re.search(r'(\d+) passed', stdout)
                if match:
                    count = int(match.group(1))
                    total_tests += count
                    passed_tests += count
                    print(f"📈 通過: {count} 個測試")
        else:
            print("❌ 狀態: 失敗")
            print(f"💥 錯誤輸出:")
            print(result["stderr"][:500] + "..." if len(result["stderr"]) > 500 else result["stderr"])

            # 嘗試解析失敗的測試數量
            stdout = result["stdout"]
            stderr = result["stderr"]
            combined = stdout + stderr

            import re
            passed_match = re.search(r'(\d+) passed', combined)
            failed_match = re.search(r'(\d+) failed', combined)

            if passed_match:
                count = int(passed_match.group(1))
                total_tests += count
                passed_tests += count

            if failed_match:
                count = int(failed_match.group(1))
                total_tests += count
                failed_tests += count

    # 總結
    print(f"\n🎯 總體結果")
    print("=" * 60)
    print(f"📊 總測試數: {total_tests}")
    print(f"✅ 通過: {passed_tests}")
    print(f"❌ 失敗: {failed_tests}")

    if failed_tests == 0:
        print("🎉 所有測試通過！「一段一轉」架構運作正常")
        success_rate = 100.0
    else:
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        print(f"⚠️  成功率: {success_rate:.1f}%")

    # 架構驗證
    print(f"\n🏗️  「一段一轉」架構驗證")
    print("=" * 60)

    architecture_checks = [
        ("12秒切片處理", "test_twelve_second_chunks"),
        ("低延遲處理", "test_low_latency_processing"),
        ("並行處理", "test_concurrent_processing"),
        ("順序處理", "test_sequential_chunks"),
        ("錯誤處理", "test_error_handling_invalid_data"),
        ("重複切片處理", "test_process_audio_chunk_duplicate"),
        ("WebM 驗證", "test_validate_webm_data"),
        ("WAV 轉換", "test_convert_webm_to_wav"),
        ("轉錄功能", "test_transcribe_audio")
    ]

    for check_name, test_name in architecture_checks:
        # 檢查測試是否在輸出中
        found = False
        for result in test_results.values():
            if test_name in result["stdout"] and "PASSED" in result["stdout"]:
                found = True
                break

        status = "✅" if found else "❓"
        print(f"{status} {check_name}")

    # 性能指標
    print(f"\n⚡ 性能指標")
    print("=" * 60)
    print("📏 目標延遲: < 500ms (模擬環境)")
    print("🎯 切片間隔: 12秒")
    print("🔄 處理模式: 一段一轉")
    print("🛠️  FFmpeg 參數: -fflags +genpts")

    # 建議
    print(f"\n💡 建議")
    print("=" * 60)
    if failed_tests == 0:
        print("✨ 架構測試完整，可以進行實際部署測試")
        print("🔧 建議下一步:")
        print("   - 執行端到端測試")
        print("   - 測試真實音檔處理")
        print("   - 驗證 Azure OpenAI API 整合")
        print("   - 測試 WebSocket 連接穩定性")
    else:
        print("🔧 需要修復失敗的測試後再進行部署")

    return failed_tests == 0


def main():
    """主函數"""
    try:
        success = run_tests_with_report()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\n⏹️  測試被用戶中斷")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n💥 測試執行錯誤: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
