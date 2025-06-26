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

### Phase 6: 資料庫重構（Supabase 移除 SQLAlchemy）

- [x] **DBR1: Hotfix – 測試環境設定與環境變數**
  - [x] 於 `pytest.ini` 設定 `DB_MODE=supabase`，並加入假 `SUPABASE_URL`、`SUPABASE_KEY`，確保測試收集不失敗。
- [x] **DBR2: Refactor – 移除 database.py SQLAlchemy 依賴**
  - [x] 重構 `app/db/database.py` 僅使用 `get_supabase_client`，刪除 `create_engine` 與 `AsyncSession` 相關程式。
- [x] **DBR3: Cleanup – 移除 ORM imports**
  - [x] 刪除 `app/ws/upload_audio.py` 中不再使用的 `sqlalchemy` imports。
- [x] **DBR4: Update – 服務層統一 Supabase Client**
  - [x] 更新 `app/services/*` 模組，去除 `get_async_session` 或 `session.execute` 等 SQLAlchemy 用法。
- [x] **DBR5: Test – 建立 Supabase Mock Fixtures**
  - [x] 在 `tests/conftest.py` 建立 `supabase_client_fixture`，mock `table()` 呼叫與回傳，避免實際 API 連線。
- [x] **DBR6: Dependency Cleanup – 移除 SQLAlchemy 相關套件**
  - [x] 更新 `pyproject.toml` 與 `uv.lock`，刪除 `sqlalchemy`、`asyncpg` 依賴。
- [x] **DBR7: Verification – 全域測試與 CI**
  - [x] 執行 `make test`、`make test-report` 並更新 CI pipeline，確保所有測試通過且 CI 綠燈。
- [ ] **DBR8: Docs – 更新 README 與 DB_Refactor_Report**
  - [ ] 更新文件以反映 Supabase 遷移完成並移除 SQLAlchemy 步驟。

### Phase 7: 全域測試修復 (CI/CD)

- [x] **CI1: 修正整合測試 - Whisper API Mock**
  - [x] 更新 `test_transcription_service_full_process`，確保 Whisper API 的 mock 回傳帶 `text` 屬性的物件，修復 `.strip()` 錯誤。
- [x] **CI2: 修正整合測試 - Supabase Key 格式**
  - [x] 更新 `tests/conftest.py` 中的 `SUPABASE_KEY` 為合法的假 JWT 格式，修復 `Invalid API key` 錯誤。
- [x] **CI3: 修正單元測試 - Fixture 誤用**
  - [x] 更新 `test_transcribe_audio_success`，將 `mock_writable_tempfile` 以參數注入，而非直接呼叫。
- [x] **CI4: 修正單元測試 - 全域變數狀態**
  - [x] 更新 `test_initialize_transcription_service_v2_success`，直接檢查 `azure_openai_v2._transcription_service_v2` 的狀態。
- [x] **CI5: 修正單元測試 - Mock 行為**
  - [x] 更新 `test_send_message_disconnected`，驗證 `send_text` 有被呼叫，使其與程式碼邏輯一致。

### Phase 8: 測試最終修復

- [x] **CI6: 修正整合測試 - Whisper Strip 兼容**
  - [x] 更新 `test_transcription_service_full_process`，改以字串 mock Whisper 回傳，或在 Service 層容錯支援 text 屬性。
- [x] **CI7: 修正單元測試 - mock_writable_tempfile callable**
  - [x] 調整 `mock_writable_tempfile` 類別，使 `NamedTemporaryFile` patch 可以被呼叫或改回文字字串回傳。
- [x] **CI8: 修正整合測試 - ws_phase 500**
  - [x] 檢查 `/api/session` 500 來源，於測試中補 Mock `supabase.table(...).select().eq().limit().execute()` call for active session 查詢；或在 API 實作容錯。
- [x] **CI9: 修正 ws_phase_messages Session Insert mock**
  - [x] 在 `test_ws_phase_messages` 中，讓 `supabase.table("sessions").insert(...).execute().data` 回傳含 `id` 的 dict，並 mock `notes` 表 insert，避免 500。
- [x] **CI10: 修正 NamedTemporaryFile 可呼叫行為**
  - [x] 更新 `test_transcribe_audio_success`，將 `tempfile.NamedTemporaryFile` patch 成可呼叫 factory（返回 context manager），解決 `'MockTempFile' object is not callable`。

### Phase 9: 🚨 錄音狀態轉換修復 (緊急)

**問題描述**：按下錄音鍵後，應用程式一直停留在 `recording_waiting` 狀態，無法轉換到 `recording_active` 狀態來顯示逐字稿。

**核心問題**：前端狀態映射邏輯中的 `transcriptsPresent` 條件未正確觸發，導致 `recording_waiting` → `recording_active` 狀態轉換失敗。

- [x] **FIX1: 建立狀態轉換除錯機制**
  - [x] 在 `frontend/hooks/use-app-state.ts` 的 `mapBackendToFrontendState` 函數中添加詳細日誌
  - [x] 在 `TranscriptManager` 中增強 WebSocket 訊息追蹤
  - [x] 在 `useTranscript` 和 `useRecording` hooks 中添加逐字稿接收日誌
  - [x] 添加前端狀態變化的完整追蹤鏈
  - **檔案**: `frontend/hooks/use-app-state.ts`, `frontend/lib/transcript-manager.ts`, `frontend/hooks/use-transcript.ts`, `frontend/hooks/use-recording.ts`

- [x] **FIX2: 修復雙重逐字稿接收路徑問題**
  - [x] 移除 `use-app-state.ts` 中 `startRecording` 的重複 `transcript.connect()` 調用
  - [x] 統一使用 `useRecording` hook 管理逐字稿接收，避免與 `useTranscript` 競爭
  - [x] 修正狀態同步邏輯中的 `transcriptsPresent` 計算，只依賴單一逐字稿來源
  - [x] 確保 TranscriptManager 監聽器不會重複添加到同一個 sessionId
  - **檔案**: `frontend/hooks/use-app-state.ts`, `frontend/lib/transcript-manager.ts`

- [x] **FIX3: 優化 WebSocket 連線時序和穩定性**
  - [x] 確保 WebSocket 連線建立順序：先建立連線，再開始錄音
  - [x] 改善 TranscriptManager 的連線狀態管理和重連機制
  - [x] 修正心跳機制和連線就緒檢測
  - [x] 確保錄音開始前 WebSocket 連線已完全建立
  - **檔案**: `frontend/lib/transcript-manager.ts`, `frontend/hooks/use-recording.ts`

- [x] **FIX4: 驗證後端轉錄推送機制**
  - [x] 檢查 `app/ws/transcript_feed.py` 的 WebSocket 廣播機制
  - [x] 驗證 `app/services/azure_openai_v2.py` 的轉錄服務推送邏輯
  - [x] 確保轉錄結果正確推送到前端 WebSocket 連線
  - [x] 檢查 ConnectionManager 的 session 連線管理
  - [x] 修復未定義變數錯誤並增強日誌追蹤
  - **檔案**: `app/ws/transcript_feed.py`, `app/services/azure_openai_v2.py`

- [x] **FIX5: 端到端測試和功能驗證**
  - [x] 使用現有測試工具驗證修復效果
    - [x] 執行 `test/websocket_push_test.py` 驗證 WebSocket 推送
    - [x] 使用 `test/frontend_debug.html` 檢查前端 WebSocket 接收
    - [x] 執行 `tests/frontend/state-transition.spec.ts` Playwright 測試
  - [x] 建立完整的狀態轉換測試案例
  - [x] 驗證 `recording_waiting` → `recording_active` 轉換正常
  - [x] 確保「邊錄邊轉錄」功能完全正常運作
  - **檔案**: `test/websocket_push_test.py`, `test/frontend_debug.html`, `tests/frontend/state-transition.spec.ts`

**✅ 修復成果達成**：
- ✅ 錄音按鈕按下後能正常進入 `recording_waiting` 狀態
- ✅ 收到第一段逐字稿後能正確轉換到 `recording_active` 狀態
- ✅ 逐字稿能即時顯示在 TranscriptPane 中
- ✅ 整個「邊錄邊轉錄」流程運作順暢
- ✅ **Playwright 測試完全通過，功能修復驗證成功**

**🎉 修復完成總結**：
- ✅ **核心問題解決**：修復了雙重逐字稿接收路徑導致的狀態轉換問題
- ✅ **統一管理機制**：逐字稿現在統一由 `useRecording` hook 管理，避免競爭
- ✅ **WebSocket 穩定性**：優化了連線時序和心跳機制
- ✅ **完整測試驗證**：Playwright 端到端測試通過，確認功能正常
- ✅ **除錯機制建立**：完善的日誌系統便於未來維護

**技術債務**：
- ✅ ~~考慮重構雙重逐字稿管理機制，統一為單一來源~~ **已完成**
- ✅ ~~優化 WebSocket 連線管理，提升穩定性~~ **已完成**
- ✅ ~~建立更完善的狀態轉換測試覆蓋率~~ **已完成**

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
    - [x] 拆分為專用 hooks: `useSession`, `useRecording`, `useNotes`
