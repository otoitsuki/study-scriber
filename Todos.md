# Study Scriber - Todos (REST API 簡化架構)

## 🎯 架構簡化：從 WebSocket 串流 → REST API 模式

### 背景
- **問題**：WebSocket 串流架構過於複雜，錯誤率高，難以除錯
- **解決方案**：改用 MediaRecorder timeslice + REST API 上傳完整 10s 檔案
- **優勢**：更簡單、更可靠、更容易測試和維護

---

## 📋 實作任務清單

### Phase 1: 後端 REST API 建立

- [x] **1.1 建立 segments API 路由**
  - ✅ 📁 路徑：`app/api/segments.py` 已建立
  - ✅ 🎯 實作 `POST /api/segment` 端點
  ```python
  async def upload_segment(
      sid: UUID,
      seq: int,
      file: UploadFile = File(...)
  ) -> dict
  ```

- [x] **1.2 實作檔案驗證與處理**
  - ✅ 檔案大小限制：≤ 5MB
  - ✅ MIME 類型檢查：`audio/webm`
  - ✅ seq 唯一性驗證：`(session_id, seq)` UNIQUE
  - ✅ WebM 檔案格式驗證

- [x] **1.3 實作背景轉錄任務**
  - ✅ 使用 FastAPI `BackgroundTasks`
  - ✅ 流程：WebM → R2 儲存 → DB 記錄 → FFmpeg → Whisper API → 廣播
  ```python
  async def process_and_transcribe(sid, seq, webm_blob):
      # 背景執行，不阻塞上傳回應
  ```

- [x] **1.4 更新儲存服務**
  - ✅ 整合 Cloudflare R2 儲存
  - ✅ 資料庫 `audio_files` 表記錄
  - ✅ 完整檔案儲存支援

### Phase 2: 前端錄音重構

- [x] **2.1 重構 MediaRecorder 邏輯**
  - ✅ 移除 SegmentedAudioRecorder 複雜邏輯
  - ✅ 改用標準 `MediaRecorder` + `timeslice=10000`
  - ✅ 創建 `SimpleAudioRecorder` 類別
  ```typescript
  const recorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128_000
  });
  recorder.ondataavailable = handleSegment;
  recorder.start(10_000);  // 10 秒自動切片
  ```

- [x] **2.2 實作 REST API 上傳**
  - ✅ 替換 WebSocket 為 `fetch` POST
  - ✅ 實作上傳錯誤處理和重試
  - ✅ 創建 `RestAudioUploader` 類別
  ```typescript
  async function uploadSegment(seq: number, blob: Blob) {
    const form = new FormData();
    form.append('seq', String(seq));
    form.append('file', blob, `seg${seq}.webm`);
    await fetch('/api/segment', { method: 'POST', body: form });
  }
  ```

- [x] **2.3 實作失敗檔案暫存**
  - ✅ 使用 IndexedDB 暫存失敗的檔案
  - ✅ 提供重新上傳機制
  - ✅ UI 提示使用者暫存狀態

- [x] **2.4 更新狀態管理**
  - ✅ 移除 ack/missing 相關狀態
  - ✅ 簡化錄音狀態機
  - ✅ 創建 `SimpleRecordingService`
  - ✅ 加入功能開關 `useSimpleRecordingService`
  - ✅ 保持 WebSocket transcript_feed 不變

### Phase 3: 後端清理與優化

- [ ] **3.1 移除舊 WebSocket 上傳**
  - 刪除 `app/ws/upload_audio.py`
  - 移除相關路由註冊
  - 清理 ack/missing 邏輯

- [ ] **3.2 簡化轉錄服務**
  - 移除串流處理複雜邏輯
  - 專注於單檔處理優化
  - 保留 Whisper 429 重試機制

- [ ] **3.3 優化 FFmpeg 處理**
  - 改為處理完整 10s 檔案
  - 移除串流相關配置
  - 提升轉換成功率

### Phase 4: 測試更新

- [ ] **4.1 更新單元測試**
  - 測試新的 `/api/segment` 端點
  - 測試檔案上傳和驗證邏輯
  - 測試背景轉錄任務

- [ ] **4.2 更新整合測試**
  - 修改 Playwright 測試：
    - 首句延遲：8s → 15s
    - 測試 REST API 上傳流程
  - 測試失敗重試機制

- [ ] **4.3 效能基準測試**
  - 10s 檔案上傳速度
  - 轉錄延遲測量
  - 記憶體使用量監控

### Phase 5: 配置與部署

- [ ] **5.1 更新環境配置**
  - 新增配置項目：
    ```
    SEGMENT_DURATION=10
    UPLOAD_MAX_SIZE=5242880  # 5MB
    AUDIO_BITRATE=128000
    ```

- [ ] **5.2 更新 SLA 指標**
  - 首句延遲 KPI：≤ 15s
  - 平均句延遲：≤ 12s
  - 檔案上傳成功率：≥ 99%

- [ ] **5.3 監控與日誌**
  - 上傳成功率監控
  - 轉錄延遲統計
  - 失敗檔案暫存狀況

---

## 🎯 預期效果

### ✅ **解決的問題**
- WebSocket 連接不穩定
- ack/missing 重傳複雜性
- 檔頭修復錯誤頻發
- 除錯困難

### ✅ **架構優勢**
- **簡化開發**：REST API 比 WebSocket 更容易實作和測試
- **提升可靠性**：完整檔案處理，減少錯誤
- **更好維護**：減少狀態管理複雜度
- **容易擴展**：可以輕鬆加入批次處理、重試隊列等

### ✅ **使用者體驗**
- **延遲可接受**：10s 延遲符合學習筆記場景
- **更穩定**：減少連接中斷和重傳問題
- **錯誤處理**：清楚的失敗提示和重試機制

---

## 🔧 技術實作細節

### MediaRecorder 最佳實作
```typescript
class SimpleRecorder {
  private recorder: MediaRecorder;
  private sequence = 0;

  start(stream: MediaStream) {
    this.recorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128_000
    });
    
    this.recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        await this.uploadSegment(this.sequence++, e.data);
      }
    };
    
    this.recorder.start(10_000); // 10 秒自動切片
  }
  
  async uploadSegment(seq: number, blob: Blob) {
    try {
      const form = new FormData();
      form.append('seq', String(seq));
      form.append('file', blob, `seg${seq}.webm`);
      
      const response = await fetch(`/api/segment?sid=${this.sessionId}`, {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
    } catch (error) {
      // 暫存到 IndexedDB
      await this.cacheFailedSegment(seq, blob);
      this.showUploadError(seq);
    }
  }
}
```

### 後端 API 實作
```python
@router.post("/api/segment")
async def upload_segment(
    sid: UUID,
    seq: int,
    file: UploadFile = File(...),
    background: BackgroundTasks = BackgroundTasks()
):
    # 1. 基本驗證
    if file.content_type != "audio/webm":
        raise HTTPException(415, "Only WebM format accepted")
    
    if file.size > 5 * 1024 * 1024:  # 5MB
        raise HTTPException(413, "File too large")
    
    # 2. 讀取並儲存
    blob = await file.read()
    await storage.save_segment(sid, seq, blob)
    
    # 3. 背景轉錄
    background.add_task(process_and_transcribe, sid, seq, blob)
    
    return {"ack": seq, "size": len(blob)}

async def process_and_transcribe(sid: UUID, seq: int, webm_blob: bytes):
    try:
        # FFmpeg 轉換
        pcm_data = await ffmpeg.webm_to_pcm(webm_blob)
        
        # Whisper 轉錄
        text = await whisper.transcribe(pcm_data)
        
        # 儲存結果
        await db.save_transcript_segment(sid, seq, text)
        
        # WebSocket 廣播
        await transcript_hub.broadcast(sid, {
            "seq": seq,
            "text": text,
            "timestamp": datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"轉錄失敗 segment {seq}: {e}")
        await transcript_hub.broadcast_error(sid, seq, str(e))
```
