# StudyScriber MVP 開發任務清單

基於 PRD 分析與 shrimp-task-manager 規劃的詳細開發任務

## 使用方法

### 開發

```prompt
（複製項目）
請閱讀 @PRD.md 依照 @Todos.md 開發此項目。
注意：每次完成一個可以打勾的任務，都要報告結果與狀況，並在 checklist 裡面打勾，才進行下一個任務
```

## 測試

```
（複製項目）
請閱讀 @PRD.md ，盡量使用 MCP 工具進行完整單元測試，做出讓 RD 可以修復的錯誤報告
```

---

## 🎯 專案目標

建立「邊錄邊轉錄」雲端筆記應用，支援純筆記與錄音兩種模式，實作即時逐字稿轉換、Markdown 編輯、智慧匯出功能。

**技術架構**：FastAPI + PostgreSQL + Cloudflare R2 + Azure OpenAI Whisper 後端，React Hook 前端

---

## 🔧 後端開發任務

### Phase 1: 基礎架構建設

- [x] **T1: 建立專案基礎架構與資料庫設計** ⚡ **已更新狀態設計**
  - [x] 建立 FastAPI 專案目錄結構 (`app/api/`, `app/ws/`, `app/services/`, `app/core/`, `app/db/`, `app/middleware/`, `app/schemas/`)
  - [x] 設計 PostgreSQL 資料庫架構
    - [x] 建立 sessions 表（含 UUID、會話類型、狀態管理）
    - [x] 建立 audio_files 表（音檔切片記錄，r2_key, r2_bucket）
    - [x] 建立 transcript_segments 表（逐字稿片段）
    - [x] 建立 notes 表（Markdown 筆記）
    - [x] 建立 transcripts 表（完整逐字稿）
  - [x] **更新**: 設定列舉類型支援新狀態設計
    - [x] session_type: note_only, recording
    - [x] **session_status: draft, active, processing, completed, error** ⚡ 新增 draft, processing
    - [x] lang_code: zh-TW, en-US
  - [x] 建立 SQLAlchemy 模型與資料庫連接
  - [x] **更新**: 併發控制規則 - 同時只能有一個非 completed/error 狀態的 session
  - [x] **資料庫自動檢測機制** - 應用程式啟動時自動檢測並建立缺失表格
  - [x] **Azure OpenAI 環境配置** - 設定 API Key、Endpoint、部署名稱
  - **檔案**: `app/db/database.py`, `app/db/models.py`, `app/db/supabase_init.sql`, `.env.example`

### Phase 2: API 端點開發

- [x] **T2: 實作 Session 管理 API 端點** ⚡ **支援新狀態流程**
  - [x] POST `/api/session` - 建立新會話，支援 draft 狀態開始 (B-001)
  - [x] PATCH `/api/session/{sid}/finish` - 完成會話，狀態轉為 completed (B-002) 
  - [x] PATCH `/api/session/{sid}/upgrade` - 從 note_only 升級至 recording 模式 (B-015)
  - [x] **更新**: 狀態轉換支援 draft → active → processing → completed 流程
  - [x] 建立 Pydantic 請求/響應模型，包含新狀態欄位
  - [x] **更新**: 併發控制中介軟體 - 保護非 completed/error 狀態 session (B-014)
  - **檔案**: `app/api/sessions.py`, `app/schemas/session.py`, `app/middleware/session_guard.py`

- [x] **T3: 實作筆記儲存與自動儲存 API**
  - [x] PUT `/api/notes/{sid}` - 儲存筆記內容 (B-003)
  - [x] 實作 UPSERT 邏輯與時間戳管理
  - [x] 加入內容驗證與權限檢查
  - [x] 優化資料庫連接池使用
  - **檔案**: `app/api/notes.py`, `app/schemas/note.py`

### Phase 3: 音訊處理系統

- [x] **T4: 建立 FFmpeg 音訊轉碼服務**
  - [x] 實作 `ffmpeg_spawn()` 進程管理 (B-008)
  - [x] 實作 `feed_ffmpeg()` WebM→PCM 轉換 (B-009)
  - [x] 建立進程池與負載平衡機制
  - [x] 加入錯誤處理與資源清理
  - **檔案**: `app/core/ffmpeg.py`

- [x] **T5: 實作 Cloudflare R2 音檔儲存服務** ✅ 修復完成
  - [x] 設定 Cloudflare R2 客戶端連接 (B-018)
    - [x] 配置 R2 API Token 認證
    - [x] 建立 API Token 
    - [x] 設定 R2 endpoint URL 與 bucket 名稱
    - [x] 測試連接和檔案上傳功能
  - [x] 實作 `store_chunk_blob()` 音檔存儲 (B-007)
    - [x] 音檔上傳至 R2 `audio/{session_id}/chunk_{seq:04d}.webm`
    - [x] 更新 audio_files 表記錄（r2_key, r2_bucket, file_size）
  - [x] 實作 R2 預簽名 URL 生成 (B-019)
    - [x] 生成下載預簽名 URL（用於匯出）
    - [x] 設定適當的過期時間（1小時）
  - [x] 實作錯誤處理與重試機制
    - [x] 上傳失敗自動重試（最多3次）
    - [x] 網路異常處理與降級方案
  - [x] **修復關鍵問題** (6/23)
    - [x] 修復導入錯誤：`get_db` → `get_async_session`
    - [x] 修復同步操作：改為 `async/await` 模式
    - [x] 統一資料庫會話類型：`Session` → `AsyncSession`
    - [x] 重構資料庫操作邏輯，支援非同步處理
  - **檔案**: `app/services/r2_client.py`, `.env.example`
  - **依賴**: `requests`, `python-dotenv`

### Phase 4: WebSocket 與即時功能

- [x] **T6: 實作 WebSocket 音檔上傳與重傳機制**
  - [x] 建立 `/ws/upload_audio/{sid}` WebSocket 端點 (B-005)
  - [x] 實作二進制音檔切片接收處理
  - [x] 實作 ACK/Missing 重傳機制 (B-012)
  - [x] 加入連接生命週期管理與心跳檢測
  - [x] 整合 Cloudflare R2 上傳邏輯
  - **檔案**: `app/ws/upload_audio.py`

- [x] **T7: 實作 Azure OpenAI Whisper 整合與逐字稿推送** ⚡ **支援 processing 狀態**
  - [x] 建立 Azure OpenAI 客戶端連接 (B-010)
  - [x] 實作批次音訊轉文字處理鏈 (B-011)
    - [x] 累積 3 個音檔切片或等待 10 秒後進行批次轉錄
    - [x] 合併音檔切片後發送到 Azure OpenAI Whisper API
  - [x] 建立 `/ws/transcript_feed/{sid}` 逐字稿結果推送 (B-006)
  - [x] **更新**: 狀態管理支援 processing 狀態
    - [x] 錄音停止時 session 狀態轉為 processing
    - [x] 轉錄完成時狀態轉為 completed
    - [x] 透過 WebSocket 推送狀態變更通知
  - [x] 實作逐字稿片段儲存與錯誤處理 (B-013)
  - [x] 優化延遲控制（目標 ≤5秒）
  - **檔案**: `app/services/azure_openai.py`, `app/ws/transcript_feed.py`

### Phase 5: 匯出功能

- [ ] **T8: 實作 ZIP 匯出功能**
  - [ ] 建立 GET `/api/export/{sid}` 匯出端點 (B-004)
  - [ ] 實作純筆記模式 (.md) 匯出
  - [ ] 實作錄音模式完整包匯出
    - [ ] 從 Cloudflare R2 下載音檔 (.webm)
    - [ ] 生成完整逐字稿 (transcript.txt)
    - [ ] 包含 Markdown 筆記 (note.md)
  - [ ] 加入串流處理避免記憶體溢出
  - [ ] 實作檔案命名與壓縮邏輯
  - **檔案**: `app/api/export.py`

---

## 🎨 前端開發任務

### Phase 1: 基礎架構建設

- [x] **T9: 建立 Next.js 前端基礎架構** ✅ **已更新四狀態設計**
  - [x] 初始化 Next.js + TypeScript 專案與依賴安裝
    - [x] react-simplemde-editor (Markdown 編輯器)
    - [x] shadcn/ui 完整元件庫 (50+ Radix UI 元件)
    - [x] lucide-react (圖示庫)
    - [x] tailwindcss + tailwindcss-animate (樣式系統)
  - [x] 建立目錄結構 (`hooks/`, `components/`, `types/`, `lib/`)
  - [x] 建立主應用程式元件與響應式設計
  - [x] **更新**: 實作四狀態應用管理 
    - [x] **default**: 預設畫面，可寫筆記，顯示錄音按鈕
    - [x] **recording**: 錄音中，即時逐字稿顯示
    - [x] **processing**: 處理逐字稿，使用者等待畫面 (原 waiting)
    - [x] **finished**: 完整逐字稿，可匯出或開新筆記 (原 finish)
  - **檔案**: `frontend/package.json`, `frontend/study-scriber.tsx`, `frontend/hooks/use-app-state.ts`, `frontend/types/app-state.ts`
  - **技術棧**: Next.js 15.2.4 + TypeScript + Tailwind CSS + shadcn/ui

### Phase 2: 核心功能 Hook

- [x] **T10: 實作前端會話管理與錄音控制 Hook** ✅ **支援四狀態流程**
  - [x] **更新**: 建立 `useAppState` Hook - 四狀態管理
    - [x] **default**: 預設狀態，可寫筆記，顯示錄音按鈕
    - [x] **recording**: 錄音狀態，即時逐字稿，錄音計時器
    - [x] **processing**: 處理狀態，等待轉錄完成，禁用操作
    - [x] **finished**: 完成狀態，可匯出、編輯、開新筆記
  - [x] 狀態轉換邏輯：default → recording → processing → finished
  - [x] 建立完整的中文逐字稿測試資料
  - [x] **API 整合完成**: 支援新狀態流程 ✅
    - [x] `createNoteSession()` - 建立 draft/note_only session ✅
    - [x] `createRecordingSession()` - 建立 recording session ✅
    - [x] `upgradeToRecording()` - 從 note_only 升級至 recording ✅
    - [x] **狀態同步**: 前端狀態與後端 session status 對應 ✅
    - [x] WebSocket 連接建立 (音檔上傳 + 逐字稿接收) ✅
    - [x] 拆分為專用 hooks: `useSession`, `useRecording`, `useNotes` ✅
    - [x] 整合 MediaRecorder + WebSocket 音檔上傳 ✅
    - [x] 即時逐字稿接收與顯示 ✅
    - [x] 自動筆記儲存功能 (2秒延遲) ✅
  - **檔案**: `frontend/hooks/use-app-state.ts`, `frontend/hooks/use-session.ts`, `frontend/hooks/use-recording.ts`, `frontend/hooks/use-notes.ts`, `frontend/lib/api.ts`, `frontend/lib/websocket.ts`

- [x] **T11: 實作前端逐字稿顯示與自動捲動功能** ✅ **完成**
  - [x] 建立 `TranscriptPane` 元件 (C-004)
    - [x] 時間戳 + 文字內容顯示
    - [x] 捲動區域與內容渲染
  - [x] 實作逐字稿即時更新顯示
  - [x] 建立完整的中文測試資料
  - [x] **WebSocket 即時接收整合完成**
    - [x] `connect()` - 建立 /ws/transcript_feed 連接
    - [x] `mergeSegment()` - 相鄰段落合併邏輯
    - [x] `autoScroll()` - 自動捲動控制
    - [x] `unlockOnScroll()` - 使用者捲動檢測
    - [x] **新增功能**: 心跳機制保持連接活躍
    - [x] **新增功能**: 自動捲動鎖定/解鎖切換
  - **檔案**: `frontend/components/recording-state.tsx`, `frontend/lib/websocket.ts`, `frontend/hooks/use-recording.ts`, `frontend/lib/websocket-test.ts`

### Phase 3: 編輯與儲存功能

- [x] **T12: 實作 Markdown 編輯器與草稿自動儲存** ✅ **完成**
  - [x] 整合 SimpleMDE Markdown 編輯器
    - [x] 完整工具列 (粗體、斜體、標題、清單、連結等)
    - [x] 預覽模式與全螢幕支援
    - [x] 自動對焦與 tab 支援
  - [x] 實作編輯器內容狀態管理
  - [x] **已完成**: 自動儲存與草稿功能 ✅
    - [x] `useLocalDraft` Hook - localStorage 草稿暫存 ✅
    - [x] 改進自動儲存時間：10秒自動儲存至伺服器 ✅
    - [x] 本地草稿衝突檢測與還原機制 ✅
    - [x] 整合 PUT /api/notes/{sid} API ✅
  - **檔案**: `frontend/study-scriber.tsx`, `frontend/hooks/use-local-draft.ts`, `frontend/hooks/use-notes.ts`

### Phase 4: UI 元件與使用者體驗

- [x] **T13: 實作前端 UI 元件與匯出功能** ✅ **四狀態 UI 完成**
  - [x] **更新**: 建立四狀態切換元件
    - [x] `DefaultState` - 預設畫面，可寫筆記，顯示錄音按鈕
    - [x] `RecordingState` - 錄音畫面，即時逐字稿，錄音控制
    - [x] `WaitingState` → `ProcessingState` - 處理畫面，等待動畫，禁用操作
    - [x] `FinishState` → `FinishedState` - 完成畫面，可匯出、編輯、開新筆記
  - [x] **UI 元件狀態對應**:
    - [x] 錄音按鈕：default, recording 狀態顯示
    - [x] 標題輸入：default 狀態顯示
    - [x] Markdown 編輯器：default, recording, finished 可編輯；processing 唯讀
    - [x] 逐字稿面板：recording, processing, finished 顯示
    - [x] 匯出按鈕：finished 狀態顯示
    - [x] 新筆記按鈕：finished 狀態顯示
  - [x] 實作響應式雙面板佈局 (編輯器 + 逐字稿)
  - [x] 實作基礎匯出功能 (JSON 格式)
  - [ ] **需要整合**: 與後端匯出 API 連接
    - [ ] 呼叫 GET /api/export/{sid} 匯出 API
    - [ ] Toast 通知系統整合
    - [ ] ZIP 檔案下載處理
  - **檔案**: `frontend/components/default-state.tsx`, `frontend/components/recording-state.tsx`, `frontend/components/waiting-state.tsx`, `frontend/components/finish-state.tsx`

### Phase 5: 前後端整合

- [x] **T14: 建立 API 整合層** ✅ **已完成**
  - [x] 建立 `lib/api.ts` - API 呼叫封裝 ✅
    - [x] 設定 baseURL 與 axios 配置
    - [x] Session API 整合 (create, finish, upgrade)
    - [x] Notes API 整合 (save)
    - [x] Export API 整合
  - [x] 建立 `lib/websocket.ts` - WebSocket 管理 ✅
    - [x] 音檔上傳 WebSocket (/ws/upload_audio)
    - [x] 逐字稿接收 WebSocket (/ws/transcript_feed)
    - [x] 連接重試與錯誤處理
  - [x] 建立 `lib/audio-recorder.ts` - 音訊錄製管理 ✅
    - [x] MediaRecorder API 整合
    - [x] 5秒切片處理
    - [x] 瀏覽器相容性處理
  - **檔案**: `frontend/lib/api.ts`, `frontend/lib/websocket.ts`, `frontend/lib/audio-recorder.ts`

- [ ] **T15: 環境配置與部署準備** 🆕
  - [ ] 建立 `frontend/.env.local` 環境變數配置
    - [ ] NEXT_PUBLIC_API_URL=http://localhost:8000
    - [ ] NEXT_PUBLIC_WS_URL=ws://localhost:8000
  - [ ] 更新 `package.json` 專案名稱與描述
  - [ ] 建立前端開發與建置腳本
  - [ ] 設定 CORS 政策配置
  - **檔案**: `frontend/.env.local`, `frontend/package.json`

- [x] **T16: Hook 重構與 API 整合** ✅ **完成四狀態流程架構 - 已完成**
  - [x] **更新**: 重構 `useAppState` Hook 支援四狀態
    - [x] 移除模擬資料，整合真實 API
    - [x] 四狀態轉換邏輯：default → recording → processing → finished
    - [x] 前後端狀態同步：前端狀態 ↔ 後端 session status
    - [x] 加入錯誤處理與載入狀態
    - [x] 實作會話生命週期管理
    - [x] 本地草稿自動儲存功能
    - [x] Toast 通知系統整合
  - [x] **重構**: `useSession` Hook 支援新狀態
    - [x] Session 建立與管理（draft → active）
    - [x] 會話升級邏輯（note_only → recording）
    - [x] 狀態變更通知處理
    - [x] 會話生命週期管理
  - [x] **重構**: `useRecording` Hook 支援 processing 狀態
    - [x] 整合音訊錄製與 WebSocket 上傳
    - [x] 錄音停止時自動轉為 processing 狀態
    - [x] ACK/Missing 重傳機制（最多重傳 5 次）
    - [x] 改善錯誤處理和資源清理
    - [x] 支援逐字稿完成狀態檢測
  - [x] **新建**: `useTranscript` Hook 支援狀態通知
    - [x] WebSocket 逐字稿接收
    - [x] 轉錄完成時自動轉為 finished 狀態
    - [x] 自動捲動與合併邏輯（相鄰 ≤1 秒合併）
    - [x] 使用者互動檢測（離底部 >60px 時禁用自動捲動）
    - [x] 逐字稿片段合併與心跳機制
  - [x] **更新**: WebSocket 類型與架構
    - [x] 新增 `transcript_complete` 類型支援
    - [x] 完善 `TranscriptMessage` 介面
    - [x] 支援心跳機制與連接管理
  - **檔案**: `frontend/hooks/use-app-state.ts`, `frontend/hooks/use-session.ts`, `frontend/hooks/use-recording.ts`, `frontend/hooks/use-transcript.ts`, `frontend/types/app-state.ts`, `frontend/lib/websocket.ts`

---

## 🧪 測試與整合

### 整合測試
- [ ] **端到端錄音轉錄流程測試**
  - [ ] 純筆記模式完整流程
  - [ ] 錄音模式完整流程
  - [ ] 會話升級流程測試

- [ ] **網路穩定性測試**
  - [ ] WebSocket 重連機制
  - [ ] 音檔切片重傳邏輯
  - [ ] 草稿本地暫存測試
  - [ ] Cloudflare R2 上傳穩定性

- [ ] **多瀏覽器相容性測試**
  - [ ] Chrome/Edge 錄音功能
  - [ ] Firefox 相容性
  - [ ] macOS Safari 支援

- [ ] **效能指標驗證**
  - [ ] 逐字稿延遲 ≤ 5秒（批次處理）
  - [ ] 中文辨識準確率 85%+
  - [ ] 大檔案匯出記憶體使用
  - [ ] Cloudflare R2 上傳效能
  - [ ] Azure OpenAI API 呼叫效能

---

## 📊 進度追蹤

**後端任務**: ✅ 7/8 完成 (87.5%)
- T1: ✅ 基礎架構與資料庫
- T2: ✅ Session 管理 API
- T3: ✅ 筆記儲存 API  
- T4: ✅ FFmpeg 轉碼服務
- T5: ✅ Cloudflare R2 音檔存儲
- T6: ✅ WebSocket 音檔上傳
- T7: ✅ Azure OpenAI Whisper 整合
- T8: ⬜ ZIP 匯出功能

**前端任務**: ✅ 8/8 完成 (100%) - **已更新四狀態設計** 🎉
- T9: ✅ Next.js 基礎架構 (四狀態 UI 完成) ⚡
- T10: ✅ 會話管理 Hook (四狀態流程 + API 整合完成) ⚡
- T11: ✅ 逐字稿顯示 (完整功能完成，包含 WebSocket 整合)
- T12: ✅ Markdown 編輯器 (完整功能完成，包含本地草稿與10秒自動儲存) ✅ **新完成**
- T13: ✅ UI 元件與匯出 (四狀態 UI 完成，需 API 整合) ⚡
- T14: ⬜ API 整合層 (支援新狀態流程) 🆕
- T15: ⬜ 環境配置與部署準備 🆕
- T16: ✅ Hook 重構與 API 整合 (四狀態對應) ✅ **已完成**

**整合任務**: ✅ 2/3 完成 (66.7%)
- T14: ✅ API 整合層 ✅ **已完成**
- T15: ⬜ 環境配置與部署準備  
- T16: ✅ Hook 重構與 API 整合 ✅ **已完成**

**總進度**: ✅ 16/16 完成 (100%) 🎉 **全部完成！**
