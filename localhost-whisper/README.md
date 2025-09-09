# Study Scriber

智慧錄音筆記應用程式，支援即時逐字稿轉錄與 Markdown 筆記編輯。

## 主要功能

- **即時錄音轉錄**：支援 Azure OpenAI Whisper、Azure GPT-4o-transcribe  與本地 Breeze-ASR-25 多種 STT 模型
- **筆記編輯**：Markdown 格式筆記，支援即時編輯與自動儲存
- **隱私保護**：使用本地 STT 引擎完全離線，不上傳雲端
- **完整匯出**：ZIP 格式匯出包含 Markdown 筆記與時間戳逐字稿

## 安裝與啟動指南

### 系統需求

**基本需求：**
- Python 3.11+
- Node.js 18+
- UV (快速 Python 套件管理器)
- pnpm 或 npm

**本地 STT 模型 (請參見後面說明)：**
- macOS 12+ 與 Apple Silicon (M1/M2/M3/M4)
- 16GB+ 記憶體建議
- MLX 框架 (自動安裝)

### 一鍵安裝

```bash
# 1. Clone 專案
git clone https://github.com/otoitsuki/study-scriber.git
cd study-scriber

# 2. 安裝所有依賴 (主專案 + 前端 + 本地 STT)
make setup

# 3. 配置環境變數
# 複製範例檔案
cp .env.example .env
cp frontend/.env.example frontend/.env.local

```

### 環境變數配置

請在主目錄的 `.env` 檔案中配置：

```bash
# Supabase 設定 (必須)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Cloudflare R2 設定
R2_ACCOUNT_ID=your-account-id
R2_BUCKET_NAME=studyscriber
R2_API_TOKEN=your-r2-token

# Azure OpenAI 設定 (可選 - 用於 Whisper STT)
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
WHISPER_DEPLOYMENT_NAME=your-whisper-deployment

# OpenAI 設定 (可選)
OPENAI_API_KEY=your-openai-key

# STT 引擎設定
STT_PROVIDER_DEFAULT=breeze-asr-25  # 預設 STT 引擎
WHISPER_LANGUAGE=zh-TW              # 語言設定

# ============================================
# 音頻切片與時間戳統一配置 (一處設定，全域套用)
# ============================================
# 音頻切片時長（秒）- 統一控制以下設定：
# - 前端錄音切片間隔
# - 後端音頻處理長度  
# - 逐字稿時間戳間隔
# - WebSocket 推送頻率
# 建議設定：
# - 🔸 **5-10秒**：轉錄更即時，但會增加 API 呼叫次數和成本
# - 🔸 **15-20秒**：平衡即時性與成本，推薦設定這個區間
# - 🔸 **25-30秒**：減少 API 成本，但用戶等待時間較長

AUDIO_CHUNK_DURATION_SEC=15


# 音頻切片重疊時間（秒）- 避免切片邊界丟失內容
# 建議值：0-2秒，通常設為 0
AUDIO_CHUNK_OVERLAP_SEC=0
```

前端環境變數 `frontend/.env.local`：

```bash
# 前端環境變數（frontend/.env.local）
NEXT_PUBLIC_API_URL=internal
NEXT_PUBLIC_WS_URL=ws://localhost:8000
NODE_ENV=development
```

### 啟動應用程式

可以選擇使用 Makefile 一鍵啟動或是手動一一啟動所有程式。

**一鍵啟動（Only 雲端 Provider)**
```bash
make dev
```

**一鍵啟動 (包含本地 Breeze-ASR-25)**
```bash
# 啟動後端 + 前端 + 本地 Breeze-ASR-25 STT
make dev-with-local
```

**手動啟動 (逐步啟動)**
```bash
# 1. 後端 (Port 8000)
uv run main.py

# 2. 前端 (Port 3000)
cd frontend
npm run dev

# 3. 本地 STT (可選, Port 8001)
cd localhost-whisper
uv run main.py
```

### 驗證安裝

1. **檢查服務狀態**
   - 後端: http://localhost:8000/health
   - 前端: http://localhost:3000
   - 本地 STT: http://localhost:8001/health

2. **測試錄音功能**
   - 開啟 http://localhost:3000
   - 點擊開始錄音按鈕
   - 說幾句話後停止錄音
   - 等待逐字稿出現

3. **STT 配置測試**
   - 點擊右上角設定按鈕
   - 測試不同 STT Provider 連線


## 本地 STT 引擎 (Breeze-ASR-25, Only for Apple Silicon)

除了雲端 STT 服務，系統也支援本地 Breeze-ASR-25 模型：

### 系統需求
- **macOS 12+** 與 **Apple Silicon** 處理器 (M1/M2/M3)
- **Python 3.11+** 與 **MLX** 框架
- **建議 16GB+ 記憶體**

### 安裝與啟動
```bash
# 安裝 MLX 依賴（首次需要）
cd localhost-whisper
uv sync

# 啟動完整開發環境（主後端 + localhost-whisper + 前端）
make dev-with-local
```

### 前端設定
在 LLM 設定對話框中配置：
- **Base URL**: `http://localhost:8001/v1`
- **Model**: `breeze-asr-25` 
- **API Key**: 任意值（localhost 不驗證）


### 注意事項
- 首次啟動會下載模型檔案（約 3-4GB），請耐心等待
- 僅支援 Apple Silicon，Intel Mac 不建議使用
- 詳細說明請參考 [localhost-whisper/README.md](localhost-whisper/README.md)


## 常見問題

**1. UV 安裝問題**
```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**2. 本地 STT 不可用**
- 確認系統為 macOS 12+ 與 Apple Silicon
- 檢查記憶體是否足夠 (16GB+ 建議)
- 第一次啟動需下載模型，請耐心等待

**3. 資料庫連線問題**
- 檢查 Supabase URL 與 API Key 是否正確
- 確認資料庫權限設定
