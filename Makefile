# StudyScriber Makefile
# 提供便捷的開發和測試命令

.PHONY: help test test-unit test-integration test-report start-backend start-frontend clean

# 預設目標
help:
	@echo "🧪 StudyScriber 開發工具"
	@echo "========================"
	@echo ""
	@echo "測試命令:"
	@echo "  make test          - 執行所有測試"
	@echo "  make test-unit     - 執行單元測試"
	@echo "  make test-integration - 執行整合測試"
	@echo "  make test-report   - 生成詳細測試報告"
	@echo ""
	@echo "開發命令:"
	@echo "  make start-backend - 啟動後端服務"
	@echo "  make start-frontend - 啟動前端服務"
	@echo "  make clean         - 清理測試和快取檔案"

# 測試命令
test:
	@echo "🧪 執行所有測試..."
	uv run pytest tests/ -v

test-unit:
	@echo "🔬 執行單元測試..."
	uv run pytest tests/unit/ -v

test-integration:
	@echo "🔗 執行整合測試..."
	uv run pytest tests/integration/ -v

test-report:
	@echo "📊 生成測試報告..."
	uv run python tests/test_report.py

# 開發命令
start-backend:
	@echo "🚀 啟動後端服務..."
	uv run python main.py

start-frontend:
	@echo "🎨 啟動前端服務..."
	cd frontend && npm run dev

# 清理命令
clean:
	@echo "🧹 清理快取和測試檔案..."
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
	find . -name "test_results.json" -delete 2>/dev/null || true
	rm -rf htmlcov/ 2>/dev/null || true
	@echo "✅ 清理完成"

# 架構驗證
verify-architecture:
	@echo "🏗️  驗證「一段一轉」架構..."
	@echo "📋 檢查關鍵檔案..."
	@test -f "frontend/lib/audio-recorder.ts" && echo "✅ 前端錄音器" || echo "❌ 前端錄音器"
	@test -f "app/services/azure_openai_v2.py" && echo "✅ 轉錄服務 v2" || echo "❌ 轉錄服務 v2"
	@test -f "app/ws/upload_audio.py" && echo "✅ WebSocket 上傳" || echo "❌ WebSocket 上傳"
	@test -f "frontend/lib/transcript-manager.ts" && echo "✅ 轉錄管理器" || echo "❌ 轉錄管理器"
	@echo ""
	@echo "🔧 檢查配置..."
	@grep -q "chunkInterval: 12000" frontend/lib/audio-recorder.ts && echo "✅ 12秒切片間隔" || echo "❌ 12秒切片間隔"
	@grep -q "+genpts" app/services/azure_openai_v2.py && echo "✅ FFmpeg genpts 參數" || echo "❌ FFmpeg genpts 參數"
	@echo ""
	@echo "🧪 執行核心測試..."
	@uv run pytest tests/unit/test_transcription_logic.py::TestChunkProcessingFlow::test_twelve_second_chunks -v

# 開發環境檢查
check-env:
	@echo "🔍 檢查開發環境..."
	@echo "Python 版本:"
	@python --version
	@echo ""
	@echo "UV 版本:"
	@uv --version
	@echo ""
	@echo "Node.js 版本:"
	@node --version 2>/dev/null || echo "❌ Node.js 未安裝"
	@echo ""
	@echo "npm 版本:"
	@npm --version 2>/dev/null || echo "❌ npm 未安裝"
	@echo ""
	@echo "FFmpeg 版本:"
	@ffmpeg -version 2>/dev/null | head -1 || echo "❌ FFmpeg 未安裝"

# 快速開發流程
dev-setup:
	@echo "🛠️  設定開發環境..."
	@echo "📦 安裝 Python 依賴..."
	uv sync
	@echo ""
	@echo "📦 安裝前端依賴..."
	cd frontend && npm install
	@echo ""
	@echo "🧪 執行測試驗證..."
	make test-unit
	@echo ""
	@echo "✅ 開發環境設定完成！"
