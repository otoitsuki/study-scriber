.PHONY: dev dev-with-local clean-ports

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
	echo "🚀 啟動主後端…"; \
	uv run main.py & BACKEND_PID=$$!; \
	echo "Backend PID: $$BACKEND_PID"; \
	sleep 1; \
	\
	WHISPER_PID=""; \
	if [ "$(1)" = "true" ]; then \
		echo "🎙️  啟動 localhost-whisper 服務（端口 8001）…"; \
		(cd localhost-whisper && WHISPER_API_PORT=8001 uv run main.py) & WHISPER_PID=$$!; \
		echo "Whisper PID: $$WHISPER_PID"; \
		sleep 2; \
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
		echo "🎯 完整開發環境已啟動:"; \
		echo "   - 主後端: http://localhost:8000"; \
		echo "   - Localhost Whisper: http://localhost:8001"; \
		echo "   - 前端: http://localhost:3000"; \
		echo "💡 在前端 LLM 設定中使用:"; \
		echo "   - Base URL: http://localhost:8001/v1"; \
		echo "   - Model: breeze-asr-25"; \
		echo ""; \
		wait $$BACKEND_PID $$WHISPER_PID $$FRONTEND_PID; \
	else \
		echo "🎯 基礎開發環境已啟動 (主後端 + 前端)"; \
		echo "   - 主後端: http://localhost:8000"; \
		echo "   - 前端: http://localhost:3000"; \
		echo "💡 如需本地 STT，請使用: make dev-with-local"; \
		echo ""; \
		wait $$BACKEND_PID $$FRONTEND_PID; \
	fi; \
	echo "按 Ctrl+C (Cmd+C) 終止所有服務"
endef

# 基礎開發環境：主後端 + 前端
dev: clean-ports
	@$(call start_services,false)

# 完整開發環境：主後端 + localhost-whisper + 前端  
dev-with-local: clean-ports
	@$(call start_services,true)
