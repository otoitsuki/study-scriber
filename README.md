# Study Scriber

智慧錄音筆記應用程式，支援即時逐字稿轉錄與 AI 摘要生成。

## 主要功能

- **即時錄音轉錄**：支援 Azure Whisper、Gemini、GPT-4o 多種 STT 引擎
- **筆記編輯**：Markdown 格式筆記，支援即時編輯與自動儲存
- **AI 摘要**：基於筆記與逐字稿自動生成結構化摘要 ✨
- **分頁檢視**：逐字稿與摘要分頁顯示，便於快速回顧
- **完整匯出**：ZIP 格式匯出包含筆記、逐字稿與摘要檔案

## 環境變數設定

### 後端 (FastAPI)

```bash
# Azure OpenAI 設定
AZURE_OPENAI_API_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
WHISPER_DEPLOYMENT_NAME=your_whisper_deployment

# 摘要功能設定 (新增)
AZURE_OPENAI_MODEL=gpt-4o  # 預設：gpt-4o
SUMMARY_PROMPT_TEMPLATE="以以下筆記為基底結構，補充逐字稿細節生成摘要：\n筆記：{notes}\n逐字稿：{transcript}"

# Supabase 設定
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# 其他設定
STT_PROVIDER_DEFAULT=gpt4o  # whisper, gemini, gpt4o
AUDIO_CHUNK_DURATION_SEC=10
```

### 前端 (Next.js)

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## 摘要功能說明

### 工作流程

1. **錄音結束**：使用者停止錄音後，系統進入處理階段
2. **逐字稿完成**：STT 引擎處理完成，逐字稿就緒
3. **摘要生成**：背景任務呼叫 Azure OpenAI，基於筆記與逐字稿生成摘要
4. **完成狀態**：逐字稿與摘要皆就緒後，進入完成狀態
5. **分頁檢視**：使用者可在逐字稿與摘要間切換檢視
6. **匯出功能**：ZIP 檔案包含 `note.md`、`transcript.txt`、`summary.txt`

### 摘要邏輯

- **筆記 + 逐字稿**：以筆記為結構基礎，補充逐字稿細節
- **僅筆記**：直接摘要筆記內容
- **僅逐字稿**：摘要逐字稿內容
- **皆空**：跳過摘要生成

### 容錯機制

- **重試機制**：Azure OpenAI 失敗時自動重試 3 次
- **超時處理**：60 秒內未完成摘要生成則強制進入完成狀態
- **錯誤顯示**：摘要生成失敗時在 UI 顯示錯誤訊息

## 技術架構

### 後端
- **FastAPI**：RESTful API 與 WebSocket 即時通訊
- **Supabase**：資料庫與即時訂閱
- **Azure OpenAI**：Whisper STT 與 GPT 摘要生成
- **Cloudflare R2**：音檔儲存

### 前端
- **Next.js 14**：React 框架與 App Router
- **Zustand**：狀態管理與摘要分頁邏輯
- **shadcn/ui**：UI 元件庫，包含 Tabs 分頁
- **WebSocket**：即時逐字稿與摘要推送

## 開發與測試

### 後端測試
```bash
# 摘要服務單元測試
PYTHONPATH=. python -m pytest tests/test_summary_service.py -v

# 匯出功能測試
PYTHONPATH=. python -m pytest tests/test_export_summary.py -v
```

### 前端測試
```bash
cd frontend

# 單元測試
npm test -- --run lib/__tests__/app-store-summary.test.ts

# E2E 測試
npm run test:e2e -- e2e/summary-feature.spec.ts
```

### 完整流程測試
```bash
# 啟動後端
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 啟動前端
cd frontend && npm run dev

# 瀏覽器開啟 http://localhost:3000
# 1. 開始錄音
# 2. 等待逐字稿出現
# 3. 停止錄音
# 4. 等待摘要生成（最多 60 秒）
# 5. 切換分頁檢視摘要
# 6. 匯出 ZIP 檔案驗證內容
```

## 部署注意事項

1. **Azure OpenAI 配額**：確保有足夠的 API 配額支援摘要生成
2. **資料庫遷移**：確保 `sessions` 表包含 `summary TEXT` 欄位
3. **環境變數**：正確設定所有必要的環境變數
4. **網路延遲**：考慮調整 WebSocket 超時與重連機制 
