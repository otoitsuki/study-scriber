.PHONY: dev dev-with-local clean-ports cleanup setup check-env check-system download-models check-models help

# 預設目標：顯示幫助
help:
	@echo "📚 StudyScriber 開發環境管理"
	@echo "================================"
	@echo ""
	@echo "🔧 環境設置:"
	@echo "  make setup          - 設置開發環境 (安裝依賴)"
	@echo "  make check-env      - 檢查環境狀態"
	@echo "  make check-system   - 檢查系統必要工具"
	@echo ""
	@echo "🤖 模型管理:"
	@echo "  make check-models   - 檢查 localhost-whisper 模型"
	@echo "  make download-models - 下載必要模型 (breeze-asr-25)"
	@echo ""
	@echo "🚀 開發服務:"
	@echo "  make dev            - 啟動基礎開發環境 (主後端 + 前端)"
	@echo "  make dev-with-local - 啟動完整開發環境 (+ localhost-whisper)"
	@echo ""
	@echo "🧹 工具:"
	@echo "  make clean-ports    - 清理可能占用的端口"
	@echo "  make cleanup        - 強制清理所有相關進程"
	@echo "  make help           - 顯示此幫助訊息"
	@echo ""
	@echo "💡 建議工作流程:"
	@echo "  1. make setup"
	@echo "  2. make download-models  (如需本地 STT)"
	@echo "  3. make dev-with-local   (或 make dev)"

# 將 help 設為預設目標
.DEFAULT_GOAL := help

# 檢查系統必要工具
check-system:
	@echo "🔍 檢查系統必要工具..."
	@command -v uv >/dev/null 2>&1 || (echo "❌ uv 未安裝，請參考: https://docs.astral.sh/uv/getting-started/installation/" && exit 1)
	@command -v node >/dev/null 2>&1 || (echo "❌ Node.js 未安裝，請參考: https://nodejs.org/" && exit 1)
	@command -v pnpm >/dev/null 2>&1 || (echo "❌ pnpm 未安裝，請執行: npm install -g pnpm" && exit 1)
	@command -v python3 >/dev/null 2>&1 || (echo "❌ Python 3 未安裝，請參考: https://www.python.org/" && exit 1)
	@echo "✅ 系統工具檢查完成"

# 設定虛擬環境和依賴
setup: check-system
	@echo "🔧 設置開發環境..."
	@echo "📦 同步主專案依賴..."
	uv sync
	@echo "📦 同步 localhost-whisper 依賴..."
	cd localhost-whisper && uv sync
	@echo "📦 安裝前端依賴..."
	cd frontend && pnpm install
	@echo "✅ 開發環境設置完成"

# 檢查模型是否存在
check-models:
	@echo "🔍 檢查 localhost-whisper 模型..."
	@if [ ! -d "localhost-whisper/models/breeze-asr-25" ]; then \
		echo "❌ breeze-asr-25 模型不存在，請運行 make download-models"; \
		exit 1; \
	else \
		echo "✅ breeze-asr-25 模型已存在"; \
	fi

# 下載必要的模型
download-models:
	@echo "📥 下載 localhost-whisper 模型..."
	@echo "🎯 下載 breeze-asr-25 模型 (約 2.9GB)..."
	cd localhost-whisper && python scripts/download_models.py download breeze-asr-25 --force
	@echo "✅ 模型下載完成"

# 檢查環境狀態
check-env:
	@echo "🔍 檢查開發環境狀態..."
	@echo "📍 主專案虛擬環境:"
	@if [ -d ".venv" ]; then echo "  ✅ 虛擬環境存在"; else echo "  ❌ 虛擬環境不存在，請運行 make setup"; fi
	@echo "📍 Localhost-whisper 虛擬環境:"
	@if [ -d "localhost-whisper/.venv" ]; then echo "  ✅ 虛擬環境存在"; else echo "  ❌ 虛擬環境不存在，請運行 make setup"; fi
	@echo "📍 前端依賴:"
	@if [ -d "frontend/node_modules" ]; then echo "  ✅ Node modules 存在"; else echo "  ❌ Node modules 不存在，請運行 make setup"; fi
	@echo "📍 Localhost-whisper 模型:"
	@if [ -d "localhost-whisper/models/breeze-asr-25" ]; then echo "  ✅ breeze-asr-25 模型存在"; else echo "  ❌ breeze-asr-25 模型不存在，請運行 make download-models"; fi

# 清理可能占用的端口
clean-ports:
	@echo "🧹 清理可能占用的端口..."
	@lsof -ti:8000 | xargs kill -9 2>/dev/null || echo "端口 8000 未被占用"
	@lsof -ti:8001 | xargs kill -9 2>/dev/null || echo "端口 8001 未被占用"
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "端口 3000 未被占用"
	@echo "✅ 端口清理完成"

# 強制清理所有相關進程
cleanup:
	@echo "🧹 執行強制清理..."
	@chmod +x scripts/cleanup.sh
	@./scripts/cleanup.sh

# 共用的服務啟動邏輯
# 參數: $(1) = enable_local_whisper (true/false)
define start_services
	set -e; \
	echo "🔍 檢查開發環境..."; \
	if [ ! -d ".venv" ]; then \
		echo "❌ 主專案虛擬環境不存在，請先運行 make setup"; \
		exit 1; \
	fi; \
	if [ "$(1)" = "true" ] && [ ! -d "localhost-whisper/.venv" ]; then \
		echo "❌ Localhost-whisper 虛擬環境不存在，請先運行 make setup"; \
		exit 1; \
	fi; \
	if [ ! -d "frontend/node_modules" ]; then \
		echo "❌ 前端依賴不存在，請先運行 make setup"; \
		exit 1; \
	fi; \
	echo "✅ 環境檢查通過"; \
	echo ""; \
	echo "🚀 啟動主後端 (uv run)..."; \
	uv run main.py & BACKEND_PID=$$!; \
	echo "Backend PID: $$BACKEND_PID"; \
	sleep 2; \
	\
	WHISPER_PID=""; \
	if [ "$(1)" = "true" ]; then \
		echo "🎙️  啟動 localhost-whisper 服務（端口 8001，uv run）..."; \
		bash -c 'cd localhost-whisper && WHISPER_API_PORT=8001 uv run main.py' & WHISPER_PID=$$!; \
		echo "Whisper PID: $$WHISPER_PID"; \
		sleep 3; \
	fi; \
	\
	echo "✨ 後端服務已啟動，啟動前端…"; \
	bash -c 'cd frontend && pnpm dev' & FRONTEND_PID=$$!; \
	echo "Frontend PID: $$FRONTEND_PID"; \
	\
	cleanup() { \
		echo ""; \
		echo "🛑 收到終止信號，正在關閉服務..."; \
		\
		echo "🔍 終止主後端進程 (PID: $$BACKEND_PID)..."; \
		kill -TERM $$BACKEND_PID 2>/dev/null || kill -9 $$BACKEND_PID 2>/dev/null || true; \
		sleep 1; \
		\
		if [ -n "$$WHISPER_PID" ]; then \
			echo "🔍 終止 Whisper 服務進程 (PID: $$WHISPER_PID)..."; \
			kill -TERM $$WHISPER_PID 2>/dev/null || kill -9 $$WHISPER_PID 2>/dev/null || true; \
			echo "🧹 清理所有 MLX Whisper 相關進程..."; \
			pkill -f "mlx_whisper" 2>/dev/null || true; \
			pkill -f "localhost-whisper" 2>/dev/null || true; \
			pkill -f "multiprocessing.spawn" 2>/dev/null || true; \
			sleep 2; \
		fi; \
		\
		echo "🔍 終止前端進程 (PID: $$FRONTEND_PID)..."; \
		kill -TERM $$FRONTEND_PID 2>/dev/null || kill -9 $$FRONTEND_PID 2>/dev/null || true; \
		sleep 1; \
		\
		echo "🧹 強制清理端口占用..."; \
		lsof -ti:8000 | xargs kill -9 2>/dev/null || true; \
		lsof -ti:8001 | xargs kill -9 2>/dev/null || true; \
		lsof -ti:3000 | xargs kill -9 2>/dev/null || true; \
		\
		echo "🧹 清理殘留的 Python 進程..."; \
		ps aux | grep -E "(main\.py|uvicorn)" | grep -v grep | awk '{print $$2}' | xargs kill -9 2>/dev/null || true; \
		\
		echo "✅ 所有服務已關閉"; \
		exit 0; \
	}; \
	\
	trap cleanup SIGINT SIGTERM EXIT; \
	\
	if [ "$(1)" = "true" ]; then \
		echo "🎯 完整開發環境已啟動:"; \
		echo "   - 主後端: http://localhost:8000"; \
		echo "   - Localhost Whisper: http://localhost:8001"; \
		echo "   - 前端: http://localhost:3000"; \
		echo "💡 在前端 LLM 設定中使用:"; \
		echo "   - Base URL: http://localhost:8001/v1"; \
		echo "   - Model: breeze-asr-25"; \
		echo ""; \
		echo "按 Ctrl+C (Cmd+C) 終止所有服務"; \
		wait $$BACKEND_PID $$WHISPER_PID $$FRONTEND_PID; \
	else \
		echo "🎯 基礎開發環境已啟動:"; \
		echo "   - 主後端: http://localhost:8000"; \
		echo "   - 前端: http://localhost:3000"; \
		echo "💡 如需本地 STT，請使用: make dev-with-local"; \
		echo ""; \
		echo "按 Ctrl+C (Cmd+C) 終止所有服務"; \
		wait $$BACKEND_PID $$FRONTEND_PID; \
	fi
endef

# 基礎開發環境：主後端 + 前端 (自動檢查環境)
dev: clean-ports
	@$(call start_services,false)

# 完整開發環境：主後端 + localhost-whisper + 前端 (自動檢查環境和模型)
dev-with-local: clean-ports check-models
	@$(call start_services,true)
