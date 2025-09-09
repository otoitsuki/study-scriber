# StudyScriber

AI 智慧錄音筆記工具，支援即時逐字稿轉錄與 Markdown 筆記編輯。
特色是除了 OpenAI
 Whisper 模型以外，也支援 Localhost MLX Breeze-ASR-25 
模型，非常適合作為中英文混合課程的筆記工具。

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

AUDIO_CHUNK_DURATION_SEC=15

# 音頻切片重疊時間（秒）- 避免切片邊界丟失內容
# 建議值：0-2秒，通常設為 0
AUDIO_CHUNK_OVERLAP_SEC=0
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

## 統一配置管理

**🎯 重要：** StudyScriber 採用統一配置管理，**只需修改主目錄的 `.env` 檔案，即可同時控制前後端的所有相關設定**。

### 核心配置參數

在 `.env` 檔案中修改 `AUDIO_CHUNK_DURATION_SEC` 會自動影響：

- ✅ **前端錄音切片間隔**：錄音時每隔 N 秒發送一次音頻片段
- ✅ **後端音頻處理長度**：每個音頻片段的處理時間長度  
- ✅ **逐字稿時間戳間隔**：逐字稿顯示的時間標籤間隔
- ✅ **WebSocket 推送頻率**：轉錄結果的推送頻率

### 設定建議

```bash
# 低延遲模式 (更頻繁的更新)
AUDIO_CHUNK_DURATION_SEC=10

# 平衡模式 (推薦) 
AUDIO_CHUNK_DURATION_SEC=15

# 節省 API 模式 (較少的 API 呼叫)
AUDIO_CHUNK_DURATION_SEC=20
```

**注意事項：**
- 🔸 **數值過小 (5-10秒)**：轉錄更即時，但會增加 API 呼叫次數和成本
- 🔸 **數值適中 (15-20秒)**：平衡即時性與成本，建議值
- 🔸 **數值過大 (25-30秒)**：減少 API 成本，但用戶等待時間較長

### 修改配置步驟

**方法一：直接編輯**
```bash
# 1. 編輯主目錄的 .env 檔案
nano .env

# 2. 修改以下行
AUDIO_CHUNK_DURATION_SEC=15  # 改為您想要的值

# 3. 重啟後端服務
uv run main.py
```

**方法二：命令行快速修改**
```bash
# 設定為 10 秒 (低延遲模式)
sed -i '' 's/AUDIO_CHUNK_DURATION_SEC=.*/AUDIO_CHUNK_DURATION_SEC=10/' .env

# 設定為 15 秒 (平衡模式)  
sed -i '' 's/AUDIO_CHUNK_DURATION_SEC=.*/AUDIO_CHUNK_DURATION_SEC=15/' .env

# 設定為 20 秒 (節省模式)
sed -i '' 's/AUDIO_CHUNK_DURATION_SEC=.*/AUDIO_CHUNK_DURATION_SEC=20/' .env

# 重啟後端
uv run main.py
```

### 驗證配置是否生效

```bash
# 檢查配置 API
curl -s http://localhost:8000/api/config | python3 -m json.tool
```

應該看到：
```json
{
    "audioChunkDurationSec": 15,
    "transcriptDisplayIntervalSec": 15,
    ...
}
```

**⚠️ 重要提醒：**
- 只需修改主目錄的 `.env` 檔案
- 不需要修改 `frontend/.env.local`
- 前端會自動從 `/api/config` 讀取新配置

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

**4. 錄音不運作**
- 檢查麥克風權限是否允許
- 確認瀏覽器支援 MediaRecorder API
- 使用系統診斷工具檢查各項狀態

**5. 逐字稿不顯示**
- 檢查 STT Provider 配置是否正確
- 確認 API Key 有效且有足夠配額
- 查看瀏覽器開發者工具 Console 錯誤訊息
- 使用右上角設定選單中的「系統診斷」檢查連線狀態

**6. 進程清理問題**
```bash
# 強制清理所有相關進程
make cleanup

# 清理特定端口
make clean-ports
```

## 系統診斷

如果遇到問題，可以使用內建的系統診斷工具：

1. 點擊右上角設定按鈕 (⚙️)
2. 選擇「系統診斷」
3. 查看各項檢查結果：
   - WebSocket 連線狀態
   - 後端 API 可用性
   - STT 提供者狀態
   - 麥克風權限
   - 資料庫連線

## 支援與回饋

如有問題或建議，請在 [GitHub Issues](https://github.com/otoitsuki/study-scriber/issues) 中回報。

## 授權

本專案採用 MIT License。詳見 [LICENSE](LICENSE) 檔案。
