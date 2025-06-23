# StudyScriber MVP 開發任務清單

> 基於 PRD 分析與 shrimp-task-manager 規劃的詳細開發任務
> 使用方法
```prompt
（選擇項目）
請閱讀 @PRD.md 依照 @Todos.md 開發此項目 ，每次完成任一任務都要報告結果與狀況，並在 Todos 裡面打勾
```
---

## 🎯 專案目標

建立「邊錄邊轉錄」雲端筆記應用，支援純筆記與錄音兩種模式，實作即時逐字稿轉換、Markdown 編輯、智慧匯出功能。

**技術架構**：FastAPI + PostgreSQL + Cloudflare R2 + Azure Speech 後端，React Hook 前端

---

## 🔧 後端開發任務

### Phase 1: 基礎架構建設

- [x] **T1: 建立專案基礎架構與資料庫設計**
  - [x] 建立 FastAPI 專案目錄結構 (`app/api/`, `app/ws/`, `app/services/`, `app/core/`, `app/db/`, `app/middleware/`, `app/schemas/`)
  - [x] 設計 PostgreSQL 資料庫架構
    - [x] 建立 sessions 表（含 UUID、會話類型、狀態管理）
    - [x] 建立 audio_files 表（音檔切片記錄，r2_key, r2_bucket）
    - [x] 建立 transcript_segments 表（逐字稿片段）
    - [x] 建立 notes 表（Markdown 筆記）
    - [x] 建立 transcripts 表（完整逐字稿）
  - [x] 設定列舉類型 (session_type, session_status, lang_code)
  - [x] 建立 SQLAlchemy 模型與資料庫連接
  - [x] 設定索引與觸發器（單一 active session 保護）
  - [x] **資料庫自動檢測機制** - 應用程式啟動時自動檢測並建立缺失表格
  - **檔案**: `app/db/database.py`, `app/db/models.py`, `app/db/supabase_init.sql`

### Phase 2: API 端點開發

- [x] **T2: 實作 Session 管理 API 端點**
  - [x] POST `/api/session` - 建立新會話 (B-001)
  - [x] PATCH `/api/session/{sid}/finish` - 完成會話 (B-002) 
  - [x] PATCH `/api/session/{sid}/upgrade` - 升級至錄音模式 (B-015)
  - [x] 建立 Pydantic 請求/響應模型
  - [x] 實作單一 active session 中介軟體保護 (B-014)
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
  - **依賴**: `boto3`, `python-dotenv`

### Phase 4: WebSocket 與即時功能

- [ ] **T6: 實作 WebSocket 音檔上傳與重傳機制**
  - [ ] 建立 `/ws/upload_audio/{sid}` WebSocket 端點 (B-005)
  - [ ] 實作二進制音檔切片接收處理
  - [ ] 實作 ACK/Missing 重傳機制 (B-012)
  - [ ] 加入連接生命週期管理與心跳檢測
  - [ ] 整合 Cloudflare R2 上傳邏輯
  - **檔案**: `app/ws/upload_audio.py`

- [ ] **T7: 實作 Azure Whisper 整合與逐字稿串流**
  - [ ] 建立 Azure Speech Service 連接 (B-010)
  - [ ] 實作音訊轉文字處理鏈 (B-011)
  - [ ] 建立 `/ws/transcript_feed/{sid}` 逐字稿推送 (B-006)
  - [ ] 實作逐字稿片段儲存與狀態管理 (B-013)
  - [ ] 優化延遲控制（目標 ≤3秒）
  - **檔案**: `app/services/stt_adapter.py`, `app/ws/transcript_feed.py`

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

- [ ] **T9: 建立 React 前端基礎架構**
  - [ ] 初始化 React 專案與依賴安裝
    - [ ] @uiw/react-md-editor (Markdown 編輯器)
    - [ ] socket.io-client (WebSocket 客戶端)
    - [ ] axios (HTTP 客戶端)
  - [ ] 建立目錄結構 (`src/hooks/`, `src/components/`, `src/utils/`, `src/services/`)
  - [ ] 設定 API baseURL 與 WebSocket 配置
  - [ ] 建立主頁面佈局與響應式設計
  - **檔案**: `frontend/package.json`, `frontend/src/App.js`, `frontend/src/services/api.js`

### Phase 2: 核心功能 Hook

- [ ] **T10: 實作前端會話管理與錄音控制 Hook**
  - [ ] 建立 `useSession` Hook (F-001, F-002)
    - [ ] `createNoteSession()` - 建立純筆記會話
    - [ ] `upgradeToRecording()` - 升級至錄音模式
  - [ ] 建立 `useRecorder` Hook (F-003~F-006)
    - [ ] `start()` - 啟動錄音與 WebSocket 連接
    - [ ] `sendChunk()` - 音檔切片上傳
    - [ ] `handleAckMissing()` - 重傳機制
  - [ ] 整合 MediaRecorder API (5秒切片)
  - [ ] 處理瀏覽器相容性（特別是 Safari）
  - **檔案**: `frontend/src/hooks/useSession.js`, `frontend/src/hooks/useRecorder.js`

- [ ] **T11: 實作前端逐字稿顯示與自動捲動功能**
  - [ ] 建立 `useTranscript` Hook (F-007~F-011)
    - [ ] `connect()` - 建立逐字稿 WebSocket 連接
    - [ ] `mergeSegment()` - 相鄰段落合併邏輯
    - [ ] `autoScroll()` - 自動捲動控制
  - [ ] 建立 `TranscriptPane` 元件 (C-004)
  - [ ] 建立 `ToLatestButton` 元件 (C-005)
  - [ ] 實作捲動鎖定/解鎖機制
  - [ ] 優化大量內容渲染效能
  - **檔案**: `frontend/src/hooks/useTranscript.js`, `frontend/src/components/TranscriptPane.js`, `frontend/src/components/ToLatestButton.js`

### Phase 3: 編輯與儲存功能

- [ ] **T12: 實作 Markdown 編輯器與草稿自動儲存**
  - [ ] 建立 `useLocalDraft` Hook (F-012~F-014)
    - [ ] `saveDraft()` - 5秒 debounce localStorage 暫存
    - [ ] `loadDraft()` - 載入草稿內容
    - [ ] `clearDraft()` - 清除草稿
  - [ ] 建立 `useAutoSave` Hook (F-015)
    - [ ] 10秒自動儲存至伺服器
  - [ ] 建立 `MarkdownEditor` 元件 (C-003)
  - [ ] 建立 `TitleInput` 元件 (C-002)
  - [ ] 實作草稿與伺服器資料衝突解決
  - **檔案**: `frontend/src/hooks/useLocalDraft.js`, `frontend/src/hooks/useAutoSave.js`, `frontend/src/components/MarkdownEditor.js`, `frontend/src/components/TitleInput.js`

### Phase 4: UI 元件與使用者體驗

- [ ] **T13: 實作前端 UI 元件與匯出功能**
  - [ ] 建立 `RecordButton` 元件 (C-001)
    - [ ] 錄音狀態切換與視覺回饋
    - [ ] 麥克風圖示動畫效果
  - [ ] 建立 `SessionModeSelector` 元件 (C-007)
    - [ ] 純筆記/錄音模式選擇器
  - [ ] 建立 `UpgradeToRecordingButton` 元件 (C-008)
  - [ ] 建立 `PaneOverlay` 元件 (C-006)
    - [ ] 上傳狀態遮罩與進度顯示
  - [ ] 實作 Toast 通知系統 (F-017)
  - [ ] 實作檔案匯出下載功能 (F-016)
  - **檔案**: `frontend/src/components/RecordButton.js`, `frontend/src/components/SessionModeSelector.js`, `frontend/src/components/PaneOverlay.js`, `frontend/src/utils/export.js`, `frontend/src/utils/ui.js`

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
  - [ ] 逐字稿延遲 ≤ 3秒
  - [ ] 中文辨識準確率 85%+
  - [ ] 大檔案匯出記憶體使用
  - [ ] Cloudflare R2 上傳效能

---

## 📊 進度追蹤

**後端任務**: ✅ 5/8 完成 (62.5%)
- T1: ✅ 基礎架構與資料庫
- T2: ✅ Session 管理 API
- T3: ✅ 筆記儲存 API  
- T4: ✅ FFmpeg 轉碼服務
- T5: ✅ Cloudflare R2 音檔存儲
- T6: ⬜ WebSocket 音檔上傳
- T7: ⬜ Whisper 整合
- T8: ⬜ ZIP 匯出功能

**前端任務**: ⬜ 0/5 完成 (0%)
- T9: ⬜ React 基礎架構
- T10: ⬜ 會話管理 Hook
- T11: ⬜ 逐字稿顯示
- T12: ⬜ Markdown 編輯器
- T13: ⬜ UI 元件與匯出

**總進度**: ✅ 5/13 完成 (38.5%)

---

## 🚀 開發建議

### 並行開發策略
1. **Phase 1**: T1 完成後，T2-T5 可並行開發
2. **Phase 2**: T9 完成後，T10-T13 可並行開發  
3. **整合階段**: T6-T7 需要前置任務完成
4. **前後端可同時進行開發**

### 關鍵里程碑
- **Week 1-2**: 基礎架構建設 (T1, T9)
- **Week 3-4**: 核心 API 與 Hook (T2-T5, T10-T12)
- **Week 5-6**: WebSocket 與即時功能 (T6-T7, T11)
- **Week 7**: 匯出功能與 UI 完善 (T8, T13)
- **Week 8**: 整合測試與優化

### 優先處理順序
1. **Critical Path**: T1 → T2 → T5 → T6 → T7 (核心音訊處理鏈)
2. **並行開發**: T3-T4 (獨立 API 功能)
3. **前端整合**: T9 → T10 → T11-T13

### 🔧 Cloudflare R2 配置要求

**環境變數設定**：
```bash
# Cloudflare R2 配置
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=studyscriber-audio
R2_REGION=auto
```

**檔案命名規範**：
- 音檔：`audio/{session_id}/chunk_{sequence:04d}.webm`
- 示例：`audio/550e8400-e29b-41d4-a716-446655440000/chunk_0001.webm`

**免費額度限制**：
- 每月 10GB 免費儲存空間
- 無 egress 費用
- 建議實作檔案清理機制避免超額

---

*最後更新: 2024年12月 - 基於 PRD v1.1 與 Cloudflare R2 整合*
