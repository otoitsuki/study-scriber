# StudyScriber 開發指令

## Python 環境管理
```bash
# 使用 uv 管理依賴 (推薦)
uv sync                          # 同步依賴
uv run python main.py           # 執行主程式
uv run pytest                  # 執行測試

# 傳統方式
python -m venv .venv            # 建立虛擬環境
source .venv/bin/activate       # 啟動環境 (macOS/Linux)
pip install -e .                # 安裝依賴
```

## 測試指令
```bash
# 完整測試套件
make test                       # 執行所有測試
make test-unit                  # 只執行單元測試  
make test-integration          # 只執行整合測試
make test-report               # 生成測試報告

# 直接使用 pytest
pytest tests/unit/             # 單元測試
pytest tests/integration/     # 整合測試
pytest -xvs                   # 詳細輸出，遇錯停止
```

## 前端開發
```bash
cd frontend
pnpm install                   # 安裝依賴
pnpm dev                      # 開發模式
pnpm build                    # 建置
pnpm test                     # 前端測試
```

## 開發伺服器
```bash
# 後端 (Terminal 1)
uv run python main.py         # 啟動 FastAPI (port 8000)

# 前端 (Terminal 2)  
cd frontend && pnpm dev       # 啟動 Next.js (port 3000)
```

## 資料庫操作
```bash
# 測試資料庫連接
python -c "from app.db.supabase_config import get_supabase_client; print('✅ 連接成功')"

# 完整整合測試
python test_final_integration.py
```

## 程式碼品質
```bash
# 格式化 (如果有設定)
black app/                    # Python 程式碼格式化
isort app/                    # import 排序

# 檢查
flake8 app/                   # 程式碼檢查 (如果有設定)
```

## 系統指令 (macOS)
```bash
# 基本檔案操作
ls -la                        # 列出檔案
find . -name "*.py"          # 尋找 Python 檔案
grep -r "pattern" app/       # 搜尋內容
cd path/to/directory         # 切換目錄

# Git 操作
git status                   # 檢查狀態
git add .                    # 加入所有變更
git commit -m "message"      # 提交變更
git push origin main         # 推送到遠端
```