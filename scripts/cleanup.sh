#!/bin/bash

echo "🧹 StudyScriber 進程清理工具"
echo "============================="

echo "🔍 搜尋相關進程..."

# 清理端口占用
echo "📍 清理端口占用..."
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "  ✅ 端口 8000 已清理" || echo "  ℹ️  端口 8000 未被占用"
lsof -ti:8001 | xargs kill -9 2>/dev/null && echo "  ✅ 端口 8001 已清理" || echo "  ℹ️  端口 8001 未被占用"  
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "  ✅ 端口 3000 已清理" || echo "  ℹ️  端口 3000 未被占用"

# 清理主後端進程
echo "📍 清理主後端進程..."
pids=$(ps aux | grep -E "uv run main\.py|python.*main\.py" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 2
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "  ✅ 主後端進程已清理"
else
    echo "  ℹ️  未找到主後端進程"
fi

# 清理 localhost-whisper 相關進程
echo "📍 清理 localhost-whisper 相關進程..."
pids=$(ps aux | grep -E "localhost-whisper.*main\.py|whisper.*main\.py" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 2  
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "  ✅ Whisper 主進程已清理"
else
    echo "  ℹ️  未找到 Whisper 主進程"
fi

# 清理 MLX Whisper 多進程處理器
echo "📍 清理 MLX Whisper 多進程..."
pids=$(ps aux | grep -E "mlx_whisper|multiprocessing\.spawn.*whisper" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 2
    echo "$pids" | xargs kill -9 2>/dev/null  
    echo "  ✅ MLX Whisper 多進程已清理"
else
    echo "  ℹ️  未找到 MLX Whisper 多進程"
fi

# 清理前端進程
echo "📍 清理前端進程..."
pids=$(ps aux | grep -E "pnpm dev|next.*dev|node.*next" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 2
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "  ✅ 前端進程已清理"
else
    echo "  ℹ️  未找到前端進程"
fi

# 清理 uvicorn 相關進程
echo "📍 清理 uvicorn 進程..."
pids=$(ps aux | grep -E "uvicorn.*main:app" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 2
    echo "$pids" | xargs kill -9 2>/dev/null
    echo "  ✅ Uvicorn 進程已清理"
else
    echo "  ℹ️  未找到 Uvicorn 進程"
fi

echo ""
echo "✅ 清理完成！"
echo ""
echo "💡 如果進程仍然存在，可以手動檢查："
echo "   ps aux | grep -E '(main\.py|whisper|uvicorn|pnpm)'"