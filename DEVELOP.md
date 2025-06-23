## 注意事項
- 開發時測試：每次修改資料庫模型後執行 uv run test_db_setup.py
- 生產環境：使用 PostgreSQL 並設定正確的 DATABASE_URL 環境變數
- 依賴管理：使用 uv sync 確保所有依賴正確安裝

# 直接啟動應用程式，無論資料庫是否存在
python main.py

# 或在測試環境測試
DATABASE_URL="sqlite+aiosqlite:///./test.db" python main.py