"""
StudyScriber FastAPI 應用程式主入口

雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式
"""

import os
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db.database import auto_init_database, check_database_connection, check_tables_exist
from app.api.sessions import router as sessions_router
from app.api.notes import router as notes_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    應用程式生命週期管理

    啟動時初始化資料庫，關閉時清理資源
    """
    # 啟動時執行
    print("🚀 StudyScriber 正在啟動...")

    try:
        # 自動檢測並初始化資料庫
        await auto_init_database()

        # 檢查資料庫連接
        db_ok = await check_database_connection()
        if not db_ok:
            raise Exception("資料庫連接失敗")

        print("✅ 資料庫初始化完成")

    except Exception as e:
        print(f"❌ 應用程式啟動失敗: {e}")
        raise

    yield

    # 關閉時執行
    print("🔄 StudyScriber 正在關閉...")


# 建立 FastAPI 應用程式
app = FastAPI(
    title="StudyScriber API",
    description="雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式",
    version="0.1.0",
    lifespan=lifespan
)

# CORS 設定
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊路由
app.include_router(sessions_router)
app.include_router(notes_router)


@app.get("/")
async def root():
    """根路由 - API 狀態檢查"""
    return {
        "message": "StudyScriber API is running",
        "version": "0.1.0",
        "status": "healthy"
    }


@app.get("/health")
async def health_check():
    """健康檢查端點"""
    try:
        # 檢查資料庫連接
        db_ok = await check_database_connection()

        if not db_ok:
            raise HTTPException(status_code=503, detail="Database connection failed")

        # 檢查表格是否存在
        tables_ok = await check_tables_exist()

        if not tables_ok:
            raise HTTPException(status_code=503, detail="Database tables missing")

        return {
            "status": "healthy",
            "database": "connected",
            "tables": "available"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Health check failed: {str(e)}")


# 全域例外處理器
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """全域例外處理"""
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc),
            "path": str(request.url)
        }
    )


if __name__ == "__main__":
    # 從環境變數讀取設定
    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", "8000"))
    debug = os.getenv("DEBUG", "false").lower() == "true"

    # 啟動應用程式
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=debug,
        log_level="info" if not debug else "debug"
    )
