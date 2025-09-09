# StudyScriber PRD

---

## 1. 專案願景

提供「邊錄邊轉錄」的雲端筆記，錄音、即時逐字稿、Markdown 筆記與匯出，一條龍完成。

---

## 2. 產品定位

| 項目     | 描述                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| 目標族群 | 成年自學者、學生、專業人士                                                                                   |
| 痛點     | 備課／聽課同時要做筆記、整理逐字稿耗時、重點摘要費時、隱私安全顧慮、雲端服務成本高                           |
| 核心價值 | 1 個畫面完成「純筆記」或「錄音 → 即時逐字稿 → AI摘要 → 筆記」，支援雲端與本地STT，完整隱私保護，課後一鍵匯出 |

---

## 3. 核心功能

### 3.1 雲端 Markdown 筆記系統

### 3.2 錄音與即時轉錄

### 3.3 AI 摘要功能

**核心特性：**
- **智能摘要生成**：基於筆記與逐字稿內容自動生成結構化摘要
- **分頁檢視系統**：逐字稿與摘要分頁顯示，便於快速回顧重點
- **多種摘要模式**：
  - 筆記 + 逐字稿：以筆記為結構基礎，補充逐字稿細節
  - 僅筆記：直接摘要筆記內容
  - 僅逐字稿：摘要逐字稿內容
  - 皆空：跳過摘要生成

**工作流程：**
1. 錄音結束後進入 processing 狀態
2. 逐字稿轉錄完成
3. 背景任務調用 Azure OpenAI 生成摘要
4. 透過 WebSocket 推送摘要結果
5. 進入 finished 狀態，支援分頁檢視

**容錯機制：**
- 重試機制：Azure OpenAI 失敗時自動重試 3 次
- 超時處理：60 秒內未完成摘要生成則進入完成狀態
- 錯誤顯示：摘要生成失敗時在 UI 顯示錯誤訊息

### 3.4 多引擎 STT 支援

**技術實現：** 動態 Provider 配置 + 統一介面 + 健康檢查

**支援引擎：**

| STT 引擎             | 類型 | 特色                                    | 狀態 |
| -------------------- | ---- | --------------------------------------- | ---- |
| Azure Whisper        | 雲端 | 高精度、多語言支援                      | ✅    |
| OpenAI Whisper       | 雲端 | 原生 Whisper、API 相容                  | ✅    |
| GPT-4o Audio         | 雲端 | GPT-4o 音訊轉錄、支援自訂 prompt        | ✅    |
| Google Gemini        | 雲端 | Google 大模型、音訊理解                 | ✅    |
| Breeze-ASR-25 (本地) | 本地 | 完全離線、隱私保護、中文優化、Apple加速 | ✅    |

**動態配置系統：**
- **LLM 設定對話框**：統一配置介面，支援動態切換 Provider
- **自訂配置**：用戶可輸入自定義 Endpoint、API Key、Model Name
- **健康檢查**：自動檢測 Provider 可用性
- **容錯機制**：連線失敗時自動重試，超時處理

**OpenAI Compatible 標準：**
- 支援所有相容 OpenAI API 格式的 STT 服務

### 3.5 本地 STT 引擎 (Breeze-ASR-25)

**技術實現：** MLX 框架 + Apple Silicon 優化 + localhost 服務

**核心優勢：**
- **完全離線運行**：無需網路連線，音檔不會上傳到任何雲端服務
- **隱私完全保護**：所有處理在本機進行，無資料外洩風險
- **零 API 費用**：無需支付雲端 API 使用費用
- **中文特別優化**：專為繁體中文與中英混用場景優化
- **Apple Silicon 加速**：基於 MLX 框架優化效能

## 系統要求
- **作業系統**：macOS 12+ 
- **處理器**：Apple Silicon (M1/M2/M3)
- **記憶體**：建議 16GB+
- **儲存空間**：約 4GB（模型檔案）
- **Python**：3.11+

### 3.6 匯出與資料打包

**技術實現：** ZIP 打包 + 時間戳格式化  

**匯出內容：**
- **Markdown 筆記** (`note.md`)：完整的筆記內容，保持原始格式
- **時間戳逐字稿** (`transcript.txt`)：格式化的逐字稿，包含精確時間戳
- **AI 智能摘要** (`summary.txt`)：基於筆記與逐字稿生成的結構化摘要

**增強功能：**
- **智能檔名**：自動生成有意義的檔名，包含時間戳
- **從後端獲取**：檔名由後端 API 統一管理，確保一致性
- **錯誤處理**：匯出失敗時提供詳細錯誤訊息和重試機制

---

## 4. 技術架構

### 4.1 後端技術棧

**核心框架：** FastAPI (Python)  
**資料庫：** Supabase PostgreSQL  
**即時通訊：** WebSocket  

**技術組件：**
```python
FastAPI (Web 框架)
├── Pydantic (資料驗證)
├── WebSocket (即時通訊)
├── 多引擎 STT 支援
│   ├── Azure OpenAI (Whisper)
│   ├── OpenAI Compatible APIs
│   ├── Google Gemini
│   ├── GPT-4o Audio
│   └── Breeze-ASR-25 (本地)
├── AI 摘要服務
│   ├── Azure OpenAI (GPT-4o)
│   ├── 背景任務處理
│   └── 重試與容錯機制
├── 動態配置系統
│   ├── LLM 設定對話框
│   ├── Provider 動態切換
│   └── 健康檢查機制
├── Cloudflare R2 (音檔儲存)
└── FFmpeg (音檔處理)
```

**關鍵特性：**
- **高效能 API**：FastAPI 提供自動 API 文件生成和高效能非同步處理
- **型別安全**：Pydantic 確保資料驗證和序列化的型別安全
- **即時通訊**：WebSocket 支援即時逐字稿推送、摘要推送和狀態同步
- **多引擎 STT**：統一介面支援雲端與本地 STT 引擎，動態切換
- **AI 摘要**：背景任務生成智能摘要，支援重試與超時處理
- **動態配置**：運行時配置 Provider，無需重啟服務
- **音檔處理**：FFmpeg 支援多格式音檔轉換和處理
- **本地隱私**：本地 STT 引擎完全離線運行，保護用戶隱私

### 4.2 前端技術棧

**核心框架：** React + Next.js  
**程式語言：** TypeScript  
**狀態管理：** Zustand  

**關鍵特性：**
- **現代化 UI**：React 18 + Next.js 14 提供最新的前端開發體驗
- **型別安全**：TypeScript 確保編譯時型別檢查，減少執行時錯誤
- **響應式設計**：Tailwind CSS + shadcn/ui 提供一致的設計系統
- **輕量狀態管理**：Zustand 提供簡潔的狀態管理解決方案，支援摘要分頁狀態
- **原生音檔錄製**：MediaRecorder API 支援瀏覽器原生音檔錄製
- **分頁檢視系統**：shadcn/ui Tabs 支援逐字稿與摘要分頁切換
- **動態配置 UI**：LLM 設定對話框支援運行時 Provider 配置
- **即時狀態同步**：WebSocket 連線支援逐字稿與摘要的即時推送

### 4.3 資料庫設計

**資料庫系統：** Supabase PostgreSQL  

**核心資料表：**

| 資料表                | 描述                       | 新增欄位       |
| --------------------- | -------------------------- | -------------- |
| `sessions`            | 會話主資料，記錄錄音與筆記 | `summary TEXT` |
| `notes`               | Markdown 筆記內容          | -              |
| `transcript_segments` | 逐字稿片段，包含時間戳     | -              |
| `audio_files`         | 音檔儲存資訊與 R2 路徑     | -              |

**摘要功能資料流：**
1. 錄音完成後，`sessions.summary` 初始為 `NULL`
2. 摘要服務完成後，更新 `sessions.summary` 欄位
3. 前端透過 WebSocket 或 API 查詢取得摘要內容
4. 匯出時包含 summary 內容至 `summary.txt`

---

## 5. 部署要求

### 5.1 基本部署環境

**後端要求：**
- Python 3.11+
- FastAPI + Uvicorn
- PostgreSQL (透過 Supabase)
- 外部服務：Azure OpenAI、Cloudflare R2

**前端要求：**  
- Node.js 18+
- Next.js 14
- 支援現代瀏覽器 (Chrome 80+, Firefox 75+, Safari 13+)

### 5.2 本地 STT 引擎部署 (可選)

**系統需求：**
- **作業系統**：macOS 12+ (Apple Silicon 專用)
- **處理器**：Apple Silicon (M1/M2/M3/M4)
- **記憶體**：建議 16GB+ RAM
- **儲存空間**：約 4GB (Breeze-ASR-25 模型)
- **Python 版本**：3.11+
- **MLX 框架**：自動安裝

**部署步驟：**
```bash
# 1. 基本環境設定
git clone <repository>
cd study-scriber

# 2. 後端環境
uv sync
uv run python main.py  # Port 8000

# 3. 前端環境  
cd frontend
npm install
npm run dev  # Port 3000

# 4. 本地 STT (可選)
cd localhost-whisper
uv sync
uv run python main.py  # Port 8001

# 5. 一鍵啟動 (推薦)
make dev-with-local
```

### 5.3 環境變數配置

**後端必要變數：**
```bash
# Azure OpenAI
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=your_azure_endpoint  
WHISPER_DEPLOYMENT_NAME=your_whisper_model
AZURE_OPENAI_MODEL=gpt-4o

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key

# 摘要功能
SUMMARY_PROMPT_TEMPLATE="生成摘要範本"

# Cloudflare R2
R2_ACCESS_KEY_ID=your_r2_key
R2_SECRET_ACCESS_KEY=your_r2_secret
R2_BUCKET_NAME=your_bucket
```

**前端必要變數：**
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_key  
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

### 5.4 生產環境注意事項

1. **Azure OpenAI 配額**：確保有足夠的 API 配額支援摘要生成與 STT
2. **資料庫遷移**：確保 `sessions` 表包含 `summary TEXT` 欄位
3. **WebSocket 配置**：調整 WebSocket 超時與重連機制適應網路環境
4. **本地 STT 隱私**：生產環境可完全關閉網路存取，確保資料隱私
5. **容器化部署**：Docker 支援，但本地 STT 需要 macOS + Apple Silicon 環境
