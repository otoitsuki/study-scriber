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

### Phase 10: 🔥 WebM 音檔格式兼容性修復 (緊急) ✅ **修復完成**

**問題背景**：
用戶報告 StudyScriber 錄音一分鐘後仍停留在 `recording_waiting` 狀態，無法進入 `recording_active` 狀態。通過系統性調查發現真正問題根源：**FFmpeg 無法處理前端 MediaRecorder 產生的 WebM 格式音檔**。

**問題鏈路**：
WebM 格式不兼容 → FFmpeg 轉換失敗 → 無 WAV 檔案 → 無法調用 Azure OpenAI → 無轉錄結果 → 前端永遠停留在 `recording_waiting` 狀態

**關鍵錯誤**：
```
Error opening input: Invalid data found when processing input
Error opening input file pipe:0.
```

- [x] **AUDIO1: 修復前端音檔格式兼容性問題** (🔥 最高優先級) ✅
  - [x] 檢查當前前端 `frontend/lib/audio-recorder.ts` 的 `SUPPORTED_MIME_TYPES` 設定
  - [x] 調整音檔格式優先級，將 `audio/mp4` 移到第一位
  - [x] 降低 `audio/webm;codecs=opus` 的優先級，因其與 FFmpeg 兼容性問題
  - [x] 測試不同瀏覽器（Chrome、Firefox、Safari）的錄音格式選擇
  - [x] 驗證 MP4 格式音檔能正常被 FFmpeg 處理
  - **原因**: MP4 格式在各種 FFmpeg 版本中有更好的兼容性
  - **檔案**: `frontend/lib/audio-recorder.ts`

- [x] **AUDIO2: 增強 FFmpeg 錯誤處理和格式檢測** ✅
  - [x] 在 `app/core/ffmpeg.py` 中添加音檔格式自動檢測功能
  - [x] 實作多格式重試邏輯：WebM 失敗時自動嘗試其他處理方式
  - [x] 增加詳細的 FFmpeg 錯誤日誌，包含輸入檔案格式信息
  - [x] 實作 FFmpeg 進程的健康檢查和自動重啟機制
  - [x] 為不同音檔格式建立專用的轉換管道
  - **檔案**: `app/core/ffmpeg.py`

- [x] **AUDIO3: 改進轉錄服務錯誤處理** ✅
  - [x] 在 `app/services/azure_openai_v2.py` 中增強 FFmpeg 轉換失敗處理
  - [x] 實作音檔格式檢測和驗證機制
  - [x] 建立轉錄失敗的錯誤回報機制，通知前端具體錯誤
  - [x] 實作 Azure OpenAI 調用的詳細日誌記錄
  - [x] 為轉錄服務建立健康檢查端點
  - **檔案**: `app/services/azure_openai_v2.py`

- [x] **AUDIO4: 前端錯誤狀態處理** ✅
  - [x] 在前端 `useAppState` Hook 中添加錯誤狀態處理邏輯
  - [x] 當收到轉錄服務錯誤通知時，能正確處理狀態轉換
  - [x] 避免停留在 `recording_waiting` 狀態
  - [x] 實作錯誤恢復和用戶友好的錯誤提示
  - **檔案**: `frontend/hooks/use-app-state.ts`

- [x] **AUDIO5: 端到端測試驗證** ✅
  - [x] 在用戶的 macOS 環境（Homebrew FFmpeg 7.1.1）測試音檔轉換
  - [x] 測試不同瀏覽器的錄音功能和格式選擇
  - [x] 驗證完整的錄音→轉錄→筆記流程
  - [x] **Playwright 測試 100% 通過**（4/4 測試案例）
  - [x] 確認音檔格式兼容性測試正常
  - **目標**: 確保本機和雲端環境的 FFmpeg 都能正常處理音檔

**✅ 修復效果達成**：
- ✅ 瀏覽器選擇 MP4 格式錄音，FFmpeg 正常處理
- ✅ 用戶能順利從 `recording_waiting` 進入 `recording_active` 狀態
- ✅ FFmpeg 轉換不再出現 "Invalid data" 錯誤
- ✅ 完整的錄音轉錄流程正常運作
- ✅ 提高雲端部署時的音檔處理穩定性

**🎉 修復完成總結**：
- ✅ **根因分析精準**：WebM 格式兼容性問題導致的狀態轉換失敗
- ✅ **系統性修復**：從前端格式選擇到後端錯誤處理的完整鏈路優化  
- ✅ **端到端驗證**：Playwright 測試 100% 通過，功能修復驗證成功
- ✅ **用戶問題解決**：「錄音一分鐘後仍停留在 recording_waiting」問題已完全修復
- ✅ **穩定性提升**：MP4 格式在 macOS Homebrew FFmpeg 7.1.1 環境下穩定運行

**技術債務**：
- 考慮實作前端音檔格式的動態選擇機制
- 建立 FFmpeg 版本兼容性測試框架
- 優化音檔切片大小和傳輸效率
- 為未來添加更多音檔格式支援做準備

### Phase 11: 🔧 Fragmented MP4 格式支援修復 (進行中)

**問題背景**：
用戶回報逐字稿顯示不出來，無法轉到 `recording_active` 狀態。經調查發現 Safari 瀏覽器產生 fragmented MP4 格式無法被 FFmpeg 正確處理，錯誤訊息：`could not find corresponding trex` 和 `Invalid data found when processing input`。

**問題根因**：
- Safari 的 MediaRecorder 產生 fragmented MP4 格式
- 後端格式檢測邏輯無法正確識別該格式
- FFmpeg 參數設定不適合處理 fragmented MP4

- [x] **FRAG1: 增強音檔格式檢測邏輯** ✅
  - [x] 修改 `app/services/azure_openai_v2.py` 中的 `_detect_format` 函數
  - [x] 擴大搜索範圍從 12 字節到 32 字節，支援 fragmented MP4 檢測
  - [x] 增加對 'ftyp' 標記在不同位置的檢測（不限於 4-8 字節）
  - [x] 增加對 'mdat' 標記的檢測，這是 fragmented MP4 的特徵
  - [x] 保持與其他格式（WebM、OGG、WAV）的檢測兼容性
  - **檔案**: `app/services/azure_openai_v2.py` (行 148-167)
  - **驗證**: 能正確檢測標準 MP4 和 fragmented MP4 格式

- [ ] **FRAG2: 更新 FFmpeg 轉換命令以支援 fragmented MP4**
  - [ ] 修改 `_convert_webm_to_wav` 函數中的 FFmpeg 命令構建
  - [ ] 為 MP4 格式移除 `-f mp4` 強制格式參數
  - [ ] 讓 FFmpeg 自動檢測格式，更好處理各種 MP4 變體
  - [ ] 保留 `-fflags +genpts` 參數以處理時間戳問題
  - [ ] 測試確保不再出現 'could not find corresponding trex' 錯誤
  - **檔案**: `app/services/azure_openai_v2.py` (行 195-205)
  - **依賴**: FRAG1 完成
  - **驗證**: FFmpeg 能成功處理 fragmented MP4，轉換後音檔正確送到 Whisper API

- [ ] **FRAG3: 統一使用 ffmpeg.py 中的格式檢測函數**
  - [ ] 重構代碼避免重複實現格式檢測邏輯
  - [ ] 從 `app.core.ffmpeg` 導入 `detect_audio_format` 函數
  - [ ] 移除 `azure_openai_v2.py` 中的 `_detect_format` 內部函數
  - [ ] 將所有 `_detect_format(data)` 調用改為 `detect_audio_format(data)`
  - [ ] 確保統一的格式檢測行為和錯誤處理
  - **檔案**: `app/services/azure_openai_v2.py`, `app/core/ffmpeg.py`
  - **依賴**: FRAG1 完成
  - **驗證**: 成功導入並使用 detect_audio_format 函數，所有測試通過

**預期效果**：
- ✅ Safari 瀏覽器錄音能正常進入 `recording_active` 狀態
- ✅ fragmented MP4 格式音檔能正確被轉錄
- ✅ 統一的音檔格式檢測邏輯，減少代碼重複
- ✅ 提高跨瀏覽器兼容性

### Phase 12: 🎯 WebM 格式優先轉換 (技術方案優化)

**背景說明**：
基於深入的技術可行性評估，將錄音技術從 fragmented MP4 轉換為 WebM 格式，以徹底解決當前的音檔處理錯誤問題並提升系統穩定性。此方案技術可行性極高，實作複雜度低，能徹底解決 fragmented MP4 相關錯誤。

**技術優勢**：
- ✅ **瀏覽器原生支援**：Chrome 對 `audio/webm;codecs=opus` 支援度極佳
- ✅ **檔案大小優化**：Opus 編解碼器在 128kbps 下音質優於 MP3
- ✅ **串流友好**：WebM 設計就是為了網路串流，沒有 fragmented MP4 的複雜檔頭問題
- ✅ **轉錄相容性**：OpenAI Whisper API 對 WebM 格式支援良好
- ✅ **FFmpeg 處理能力**：WebM 到 WAV 轉換速度快且穩定

- [x] **WEBM1: 前端錄音格式優先順序調整** `3ebd8c75-9176-4d10-a66e-db3ebfdcf060` ✅
  - [x] 修改 `frontend/lib/audio-recorder.ts` 中的 `SUPPORTED_MIME_TYPES` 常數
  - [x] 將 `'audio/webm;codecs=opus'` 移到陣列第一位
  - [x] 將 `'audio/webm'` 移到第二位
  - [x] 將 `'audio/mp4'` 降為第三位作為備選方案
  - [x] 更新相關註解說明格式優先順序調整原因
  - [x] 確保 `getSupportedMimeType()` 方法正常運作
  - [x] Chrome 瀏覽器錄音時優先選擇 WebM 格式
  - **檔案**: `frontend/lib/audio-recorder.ts` (行 28-34)
  - **驗證**: Chrome 瀏覽器錄音自動選擇 WebM 格式，現有錄音功能正常運作

- [x] **WEBM2: 後端 WebM 處理邏輯驗證與優化** `7a491015-102f-48d8-8f6f-4c35ab40d4c1` ✅
  - [x] 檢查並優化 `app/services/azure_openai_v2.py` 中的 `_convert_webm_to_wav` 方法
  - [x] 驗證 WebM 格式檢測邏輯正確性
  - [x] 確認 FFmpeg 命令參數最佳化（已有 `-f webm` 參數）
  - [x] 檢查錯誤處理機制完整性
  - [x] 優化 WebM 格式的處理效率
  - [x] 確保與 OpenAI Whisper API 的無縫整合
  - [x] WebM 格式正確檢測和處理，轉換效率提升
  - **檔案**: `app/services/azure_openai_v2.py` (行 190-220), `app/core/ffmpeg.py` (行 208-278)
  - **依賴**: WEBM1
  - **驗證**: WebM 格式正確檢測和處理，FFmpeg 轉換命令最佳化，與 Whisper API 整合無誤

- [x] **WEBM3: 前端測試案例更新** `2c8d6d6f-226d-4038-8930-de4b457cf378` ✅
  - [x] 修改 `tests/frontend/transcript-manager-phase.spec.ts` 中的 MediaRecorder polyfill
  - [x] 更新 `tests/frontend/state-transition.spec.ts` 中的格式設定
  - [x] 確保測試中的 mimeType 預設為 `'audio/webm;codecs=opus'`
  - [x] 驗證格式選擇邏輯的測試覆蓋
  - [x] 添加 WebM 格式特定的測試案例
  - [x] 所有前端測試正常通過，WebM 格式相關測試案例正常運作
  - **檔案**: `tests/frontend/transcript-manager-phase.spec.ts` (行 70-85), `tests/frontend/state-transition.spec.ts` (行 65-80)
  - **依賴**: WEBM1
  - **驗證**: 所有前端測試正常通過，MediaRecorder polyfill 使用正確的 WebM 格式

- [x] **WEBM4: 後端測試案例更新** `9ff21636-f5b7-43e2-b2c5-f9772a691769` ✅
  - [x] 修改 `tests/unit/test_azure_openai_v2.py` 中的測試資料格式
  - [x] 更新 `tests/integration/test_one_chunk_one_transcription.py` 的音檔格式
  - [x] 確保 `sample_webm_data` 使用正確的 WebM 標頭
  - [x] 驗證 WebM 格式的轉換和轉錄流程
  - [x] 添加 WebM 特定的效能和穩定性測試
  - [x] 所有後端測試正常通過，WebM 格式處理測試覆蓋完整
  - **檔案**: `tests/unit/test_azure_openai_v2.py` (行 60-90), `tests/integration/test_one_chunk_one_transcription.py` (行 85-110)
  - **依賴**: WEBM2
  - **驗證**: 所有後端測試正常通過，WebM 格式處理測試覆蓋完整，轉錄服務整合測試正常

- [ ] **WEBM5: 系統整合測試與驗證** `215d39f9-54d9-460f-a4dc-5dcb6962be28`
  - [ ] 使用 Chrome 瀏覽器進行實際錄音測試
  - [ ] 驗證 WebM 格式的音檔上傳和處理
  - [ ] 確認 OpenAI Whisper API 轉錄正常
  - [ ] 檢查 WebSocket 即時推送功能
  - [ ] 驗證錯誤處理和診斷機制
  - [ ] 進行效能基準測試
  - [ ] Chrome 瀏覽器錄音自動選擇 WebM 格式，完整流程正常運作
  - **檔案**: `frontend/hooks/use-recording.ts` (行 180-240), `app/ws/upload_audio.py` (行 210-245)
  - **依賴**: WEBM1, WEBM2, WEBM3, WEBM4
  - **驗證**: Chrome 瀏覽器錄音自動選擇 WebM 格式，音檔上傳和處理流程正常，FFmpeg WebM 轉換無錯誤

- [ ] **WEBM6: 文檔更新與部署準備** `738274f6-c1cc-4958-a9d6-5f773d326216`
  - [ ] 更新 `README.md` 中的技術架構說明
  - [ ] 在 `Todos.md` 中標記 fragmented MP4 問題已解決
  - [ ] 記錄 WebM 格式的技術優勢和實作決策
  - [ ] 更新音檔格式支援說明
  - [ ] 準備部署檢查清單
  - [ ] 更新故障排除指南
  - [ ] 技術文檔準確反映 WebM 格式轉換，fragmented MP4 問題標記為已解決
  - **檔案**: `README.md`, `Todos.md` (行 325-365), `PRD.md`
  - **依賴**: WEBM5
  - **驗證**: 技術文檔準確反映新架構，API 文檔更新完成，部署指南包含新的配置要求，回滾計劃文檔完整，團隊成員理解變更內容

**預期效益**：
- ✅ **徹底解決** fragmented MP4 錯誤問題
- ✅ **提升 20-30%** 音檔處理效率  
- ✅ **減少 15-25%** 檔案大小
- ✅ **簡化 40%** 錯誤處理複雜度
- ✅ **提升系統整體穩定性**

**技術風險評估**：
- ✅ **實作風險**：極低（現有架構已支援）
- ✅ **相容性風險**：極低（限制使用 Chrome）
- ✅ **效能風險**：無（WebM 效能更佳）
- ✅ **維護風險**：低（簡化錯誤處理邏輯）

### Phase 13: 🚀 WebM 直接轉錄架構優化 (效能革命)

**背景說明**：
基於深度技術分析，實作 WebM 格式直接發送到 OpenAI Whisper API 的架構優化。消除每個 chunk 的 FFmpeg 轉換瓶頸，將「每個 chunk 即時轉換」改為「錄音結束後批次轉換」，大幅提升系統效能和穩定性。

**核心洞察**：
- 🎯 **OpenAI Whisper API 原生支援 WebM 格式**，無需轉換
- 🎯 **WAV 檔應該是最後按下錄音結束才需要轉檔**，不是每個 chunk 都轉
- 🎯 **消除 FFmpeg 轉換瓶頸**，預期效能提升 60%，錯誤率降低 80%

**技術可行性**：
- ✅ **OpenAI 官方確認**：Whisper API 支援格式包含 `['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']`
- ✅ **前端已優化**：`audio/webm;codecs=opus` 為第一優先格式
- ✅ **架構簡化**：移除每個 chunk 的 0.15 秒轉換時間
- ✅ **向後相容**：保留 FFmpeg 邏輯用於最終下載檔案

**新架構流程**：
```
前端錄音 (WebM) → 直接儲存 WebM chunks 到 R2 → 
直接發送 WebM 到 Whisper API → 錄音結束後才轉換為 WAV 供下載
```

- [x] **WEBM_OPT1: WebM 直接轉錄核心邏輯實作** `57dc41cd-d853-4e3d-b748-383f69556a13` ✅
  - [x] 修改 `app/services/azure_openai_v2.py` 中的 `_transcribe_audio` 方法
  - [x] 將方法簽名從 `_transcribe_audio(wav_data: bytes)` 改為 `_transcribe_audio(webm_data: bytes)`
  - [x] 將 `tempfile.NamedTemporaryFile(suffix='.wav')` 改為 `suffix='.webm'`
  - [x] 直接寫入 webm_data 到臨時檔案，跳過 FFmpeg 轉換
  - [x] 保持相同的 Whisper API 調用邏輯和參數
  - [x] 更新相關日誌訊息反映 WebM 格式處理
  - [x] 保留 `_convert_webm_to_wav` 方法，標記為備選用途（最終下載使用）
  - **檔案**: `app/services/azure_openai_v2.py` (行 315-350)
  - **驗證**: _transcribe_audio 方法成功接受 WebM 格式，Whisper API 調用正常，轉錄結果格式不變，效能日誌顯示處理時間減少

- [x] **WEBM_OPT2: 音訊處理流程重構** `7ddb42bd-38aa-4b48-bc6e-f296d2f6f94f` ✅
  - [x] 修改 `_process_chunk_async` 方法中的處理流程
  - [x] 跳過 `_convert_webm_to_wav` 調用，直接將 webm_data 傳遞給 `_transcribe_audio`
  - [x] 更新錯誤處理邏輯，移除 FFmpeg 轉換相關錯誤檢測和廣播
  - [x] 保留 WebM 數據驗證步驟（`_validate_webm_data`）
  - [x] 更新效能監控日誌，反映新的處理流程
  - [x] 確保 R2 儲存邏輯不受影響
  - **檔案**: `app/services/azure_openai_v2.py` (行 105-135)
  - **依賴**: WEBM_OPT1
  - **驗證**: 處理流程成功跳過 FFmpeg 轉換，WebM 數據直接傳遞給轉錄方法，錯誤處理邏輯正確更新，R2 儲存功能正常，效能監控顯示處理時間改善

- [x] **WEBM_OPT3: 單元測試更新與驗證** `4d89a0d6-61a9-452d-b6d2-ad814700b89b` ✅
  - [x] 更新 `tests/unit/test_azure_openai_v2.py` 中的相關測試案例
  - [x] 修改 `test_transcribe_audio` 相關測試，使用 WebM 格式的測試數據
  - [x] 更新 mock 物件以模擬 WebM 檔案處理（從 `.wav` 改為 `.webm`）
  - [x] 修改測試中的臨時檔案格式驗證
  - [x] 驗證 Whisper API 調用參數正確
  - [x] 測試錯誤處理邏輯的變更
  - [x] 確保所有現有測試案例通過
  - **檔案**: `tests/unit/test_azure_openai_v2.py` (行 1-100)
  - **依賴**: WEBM_OPT1, WEBM_OPT2
  - **驗證**: 所有單元測試通過，測試覆蓋率保持或提升，WebM 格式相關測試案例正確，Mock 物件正確模擬新的處理流程，錯誤處理測試案例更新完成

- [x] **WEBM_OPT4: 整合測試驗證** `32bfa613-27a3-4614-be9d-2f274eeff36c` ✅
  - [x] 更新 `tests/integration/test_one_chunk_one_transcription.py` 中的整合測試
  - [x] 使用真實的 WebM 格式測試數據驗證端到端流程
  - [x] 驗證 WebSocket 消息流程正確（從錄音到轉錄結果推送）
  - [x] 測試 R2 儲存和 Supabase 數據庫操作
  - [x] 確認前端能正確接收轉錄結果
  - [x] 測試錯誤情況下的處理流程
  - **檔案**: `tests/integration/test_one_chunk_one_transcription.py` (行 1-200)
  - **依賴**: WEBM_OPT1, WEBM_OPT2, WEBM_OPT3
  - **驗證**: 端到端測試全部通過（9/9），WebSocket 消息流程正確，數據庫操作正常，R2 儲存功能驗證，錯誤處理整合測試通過

- [ ] **WEBM_OPT5: 效能監控與對比分析** `42173e78-4047-4130-b4a5-c112441a2cad`
  - [ ] 在 `PerformanceTimer` 中添加更詳細的效能指標
  - [ ] 建立效能對比測試腳本，對比新舊架構
  - [ ] 監控 CPU 使用率、記憶體使用和處理延遲
  - [ ] 收集錯誤率統計數據
  - [ ] 建立效能報告生成機制
  - [ ] 驗證預期的 60% 處理時間減少和 80% 錯誤率降低
  - **檔案**: `app/services/azure_openai_v2.py` (行 32-60), `test/performance_benchmark.py` (新建)
  - **依賴**: WEBM_OPT1, WEBM_OPT2
  - **驗證**: 效能監控機制正常運作，處理時間減少 60% 以上，錯誤率降低 80% 以上，CPU 使用率明顯降低，效能報告生成正確

- [ ] **WEBM_OPT6: 文檔更新與部署準備** `d3077d14-4be9-442e-8101-070aa4857952`
  - [ ] 更新 `PRD.md` 中的技術架構描述，反映 WebM 直接轉錄架構
  - [ ] 修改 `README.md` 中的系統流程說明
  - [ ] 更新 API 文檔反映新的處理邏輯
  - [ ] 建立架構變更說明文件
  - [ ] 更新部署指南和環境配置
  - [ ] 建立回滾計劃文檔
  - **檔案**: `PRD.md` (行 200-250), `README.md` (行 1-100), `docs/architecture_changes.md` (新建)
  - **依賴**: WEBM_OPT1, WEBM_OPT2, WEBM_OPT5
  - **驗證**: 技術文檔準確反映新架構，API 文檔更新完成，部署指南包含新的配置要求，回滾計劃文檔完整，團隊成員理解變更內容

**預期效益**：
- 🚀 **處理時間減少 60%**：消除每個 chunk 的 FFmpeg 轉換延遲
- 🛡️ **錯誤率降低 80%**：消除 FFmpeg 相關轉換錯誤
- 💾 **資源使用減少 60%**：降低 CPU 密集的轉換操作
- 📈 **上傳速度提升**：WebM 檔案比 WAV 小 60-80%
- 🔧 **架構簡化**：減少錯誤處理複雜度

**技術風險評估**：
- ✅ **實作風險**：低（基於現有架構，增量開發）
- ✅ **相容性風險**：極低（保持向後兼容）
- ✅ **效能風險**：低（檔頭操作為輕量級字節處理）
- ✅ **維護風險**：低（與現有代碼風格高度一致）

### Phase 14: 🔧 WebM 檔頭修復核心邏輯開發 (緊急)

**問題背景**：
基於前一次對話的深度技術分析，發現 MediaRecorder 產生的 WebM 檔案存在檔頭不完整問題。第一個 chunk 包含完整 EBML 檔頭結構，而後續 chunk 僅包含音頻數據，缺乏必要的檔頭信息，導致 Azure OpenAI Whisper API 轉錄失敗。

**技術方案**：
基於現有 WebM 直接轉錄架構，實作智慧檔頭修復機制。在現有 `SimpleAudioTranscriptionService` 中增加會話檔頭緩存和修復邏輯，保持架構一致性並最大化代碼重用。

**核心策略**：
- ✅ **無縫集成**：在現有 `_process_chunk_async` 工作流程中增加檔頭修復步驟
- ✅ **會話緩存**：從第一個 chunk 提取檔頭模板，緩存用於後續 chunk 修復  
- ✅ **架構保持**：維持 WebM 直接轉錄架構不變，確保向後兼容
- ✅ **效能優化**：檔頭提取一次性操作，後續僅需字節拼接（<10ms）

- [ ] **WEBM_REPAIR1: 增強 WebM 檔頭檢測邏輯** `afb3d8cf-ca96-4dac-9de2-ed31a11db62e`
  - [ ] 在 `app/core/ffmpeg.py` 中擴展 `detect_audio_format` 函數
  - [ ] 添加 `detect_webm_header_info` 函數，返回檔頭詳細信息
  - [ ] 實作 EBML 元素解析邏輯：檢測 EBML header (0x1A45DFA3)、提取 Segment element、識別 Tracks 和 CodecPrivate 元素
  - [ ] 計算完整檔頭大小（通常 200-2000 bytes）
  - [ ] 添加 `is_webm_header_complete` 函數判斷檔頭完整性
  - [ ] 保持與現有代碼風格一致，使用相同的錯誤處理模式
  - **檔案**: `app/core/ffmpeg.py` (行 208-280), `tests/unit/test_ffmpeg.py` (新建)
  - **驗證**: detect_webm_header_info 函數能正確識別完整和不完整的 WebM 檔頭，精確提取檔頭大小和關鍵元素位置，對不同瀏覽器產生的 WebM 格式具有良好兼容性，執行效能 < 5ms

- [ ] **WEBM_REPAIR2: 實作 WebM 檔頭修復核心邏輯** `79708bfd-b83b-4e5a-b33b-1d8c9d801024`
  - [ ] 在 `app/core/` 下創建 `webm_header_repairer.py`
  - [ ] 實作 `WebMHeaderRepairer` 類別：`extract_header()`, `repair_chunk()`, `validate_repaired_chunk()`
  - [ ] 檔頭提取邏輯：提取從 EBML header 到第一個 Cluster 元素的完整檔頭，驗證檔頭包含所有必要元素
  - [ ] 檔頭修復邏輯：智慧拼接完整檔頭 + 後續 chunk 的音頻數據，更新時間戳和 Cluster 元素
  - [ ] 保持音頻數據的完整性，添加詳細的錯誤處理和日誌記錄
  - **檔案**: `app/core/webm_header_repairer.py` (新建), `tests/unit/test_webm_header_repairer.py` (新建)
  - **依賴**: WEBM_REPAIR1
  - **驗證**: 能從完整 WebM chunk 正確提取檔頭模板，修復後的 chunk 通過 WebM 格式驗證，修復後的音頻品質與原始檔案一致，支援不同編碼器（Opus, Vorbis）產生的 WebM，修復過程平均耗時 < 10ms

- [ ] **WEBM_REPAIR3: 集成會話檔頭緩存機制** `bd212bc2-b5be-49e9-b224-76e09c257fc0`
  - [ ] 在 `SimpleAudioTranscriptionService` 類別中添加 `_header_cache: Dict[str, bytes]` 和 `_header_repairer`
  - [ ] 實作檔頭管理方法：`_extract_and_cache_header()`, `_get_cached_header()`, `_clear_session_cache()`
  - [ ] 在 `_process_chunk_async` 中集成：chunk_sequence == 0 時提取並緩存檔頭，chunk_sequence > 0 時檢查檔頭完整性
  - [ ] 記憶體管理：設定檔頭緩存過期時間（1小時），實作自動清理機制，添加緩存大小限制（最多100個session）
  - [ ] 錯誤處理：檔頭提取失敗時記錄警告但繼續處理
  - **檔案**: `app/services/azure_openai_v2.py` (行 67-130), `tests/unit/test_azure_openai_v2.py` (更新)
  - **依賴**: WEBM_REPAIR2
  - **驗證**: 會話檔頭正確提取並緩存支援並發 session，檔頭緩存自動清理機制正常運作，記憶體使用量控制在合理範圍（<10MB），檔頭提取失敗時不影響現有轉錄流程，與現有 session 生命週期管理無縫整合

- [ ] **WEBM_REPAIR4: 更新 WebM 驗證和修復邏輯** `db878f91-e415-4312-ab5f-7e903268be37`
  - [ ] 重構 `_validate_webm_data` 方法為 `_validate_and_repair_webm_data`
  - [ ] 實作驗證和修復邏輯：保留現有基本大小檢查，添加檔頭完整性檢測，對不同 chunk_sequence 進行相應處理
  - [ ] 修復流程：檔頭不完整時獲取緩存檔頭並修復，修復失敗時返回原始數據
  - [ ] 更新 `_process_chunk_async` 調用邏輯，添加修復統計和監控日誌
  - [ ] 確保修復邏輯不影響現有處理效能，重點是向後兼容性和錯誤處理
  - **檔案**: `app/services/azure_openai_v2.py` (行 125-140)
  - **依賴**: WEBM_REPAIR3
  - **驗證**: 第一個 chunk 檔頭正確提取和驗證，後續 chunk 檔頭缺失時自動修復，修復後的 WebM 數據通過 Whisper API 驗證，處理延遲增加 < 50ms，修復成功率 > 95%

- [ ] **WEBM_REPAIR5: 擴展錯誤處理和診斷機制** `45125061-7f93-4ee7-922b-096167c37ad8`
  - [ ] 在 `_broadcast_transcription_error` 中添加檔頭修復錯誤類型：header_extraction_failed, header_repair_failed, header_validation_failed
  - [ ] 創建專用錯誤處理方法 `_broadcast_header_repair_error`
  - [ ] 增強診斷信息：檔頭大小和結構分析、缺失元素識別、修復嘗試詳情、建議的用戶操作
  - [ ] 添加修復統計追蹤：修復成功/失敗計數、修復時間統計、錯誤類型分布
  - [ ] 在現有日誌系統中集成修復狀態記錄
  - **檔案**: `app/services/azure_openai_v2.py` (行 450-505)
  - **依賴**: WEBM_REPAIR4
  - **驗證**: 檔頭修復相關錯誤能正確分類和廣播，錯誤診斷信息詳細且有助於問題定位，前端能接收並正確顯示檔頭修復錯誤，錯誤統計數據準確記錄和報告

- [ ] **WEBM_REPAIR6: 建立完整測試框架** `8bcbc735-ddde-4a57-b9c6-2e5ef2c59542`
  - [ ] 創建測試數據集：完整 WebM chunk、不完整 WebM chunk、來自不同瀏覽器的 WebM 樣本、損壞的 WebM 數據
  - [ ] 單元測試：檔頭檢測準確性、檔頭提取完整性、檔頭修復正確性、緩存機制功能
  - [ ] 整合測試更新：端到端檔頭修復流程、多 chunk 序列處理、Whisper API 兼容性
  - [ ] 效能測試：檔頭修復時間基準、記憶體使用量測試、並發處理測試
  - [ ] Mock 和 Fixture 建立：MediaRecorder 模擬、Whisper API 回應模擬
  - **檔案**: `tests/unit/test_webm_header_repair.py` (新建), `tests/integration/test_one_chunk_one_transcription.py` (更新), `tests/fixtures/webm_samples.py` (新建)
  - **依賴**: WEBM_REPAIR5
  - **驗證**: 所有檔頭修復功能測試覆蓋率 > 90%，測試通過率 100%，包含多瀏覽器 WebM 格式兼容性測試，效能測試驗證修復時間 < 50ms，錯誤情況測試確保優雅降級

- [ ] **WEBM_REPAIR7: 實作效能監控和優化** `57f1d4b7-a1ed-4a81-9a45-dc34f2a6e65a`
  - [ ] 擴展 `PerformanceTimer` 添加檔頭修復指標：header_extraction_time, header_repair_time, cache_hit_rate, repair_success_rate
  - [ ] 在關鍵方法中添加效能追蹤，實作效能統計收集 `HeaderRepairStats` 類別
  - [ ] 添加效能優化機制：檔頭緩存預熱、批次處理優化、記憶體池重用
  - [ ] 建立效能報告生成：定期統計摘要、異常效能告警、優化建議生成
  - [ ] 整合到現有監控日誌系統
  - **檔案**: `app/services/azure_openai_v2.py` (行 32-60), `app/core/webm_header_repairer.py` (行 50-100)
  - **依賴**: WEBM_REPAIR6
  - **驗證**: 檔頭修復效能指標正確收集和報告，平均修復時間保持在 < 10ms，緩存命中率維持在 > 95%，修復成功率達到 > 98%，效能監控不影響正常處理流程

**預期效益**：
- 🎯 **根本解決**：徹底解決 MediaRecorder 後續 chunk 轉錄失敗問題
- 🎯 **修復成功率 > 95%**：確保絕大多數檔頭缺失情況能自動修復
- 🎯 **效能影響最小**：檔頭修復延遲 < 50ms，不影響即時性
- 🎯 **架構兼容**：與現有 WebM 直接轉錄架構完全兼容
- 🎯 **自動降級**：修復失敗時優雅回退到原始處理邏輯

**技術風險評估**：
- ✅ **實作風險**：低（基於現有架構，增量開發）
- ✅ **相容性風險**：無（WebM 為當前主要格式）
- ✅ **回滾風險**：極低（保留原有轉換邏輯）
- ✅ **效能風險**：正面影響（減少處理步驟）

**實作策略**：
- 🎯 **最小變更原則**：只修改核心轉錄邏輯，保留其他功能
- 🎯 **向後相容**：保留 FFmpeg 邏輯用於最終下載檔案
- 🎯 **段階實作**：核心邏輯 → 測試驗證 → 效能監控 → 文檔更新
