# StudyScriber MVP 開發任務清單

基於 PRD 分析與 shrimp-task-manager 規劃的詳細開發任務

## 🚨 緊急修復：WebSocket 逐字稿顯示問題 (2024-12-29)

**問題描述**: 按下錄音後進入 waiting 狀態，但秒數不會動，且 WebSocket 未連接導致無法接收逐字稿

**診斷結果**:
```
📊 appData 狀態: {state: undefined, isRecording: undefined, transcriptEntries: 0}
🎤 recording hook: {isRecording: true, transcriptsCount: 0}
💬 TranscriptManager: {isConnected: false, websocket: '不存在'}
❌ WebSocket 連接未找到 for session: 2d47cc9b-4300-4dd1-be70-29b261f8fe07
```

**根本原因**: 從 useState 切換到 Zustand store 時不完整的遷移導致：
1. 計時邏輯沒有移植到 Zustand store
2. WebSocket 連接觸發機制斷裂 
3. window 暴露使用舊的狀態結構
4. 可能存在雙重狀態管理

### 🎯 **修復任務 (第一階段: 基礎 WebSocket 連接)**

- [x] **T-WS.1: 實現 Zustand 錄音計時器邏輯** ⚡ **緊急** ✅ **已完成**
- [x] **T-WS.2: 在 RecordingFlowService 中強制 WebSocket 連接** ⚡ **緊急** ✅ **已完成**
- [x] **T-WS.3: 清理舊 Hook 系統，統一使用 Zustand** ⚡ **重要** ✅ **已完成**
- [x] **T-WS.4: 修復 window.appData 暴露邏輯** ⚡ **重要** ✅ **已完成**
- [x] **T-WS.5: 修復 TranscriptManager 中的 transcript_entry 處理** ⚡ **關鍵** ✅ **已完成**

## 🔌 **第二階段：雙 WebSocket 音訊上傳修復 (2024-12-29)**

**問題診斷**: Zustand store 的 startRecording 缺少音訊錄製邏輯，導致：
- ✅ WebSocket 逐字稿接收正常
- ✅ 計時器正常運作
- ❌ **缺少 AudioRecorder 啟動**
- ❌ **沒有音訊上傳 WebSocket**
- ❌ **後端無音訊數據，無法生成逐字稿**

### 🎯 **音訊上傳修復任務**

- [x] **T-AU.1: 建立音訊上傳 WebSocket 類別** ⚡ **關鍵** ✅ **已完成**
  - [x] 創建 `frontend/lib/stream/audio-uploader.ts`
  - [x] 實現 `connect(sessionId)` → `/ws/upload_audio/{sessionId}`
  - [x] 實現 `send(blob)` 發送音訊切片
  - [x] 實現 `close()` 關閉連接
  - [x] DEV 模式診斷：`window.__rec.chunksSent++`
  - **檔案**: `frontend/lib/stream/audio-uploader.ts`

- [x] **T-AU.2: 整合 AudioRecorder 到 RecordingFlowService** ⚡ **關鍵** ✅ **已完成**
  - [x] 修改 `recording-flow-service.ts` 添加 `startRecordingFlow()`
  - [x] 流程：`audioRecorder.initialize()` → `audioUploader.connect()` → `recorder.onChunk()`
  - [x] 設定音訊切片自動上傳：`onChunk(chunk => audioUploader.send(chunk.blob))`
  - [x] 錯誤處理：權限拒絕、WebSocket 失敗 → 回到 default 狀態
  - **檔案**: `frontend/lib/services/recording-flow-service.ts`

- [x] **T-AU.3: 更新 Zustand Store 使用 RecordingFlowService** ⚡ **關鍵** ✅ **已完成**
  - [x] 修改 `app-store-zustand.ts` 的 `startRecording()`
  - [x] 改調用 `recordingFlowService.startRecordingFlow()`
  - [x] 移除直接的 WebSocket 連接邏輯
  - [x] 添加 `stopRecording()` 調用 `stopRecordingFlow()`
  - **檔案**: `frontend/lib/app-store-zustand.ts`

- [x] **T-AU.7: 修復 WebSocket URL 路徑不匹配** ⚡ **緊急** ✅ **已完成**
  - [x] 前端嘗試連接: `/ws/audio_upload/{sessionId}`
  - [x] 後端實際端點: `/ws/upload_audio/{session_id}`
  - [x] 修改 `audio-uploader.ts` 使用正確的 `/ws/upload_audio/` 路徑
  - **檔案**: `frontend/lib/stream/audio-uploader.ts`

- [x] **T-AU.8: 實現可配置的音訊切片間隔** ⚡ **優化** ✅ **已完成**
  - [x] 創建 `frontend/lib/config.ts` 配置管理器
  - [x] 添加環境變數 `NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC` (預設 15 秒)
  - [x] 支援毫秒格式 `NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS` (優先級較高)
  - [x] 更新 `RecordingFlowService` 使用配置化的切片間隔
  - [x] 更新 `AudioRecorder` 預設配置使用環境變數
  - [x] 在 DEV 模式添加配置診斷資訊
  - **檔案**: `frontend/lib/config.ts`, `frontend/.env.local`, `frontend/.env.example`

- [ ] **T-AU.4: 創建音訊上傳單元測試** ⚡ **驗證**
  - [ ] 創建 `frontend/lib/stream/__tests__/audio-uploader.test.ts`
  - [ ] Mock WebSocket API，測試連接/發送/關閉
  - [ ] 測試錯誤處理：連接失敗、發送失敗
  - **檔案**: `frontend/lib/stream/__tests__/audio-uploader.test.ts`

- [ ] **T-AU.5: 創建錄音流程整合測試** ⚡ **驗證**
  - [ ] 修改 `frontend/lib/services/__tests__/recording-flow-service.test.ts`
  - [ ] Mock `getUserMedia`, `MediaRecorder`, `AudioUploader`
  - [ ] 驗證 `audioUploader.connect/send` 被正確調用
  - [ ] Mock transcript WebSocket 推送，驗證 store 更新
  - **檔案**: `frontend/lib/services/__tests__/recording-flow-service.test.ts`

- [ ] **T-AU.6: 端到端驗證雙 WebSocket 模式** ⚡ **驗證**
  - [ ] 驗證 WebSocket 1 (逐字稿接收) 正常運作
  - [ ] 驗證 WebSocket 2 (音訊上傳) 成功建立
  - [ ] 測試完整流程：錄音 → 音訊上傳 → 逐字稿接收 → UI 更新
  - [ ] 驗證 `window.__rec` 和 `window.diagnose()` 診斷工具
  - **驗證**: 手動測試 + 自動化測試

### 📋 **預期修復效果**

**修復後的完整流程**:
1. 用戶點擊錄音 → `startRecording()`
2. 建立錄音會話 → `ensureRecordingSession()`
3. **連接雙 WebSocket**:
   - WS1: `/ws/transcript_feed/{sessionId}` (逐字稿接收)
   - WS2: `/ws/upload_audio/{sessionId}` (音訊上傳) ←─ **修復 URL**
4. **獲取麥克風權限** → `AudioRecorder.initialize()` ←─ **修復**
5. **開始錄音並上傳** → 可配置切片間隔自動上傳 ←─ **優化**
6. 後端語音辨識 → 逐字稿推送 → UI 即時更新

**音訊切片配置**:
```bash
# 環境變數配置 (二選一)
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC=15    # 設定秒數 (推薦)
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS=15000  # 設定毫秒數 (優先級較高)

# 預設值：15 秒 (15000ms)
```

**診斷工具增強**:
```javascript
window.diagnose()           // 現有：檢查 TranscriptManager 狀態
window.__rec                // 新增：音訊上傳狀態
// { 
//   chunksSent: X, 
//   totalBytes: Y, 
//   isRecording: true, 
//   sessionId: "xxx",
//   chunkInterval: 15000,
//   chunkIntervalSec: 15
// }
```
