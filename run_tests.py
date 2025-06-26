#!/usr/bin/env python3
"""
StudyScriber 測試執行腳本

提供便捷的測試執行和報告功能
"""

import sys
import subprocess
from pathlib import Path


def run_tests(test_type="all", verbose=True, coverage=False):
    """
    執行測試

    Args:
        test_type: 測試類型 ("unit", "integration", "all")
        verbose: 是否顯示詳細輸出
        coverage: 是否生成覆蓋率報告
    """
    cmd = ["uv", "run", "pytest"]

    # 根據測試類型選擇路徑
    if test_type == "unit":
        cmd.append("tests/unit/")
    elif test_type == "integration":
        cmd.append("tests/integration/")
    elif test_type == "all":
        cmd.append("tests/")
    else:
        print(f"未知的測試類型: {test_type}")
        return False

    # 添加選項
    if verbose:
        cmd.extend(["-v", "--tb=short"])

    if coverage:
        cmd.extend(["--cov=app", "--cov-report=html", "--cov-report=term"])

    # 執行測試
    print(f"🧪 執行 {test_type} 測試...")
    print(f"📝 命令: {' '.join(cmd)}")

    result = subprocess.run(cmd, cwd=Path(__file__).parent)

    if result.returncode == 0:
        print("✅ 測試通過！")
        if coverage:
            print("📊 覆蓋率報告已生成到 htmlcov/index.html")
    else:
        print("❌ 測試失敗！")

    return result.returncode == 0


def main():
    """主函數"""
    import argparse

    parser = argparse.ArgumentParser(description="StudyScriber 測試執行器")
    parser.add_argument(
        "type",
        choices=["unit", "integration", "all"],
        default="all",
        nargs="?",
        help="測試類型"
    )
    parser.add_argument(
        "--coverage",
        action="store_true",
        help="生成覆蓋率報告"
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="靜默模式"
    )

    args = parser.parse_args()

    success = run_tests(
        test_type=args.type,
        verbose=not args.quiet,
        coverage=args.coverage
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
