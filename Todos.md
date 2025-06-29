# Study Scriber - Todos

## 🎯 WebM 處理改善：「段段都含完整 WebM Header」方案

### 背景
- **問題**：Azure OpenAI Whisper API 無法解碼修復後的 WebM 檔案
- **解決方案**：每個 chunk 都包含完整 WebM 檔頭，避免檔頭修復邏輯
- **方法**：使用遞迴啟動/停止 MediaRecorder 的方式

---

## 📋 實作任務清單

### Phase 1: 前端 AudioRecorder 重構

- [ ] **1.1 建立新的 SegmentedAudioRecorder 類別**
  - 路徑：`frontend/lib/segmented-audio-recorder.ts`
  - 實作遞迴啟動/停止 MediaRecorder 邏輯
  - 每個 segment 包含完整 WebM Header
  - 支援可配置的切片時長 (預設 5 秒)

- [ ] **1.2 實作核心錄音邏輯**
  ```typescript
  // 核心功能：
  // - startSegment() 遞迴函式
  // - 每個 MediaRecorder 只錄一個切片
  // - setTimeout 控制切片時長
  // - requestData() + stop() + 重新啟動
  ```

- [ ] **1.3 改善 AudioUploader 介面**
  - 確保 WebSocket 傳送格式正確
  - 4-byte sequence + Blob 數據
  - 錯誤處理和重連機制

- [ ] **1.4 更新 useRecording Hook**
  - 替換現有的 AudioRecorder 為 SegmentedAudioRecorder
  - 保持現有 API 兼容性
  - 狀態管理 (recording flag)

### Phase 2: 配置調整

- [ ] **2.1 切片時長調整**
  - 前端：調整為 5 秒切片 (`CHUNK_MS = 5_000`)
  - 後端：設定 `AUDIO_CHUNK_DURATION_SEC=5`
  - 更新環境變數文件

- [ ] **2.2 音頻格式優化**
  ```typescript
  const MIME = 'audio/webm;codecs=opus'
  const AUDIO_BITRATE = 64_000  // 64 kbps for 5s chunks
  ```

- [ ] **2.3 WebSocket 協議確認**
  - 確認後端支援新的傳送格式
  - 驗證 sequence + blob 解析邏輯

### Phase 3: 後端簡化

- [ ] **3.1 移除 WebM 檔頭修復邏輯**
  - 移除或註解 `WebMHeaderRepairer` 相關程式碼
  - 簡化 `_validate_and_repair_webm_data` 函式
  - 每個 chunk 直接轉錄，不需修復

- [ ] **3.2 更新轉錄服務**
  - 確認每個 chunk 都有完整檔頭
  - 移除檔頭緩存機制
  - 簡化錯誤處理邏輯

- [ ] **3.3 時間戳計算調整**
  - 確認 5 秒切片的時間戳正確性
  - 更新 `start_time` 和 `end_time` 計算

### Phase 4: 測試與驗證

- [ ] **4.1 單元測試**
  - SegmentedAudioRecorder 功能測試
  - WebSocket 傳送格式測試
  - 切片完整性驗證

- [ ] **4.2 整合測試**
  - 端到端錄音轉錄流程
  - 多個連續切片測試
  - Azure OpenAI Whisper API 相容性

- [ ] **4.3 效能測試**
  - 5 秒切片延遲測試
  - 記憶體使用量監控
  - MediaRecorder 重建開銷評估

### Phase 5: 部署與監控

- [ ] **5.1 環境配置更新**
  - 更新 `.env` 檔案範例
  - 文件化新的配置選項
  - 向後兼容性考量

- [ ] **5.2 監控與日誌**
  - 新增切片成功率監控
  - 檔頭完整性日誌
  - 轉錄成功率統計

- [ ] **5.3 回滾計畫**
  - 保留舊版 AudioRecorder 作為備用
  - 功能開關控制新舊版本
  - 問題回報機制

---

## 🎯 預期效果

✅ **解決問題**
- Azure OpenAI Whisper API 轉錄錯誤
- 逐字稿只出現第一行的問題
- WebM 檔頭修復的複雜性

✅ **效能提升**
- 更短的切片 (5 秒) = 更即時的反饋
- 簡化後端處理邏輯
- 減少錯誤率

✅ **維護性**
- 移除複雜的檔頭修復程式碼
- 更簡潔的錄音邏輯
- 更好的錯誤處理

---

## 🔧 技術細節參考

### MediaRecorder 遞迴模式
```typescript
const startSegment = () => {
  const rec = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 64_000
  })
  
  rec.ondataavailable = (evt) => {
    // evt.data 包含完整 WebM Header
    audioUploader.send(evt.data, seq++)
  }
  
  rec.start()
  
  setTimeout(() => {
    rec.requestData()  // 觸發 ondataavailable
    rec.stop()         // 結束此段
    if (recording) startSegment()  // 重新開始
  }, CHUNK_MS)
}
```

### WebSocket 傳送格式
```typescript
send(blob: Blob, sequence: number) {
  const seqBuf = new ArrayBuffer(4)
  new DataView(seqBuf).setUint32(0, sequence)
  this.ws.send(seqBuf)  // 先送 sequence
  this.ws.send(blob)    // 再送音頻數據
}
```
