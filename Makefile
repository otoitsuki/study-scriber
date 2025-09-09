.PHONY: dev dev-with-local clean-ports setup check-env check-system

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

# 檢查環境狀態
check-env:
	@echo "🔍 檢查開發環境狀態..."
	@echo "📍 主專案虛擬環境:"
	@if [ -d ".venv" ]; then echo "  ✅ 虛擬環境存在"; else echo "  ❌ 虛擬環境不存在，請運行 make setup"; fi
	@echo "📍 Localhost-whisper 虛擬環境:"
	@if [ -d "localhost-whisper/.venv" ]; then echo "  ✅ 虛擬環境存在"; else echo "  ❌ 虛擬環境不存在，請運行 make setup"; fi
	@echo "📍 前端依賴:"
	@if [ -d "frontend/node_modules" ]; then echo "  ✅ Node modules 存在"; else echo "  ❌ Node modules 不存在，請運行 make setup"; fi

# 清理可能占用的端口
clean-ports:
	@echo "🧹 清理可能占用的端口..."
	@lsof -ti:8000 | xargs kill -9 2>/dev/null || echo "端口 8000 未被占用"
	@lsof -ti:8001 | xargs kill -9 2>/dev/null || echo "端口 8001 未被占用"  
	@lsof -ti:3000 | xargs kill -9 2>/dev/null || echo "端口 3000 未被占用"
	@echo "✅ 端口清理完成"

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
		(cd localhost-whisper && WHISPER_API_PORT=8001 uv run main.py) & WHISPER_PID=$$!; \
		echo "Whisper PID: $$WHISPER_PID"; \
		sleep 3; \
	fi; \
	\
	echo "✨ 後端服務已啟動，啟動前端…"; \
	(cd frontend && pnpm dev) & FRONTEND_PID=$$!; \
	echo "Frontend PID: $$FRONTEND_PID"; \
	\
	cleanup() { \
		echo ""; \
		echo "🛑 收到終止信號，正在關閉服務..."; \
		echo "終止主後端進程 (PID: $$BACKEND_PID)..."; \
		kill -TERM $$BACKEND_PID 2>/dev/null || kill -9 $$BACKEND_PID 2>/dev/null || true; \
		if [ -n "$$WHISPER_PID" ]; then \
			echo "終止 Whisper 服務進程 (PID: $$WHISPER_PID)..."; \
			kill -TERM $$WHISPER_PID 2>/dev/null || kill -9 $$WHISPER_PID 2>/dev/null || true; \
		fi; \
		echo "終止前端進程 (PID: $$FRONTEND_PID)..."; \
		kill -TERM $$FRONTEND_PID 2>/dev/null || kill -9 $$FRONTEND_PID 2>/dev/null || true; \
		lsof -ti:8000 | xargs kill -9 2>/dev/null || true; \
		lsof -ti:8001 | xargs kill -9 2>/dev/null || true; \
		lsof -ti:3000 | xargs kill -9 2>/dev/null || true; \
		echo "✅ 所有服務已關閉"; \
		exit 0; \
	}; \
	\
	trap cleanup SIGINT SIGTERM EXIT; \
	\
	if [ "$(1)" = "true" ]; then \
		echo "🎯 完整開發環境已啟動 (所有服務使用 uv 虛擬環境):"; \
		echo "   - 主後端: http://localhost:8000 (uv run main.py)"; \
		echo "   - Localhost Whisper: http://localhost:8001 (uv run main.py)"; \
		echo "   - 前端: http://localhost:3000 (pnpm dev)"; \
		echo "💡 在前端 LLM 設定中使用:"; \
		echo "   - Base URL: http://localhost:8001/v1"; \
		echo "   - Model: breeze-asr-25"; \
		echo ""; \
		wait $$BACKEND_PID $$WHISPER_PID $$FRONTEND_PID; \
	else \
		echo "🎯 基礎開發環境已啟動 (主後端 + 前端):"; \
		echo "   - 主後端: http://localhost:8000 (uv run main.py)"; \
		echo "   - 前端: http://localhost:3000 (pnpm dev)"; \
		echo "💡 如需本地 STT，請使用: make dev-with-local"; \
		echo ""; \
		wait $$BACKEND_PID $$FRONTEND_PID; \
	fi; \
	echo "按 Ctrl+C (Cmd+C) 終止所有服務"
endef

# 基礎開發環境：主後端 + 前端 (自動檢查環境)
dev: clean-ports
	@$(call start_services,false)

# 完整開發環境：主後端 + localhost-whisper + 前端 (自動檢查環境)
dev-with-local: clean-ports
	@$(call start_services,true)
