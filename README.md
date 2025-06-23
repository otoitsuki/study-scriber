# StudyScriber

> 雲端筆記應用：邊錄邊轉錄，支援純筆記與錄音模式

## 📋 專案概述

StudyScriber 是一個先進的雲端筆記應用程式，專為學習者和專業人士設計。它提供兩種主要模式：

- **純筆記模式**：專注於 Markdown 筆記編輯，支援自動儲存
- **錄音模式**：邊錄音邊做筆記，即時轉錄為逐字稿

## 🏗️ 技術架構

### 後端
- **FastAPI** - 現代 Python Web 框架
- **Supabase PostgreSQL** - 雲端資料庫平台
- **SQLAlchemy 2.0** - ORM 與資料庫抽象層
- **Supabase Python SDK** - 官方客戶端
- **Azure Services** - 雲端儲存與語音轉錄

### 前端
- **React** - 使用者介面框架
- **React Hooks** - 狀態管理
- **Socket.IO** - 即時通訊
- **Markdown Editor** - 筆記編輯器

## 🚀 快速開始

### 前置需求

- Python 3.12+
- **Supabase 帳戶** 
- Node.js 18+ (前端開發用)
- Azure 帳戶 (語音轉錄服務，可選)

### 1. 建立 Supabase 專案

1. 前往 [Supabase](https://supabase.com) 註冊帳戶
2. 建立新專案，記下：
   - **Project URL**: `https://your-project-ref.supabase.co`
   - **API Key**: 在 Settings > API 中找到 `anon public` 金鑰

### 2. 設定專案

```bash
# 克隆專案
git clone <repository-url>
cd study-scriber

# 建立虛擬環境
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
# 或 .venv\Scripts\activate  # Windows

# 安裝依賴
uv sync  # 或 pip install -e .
```

### 3. 配置環境變數

複製環境變數範本：
```bash
cp .env.example .env
```

編輯 `.env` 檔案：
```env
# === Supabase 設定 (必須) ===
DB_MODE=supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-anon-public-key

# === Azure 語音服務 (可選) ===
AZURE_SPEECH_KEY=your_speech_service_key
AZURE_SPEECH_REGION=eastus

# === Azure Blob Storage (可選) ===
AZURE_STORAGE_CONNECTION_STRING=your_connection_string
AZURE_CONTAINER_NAME=audio-files
```

### 4. 初始化 Supabase 資料庫

#### 方法 A: 使用 Supabase Dashboard (推薦)

1. 開啟 [Supabase Dashboard](https://supabase.com/dashboard)
2. 選擇您的專案
3. 點選左側選單的 **SQL Editor**
4. 複製 `app/db/supabase_init.sql` 檔案的完整內容
5. 貼上到 SQL Editor 中
6. 點選 **Run** 執行

#### 方法 B: 使用指令行工具

```bash
# 安裝 Supabase CLI (可選)
npm install -g supabase

# 登入並連接專案
supabase login
supabase link --project-ref your-project-ref

# 執行初始化腳本
supabase db reset --linked
```

### 5. 驗證設定

執行整合測試：
```bash
python test_final_integration.py
```

如果看到以下輸出，表示設定成功：
```
🎉 所有測試通過！StudyScriber T1 + T2 整合完全成功！
✨ 現在可以開始開發 T3 (音檔處理) 和 T4 (逐字稿) 功能了！
```

### 6. 啟動開發伺服器

```bash
python main.py
```

API 服務將在 `http://localhost:8000` 啟動。

## 📁 專案結構

```
study-scriber/
├── app/                          # FastAPI 應用程式
│   ├── api/                     # API 路由
│   │   ├── sessions.py         # Session 管理 API
│   │   └── notes.py            # 筆記 API
│   ├── ws/                      # WebSocket 端點
│   ├── services/                # 業務邏輯服務
│   ├── core/                    # 核心功能 (FFmpeg, etc.)
│   ├── db/                      # 資料庫配置與模型
│   │   ├── supabase_config.py  # Supabase 配置管理
│   │   ├── supabase_init.sql   # 資料庫初始化腳本
│   │   ├── database.py         # 資料庫連接
│   │   └── models.py           # SQLAlchemy 模型
│   ├── middleware/              # 中介軟體
│   └── schemas/                 # Pydantic 模型
├── test_final_integration.py    # 整合測試腳本
├── main.py                      # 應用程式入口點
├── .env.example                 # 環境變數範本
└── pyproject.toml              # 專案配置
```

## 🗄️ Supabase 資料庫架構

### 主要表格

- **sessions** - 會話管理（純筆記或錄音模式）
- **notes** - Markdown 筆記內容
- **audio_files** - 音檔切片記錄
- **transcript_segments** - 逐字稿片段
- **transcripts** - 完整逐字稿

### 關鍵特性

- **UUID 主鍵** - 使用 `gen_random_uuid()` 自動生成
- **自動時間戳** - 透過觸發器自動更新 `updated_at`
- **單一活躍會話** - 資料庫層級保證同時只有一個 active session
- **完整約束** - 外鍵、檢查約束、唯一約束確保資料完整性
- **級聯刪除** - 刪除 session 時自動清理關聯資料

### 資料庫初始化腳本說明

`app/db/supabase_init.sql` 包含：

1. **自定義類型 (Enum)**
   - `session_type`: `'note_only'`, `'recording'`
   - `session_status`: `'active'`, `'completed'`
   - `lang_code`: `'zh-TW'`, `'en-US'`

2. **表格建立**
   - 所有必要的表格和欄位
   - 適當的資料類型和約束

3. **索引建立**
   - 查詢效能最佳化
   - 唯一約束確保資料完整性

4. **觸發器設定**
   - 自動更新時間戳
   - 單一活躍會話保護

## 🔧 開發指南

### 測試資料庫連接

```bash
# 完整整合測試
python test_final_integration.py

# 快速連接測試
python -c "
from app.db.supabase_config import get_supabase_client
client = get_supabase_client()
response = client.table('sessions').select('*').execute()
print(f'✅ 連接成功，找到 {len(response.data)} 個 sessions')
"
```

### API 文件

啟動服務後，訪問以下網址查看 API 文件：

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

### 健康檢查

```bash
curl http://localhost:8000/health
```

## 🛠️ Supabase 管理

### 查看資料

在 Supabase Dashboard 中：
1. 點選 **Table Editor**
2. 瀏覽各個表格的資料
3. 可以直接在 Dashboard 中編輯資料

### 監控效能

在 Supabase Dashboard 中：
1. 點選 **Logs**
2. 查看 API 請求記錄
3. 監控資料庫效能指標

### 備份與還原

Supabase 自動提供：
- 每日自動備份
- 時間點還原 (Point-in-time recovery)
- 可在 Dashboard 的 **Settings > Database** 中管理

## 📊 開發進度

### 已完成 ✅

- [x] **T1: 基礎架構**
  - 完整的 FastAPI 專案結構
  - Supabase PostgreSQL 資料庫設計
  - SQLAlchemy 模型定義
  - 自動初始化機制

- [x] **T2: Session 管理 API**
  - Session 建立、讀取、更新、列表
  - 筆記 CRUD 操作
  - 單一活躍會話保護
  - 完整測試覆蓋

### 進行中 🚧

- [ ] **T3: 音檔處理**
  - 音檔上傳與分段儲存
  - FFmpeg 音訊轉碼
  - Supabase Storage 整合

- [ ] **T4: 語音轉錄**
  - Azure Whisper 整合
  - 即時轉錄功能
  - 分段與完整逐字稿

### 待開發 📋

- WebSocket 即時功能
- 匯出功能 (ZIP 包)
- 前端 React 應用程式
- 使用者認證與權限
- Supabase RLS 設定

## 🚨 常見問題

### Q: 為什麼選擇 Supabase？

A: Supabase 提供：
- **免費額度充足** - 適合開發和小型專案
- **PostgreSQL 完整功能** - 支援複雜查詢和約束
- **內建認證** - 未來擴展使用者系統
- **即時功能** - 支援 WebSocket 和即時同步
- **儲存服務** - 整合音檔儲存
- **99.9% 可用性** - 生產級別穩定性

### Q: 如何重置資料庫？

A: 在 Supabase Dashboard 的 SQL Editor 中執行：
```sql
-- 刪除所有表格
DROP TABLE IF EXISTS notes CASCADE;
DROP TABLE IF EXISTS transcripts CASCADE;
DROP TABLE IF EXISTS transcript_segments CASCADE;
DROP TABLE IF EXISTS audio_files CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;

-- 刪除自定義類型
DROP TYPE IF EXISTS session_type CASCADE;
DROP TYPE IF EXISTS session_status CASCADE;
DROP TYPE IF EXISTS lang_code CASCADE;
```
然後重新執行 `supabase_init.sql`。

### Q: 如何查看詳細錯誤？

A: 在 `.env` 中設定：
```env
DEBUG=true
```
這將啟用詳細的 SQL 查詢日誌。

## 🤝 貢獻指南

1. Fork 專案
2. 建立特性分支 (`git checkout -b feature/amazing-feature`)
3. 確保所有測試通過 (`python test_final_integration.py`)
4. 提交變更 (`git commit -m 'Add amazing feature'`)
5. 推送到分支 (`git push origin feature/amazing-feature`)
6. 開啟 Pull Request

## 📄 授權條款

本專案採用 MIT 授權條款。詳情請見 [LICENSE](LICENSE) 檔案。

## 🔗 相關連結

- [專案需求文件 (PRD)](PRD.md)
- [測試報告](T1_T4_Test_Final_Report.md)
- [開發任務清單](Todos.md)
- [Supabase 官方文件](https://supabase.com/docs)
- [API 文件](http://localhost:8000/docs)

---

**StudyScriber** - 讓學習更有效率 🚀
