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

### ✅ Phase 2.5: 修復 WebM Header 問題 (已完成)

**問題分析:**
- ✅ 第一個段落（seq=0）：上傳成功，包含完整 WebM EBML header
- ❌ 後續段落（seq≥1）：HTTP 400 錯誤，缺少 WebM header，`valid_webm()` 驗證失敗
- 🔍 根因：`MediaRecorder.start(timeslice)` 只在第一個段落包含完整 container header

**解決方案：**
- ✅ **雙 MediaRecorder 策略**：每10秒重新創建 MediaRecorder 實例
- ✅ **無縫切換機制**：預建下一個實例，stop→start 間隙 ≈ 1-3ms  
- ✅ **完整 WebM Header**：確保每個段落都包含完整 EBML header
- ✅ **全面測試驗證**：18 個單元測試覆蓋所有核心功能

- [x] **2.5.1 實作進階分段錄音器 (Advanced Audio Recorder)**
  - ✅ 替換 `SimpleAudioRecorder` 為 `AdvancedAudioRecorder`
  - ✅ 實作無縫 MediaRecorder 切換策略：
    ```typescript
    // 核心方案：每10秒重新創建 MediaRecorder
    let currentRec: MediaRecorder | null = null
    let nextRec: MediaRecorder | null = null
    let seq = 0

    function start() {
      currentRec = makeRecorder()
      nextRec = makeRecorder()
      currentRec.start()
      setTimeout(swap, 10_000)
    }

    function swap() {
      currentRec?.stop()          // 觸發 dataavailable
      nextRec!.start()            // 啟動備用 recorder
      currentRec = nextRec        // 角色轉換
      nextRec = makeRecorder()    // 準備下一個
      if (isRecording) setTimeout(swap, 10_000)
    }
    ```

- [x] **2.5.2 確保音訊連續性**
  - ✅ **預建策略**：提前創建下一個 MediaRecorder，避免建立延遲
  - ✅ **buffer 完整性**：MediaRecorder.stop() 會清空所有 buffer，不會漏聲音
  - ✅ **切換間隙**：stop→start 間隙 ≈ 1-3ms，可接受
  - ✅ 測試驗證：錄製連續音頻確認無丟失

- [x] **2.5.3 增強錯誤處理**
  ```typescript
  function makeRecorderSafe(): MediaRecorder | null {
    try {
      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        throw new Error('瀏覽器不支援 WebM Opus 編碼')
      }
      return makeRecorder()
    } catch (e) {
      toast.error(`錄音功能異常：${e.message}`)
      return null
    }
  }
  ```

- [x] **2.5.4 優化狀態管理**
  - ✅ 整合到現有的錄音服務架構
  - ✅ 保持與現有狀態管理系統的兼容性
  - ✅ 完整的錄音生命週期管理

- [x] **2.5.5 整合到錄音服務**
  - ✅ 更新 `SimpleRecordingService` 使用 `AdvancedAudioRecorder`
  - ✅ 確保與現有的 `RestAudioUploader` 正常配合
  - ✅ 保持所有現有功能（重試、暫存、狀態管理）

- [x] **2.5.6 測試驗證**
  - ✅ 完整單元測試：18 個測試全部通過
  - ✅ 驗證雙 MediaRecorder 策略正常工作
  - ✅ 驗證段落數據正確生成並包含完整 WebM header
  - ✅ 驗證錯誤處理和資源清理
  - ✅ 驗證音訊連續性（無丟失、無重複）
  - ✅ 測試錯誤情況（網路斷線、瀏覽器不支援等）

### 🔧 Phase 2.6: 後端優化 (可選)

- [ ] **2.6.1 WebM 驗證優化**
  ```python
  # 只驗證第一個段落的 WebM header
  if seq == 0:
      if not valid_webm(blob[:32]):
          raise HTTPException(HTTP_400_BAD_REQUEST, "Invalid WebM header")
  else:
      logger.debug(f"Segment {seq}: Skipping WebM header validation")
  ```

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

## 🚨 緊急修復：逐字稿無法產生問題 (2024-12-30)

### 問題分析
**根本原因**：音頻段落序號衝突導致 HTTP 409 錯誤
- 現象：所有音頻段落上傳都返回 409 Conflict
- 根因：系統重用現有會話時，`audio_files` 表中已存在相同的 `(session_id, chunk_sequence)` 記錄
- 影響：逐字稿無法產生，整個錄音功能失效

### 🔥 修復任務 (最高優先級)

- [x] **Task 1: Azure OpenAI 客戶端優化** ✅ **已完成**
  - 📁 檔案：`app/services/azure_openai_v2.py`, `main.py`
  - 🎯 升級為異步客戶端，優化 timeout 和重試配置
  - 📋 實作細節：
    ```python
    from openai import AsyncAzureOpenAI, RateLimitError
    from httpx import Timeout
    
    TIMEOUT = Timeout(connect=5, read=55, write=30, pool=5)
    
    def get_azure_openai_client() -> Optional[AsyncAzureOpenAI]:
        return AsyncAzureOpenAI(
            api_key=settings.AZURE_OPENAI_API_KEY,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_version="2024-06-01",
            timeout=TIMEOUT,
            max_retries=2,  # 由 5 次降到 2 次，避免積壓
        )
    
    client = get_azure_openai_client()
    ```
  - ✅ 驗證標準：客戶端超時配置生效，重試次數減少
  - 🎯 **實作狀況**：
    - ✅ 升級為 `AsyncAzureOpenAI` 異步客戶端
    - ✅ 配置優化的 timeout：connect=5s, read=55s, write=30s, pool=5s
    - ✅ 減少重試次數從 5 次到 2 次
    - ✅ 更新 `main.py` 使用 `initialize_transcription_service_v2()` 初始化
    - ✅ 所有 `_transcribe_audio()` 調用改為 `await` 異步調用

- [x] **Task 2: 智能頻率限制處理** ✅ **已完成**
  - 📁 檔案：`app/services/azure_openai_v2.py`
  - 🎯 實作自定義退避策略，避免過長等待
  - 📋 實作細節：
    ```python
    class RateLimitHandler:
        def __init__(self):
            self._delay = 0
    
        async def wait(self):
            if self._delay:
                await asyncio.sleep(self._delay)
    
        def backoff(self):
            self._delay = min((self._delay or 5)*2, 60)  # 最大 60 秒
    
        def reset(self):
            self._delay = 0
    
    rate_limit = RateLimitHandler()
    
    # 在 _transcribe_audio() 前後插入
    async def _transcribe_audio(self, webm_data: bytes, session_id: UUID, chunk_sequence: int):
        await rate_limit.wait()
        try:
            # ... 轉錄邏輯
            resp = await client.audio.transcriptions.create(
                model=self.deployment_name,
                file=audio_file,
                language="zh",
                response_format="text"
            )
            rate_limit.reset()
            return resp
        except RateLimitError:
            rate_limit.backoff()
            raise
    ```
  - ✅ 驗證標準：429 錯誤時智能退避，成功時重置延遲
  - 🎯 **實作狀況**：
    - ✅ 實作 `RateLimitHandler` 類別，支援指數退避 (5s → 10s → 20s → 40s → 60s)
    - ✅ 全域 `rate_limit` 實例，所有轉錄請求共享
    - ✅ `_transcribe_audio()` 方法整合智能等待：`await rate_limit.wait()`
    - ✅ 成功時重置延遲：`rate_limit.reset()`
    - ✅ 429 錯誤時退避並廣播錯誤：`rate_limit.backoff()`
    - ✅ 完整日誌記錄和前端錯誤通知機制

- [x] **Task 3: 併發控制 & 任務優先級**
  - 📁 檔案：`app/services/azure_openai_v2.py`
  - 🎯 實作優先級隊列和併發控制，確保順序處理
  - 📋 實作細節：
    ```python
    from asyncio import PriorityQueue, Semaphore
    
    # 0 = high priority (補傳); 1 = normal
    queue: PriorityQueue[tuple[int, dict]] = PriorityQueue()
    sem = Semaphore(1)  # 單並發保證順序
    
    async def enqueue(job: dict, priority: int = 1):
        await queue.put((priority, job))
    
    async def worker():
        while True:
            _, job = await queue.get()
            async with sem:
                try:
                    await process(job)  # 包含 _transcribe_audio
                except openai.RateLimitError:
                    await enqueue(job, 0)  # 排回高優先等待
            queue.task_done()
    
    # 修改 SimpleAudioTranscriptionService 使用 worker 模式
    ```
  - ✅ 驗證標準：一次只有 1 個 Whisper API 呼叫，失敗任務高優先級重試

- [x] **Task 4: 積壓檢測 & 前端通知**
  - 📁 檔案：`app/services/azure_openai_v2.py`, `app/ws/transcript_feed.py`
  - 🎯 監控隊列積壓，及時通知前端用戶
  - 📋 實作細節：
    ```python
    # 後端積壓監控
    async def backlog_monitor():
        while True:
            size = queue.qsize()
            if size > 30:  # 超過 5 分鐘積壓 (30 任務 × 10秒)
                for session_id in manager.active_connections:
                    await manager.broadcast(
                        json.dumps({"event": "stt_backlog", "size": size}),
                        session_id
                    )
            await asyncio.sleep(10)
    
    # 前端處理 (frontend/lib/websocket.ts)
    ws.onmessage = e => {
        const m = JSON.parse(e.data)
        if (m.event === 'stt_backlog') {
            showBanner(`轉錄擁塞：隊列 ${m.size}，逐字稿將延遲`)
        }
    }
    ```
  - ✅ 驗證標準：積壓超閾值觸發 WebSocket 通知，前端顯示橙色 Banner

- [x] **Task 5: 監控與日誌優化** ✅ **已完成**
  - 📁 檔案：`app/services/azure_openai_v2.py`, `app/main.py`, `pyproject.toml`
  - 🎯 整合 Prometheus 監控，提供詳細的效能指標
  - 📋 實作細節：
    ```python
    # 添加依賴到 pyproject.toml
    dependencies = [
        # ... 現有依賴
        "prometheus-client",
    ]
    
    # 監控指標
    import prometheus_client as prom
    
    REQ_TOTAL = prom.Counter("whisper_req_total", "Total calls", ["status"])
    LATENCY_SEC = prom.Summary("whisper_latency_seconds", "Latency")
    BACKLOG_GA = prom.Gauge("whisper_backlog_size", "Queue size")
    
    @LATENCY_SEC.time()
    async def process(job):
        try:
            REQ_TOTAL.labels("ok").inc()
            # ... 處理邏輯
        except openai.RateLimitError:
            REQ_TOTAL.labels("429").inc()
            raise
        finally:
            BACKLOG_GA.set(queue.qsize())
    
    # 在 app/main.py 新增 /metrics 端點
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    
    @app.get("/metrics")
    def metrics():
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
    ```
  - ✅ 驗證標準：`/metrics` 端點可被 curl 存取，顯示 `whisper_req_total`、`whisper_backlog_size` 等指標
  - 🎯 **實作狀況**：
    - ✅ 添加 `prometheus-client` 依賴到 `pyproject.toml`
    - ✅ 實作完整的 Prometheus 監控指標：
      - `whisper_requests_total`: 轉錄請求計數器 (按狀態/部署分類)
      - `whisper_latency_seconds`: 轉錄延遲指標
      - `whisper_backlog_size`: 隊列積壓大小
      - `queue_processed_total`: 隊列處理統計
      - `queue_wait_seconds`: 隊列等待時間
      - `concurrent_transcription_jobs`: 併發任務數量
    - ✅ 整合 metrics 到 `_transcribe_audio()` 方法中
    - ✅ 整合 metrics 到隊列管理器中
    - ✅ 在 `main.py` 中添加 `/metrics` 端點
    - ✅ 實作優雅降級機制 (NoOpMetric 類別) 當 Prometheus 不可用時

### 📊 修復策略優勢
- **智能流量控制**：避免 API 頻率限制，維持穩定處理速度
- **優雅降級處理**：積壓時不會完全停止，提供用戶反饋
- **完整監控體系**：Prometheus 指標幫助即時診斷問題
- **最小侵入性**：保持現有架構，僅優化關鍵瓶頸點

### ⏱️ 預估時間
- Task 1: 2-3 小時（客戶端升級 + 配置調整）
- Task 2: 3-4 小時（頻率限制處理器 + 集成測試）
- Task 3: 4-5 小時（隊列系統 + Worker 模式重構）
- Task 4: 2-3 小時（積壓監控 + WebSocket 通知）
- Task 5: 3-4 小時（Prometheus 整合 + 監控面板）
- **總計：14-19 小時**

### 🎯 預期效果
**立即改善：**
- 429 錯誤重試時間從 39 秒降低到 <10 秒
- 處理積壓狀況緩解，逐字稿更新恢復正常
- 用戶獲得清楚的狀態反饋

**長期穩定：**
- 智能流量控制避免頻率限制
- 完整的監控和警報機制
- 優雅降級，不會完全停止服務

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

# Study Scriber 開發清單

## 已完成 ✅
- 逐字稿時間戳顯示修正
  - ✅ 修正時間戳來源：使用 `start_time` 而不是 `timestamp`
  - ✅ 修正時間格式：改為 `HH:MM:SS` 而不是 `MM:SS`
  - ✅ 禁用逐字稿合併邏輯，確保一句話一個時間戳
  - ✅ **根本問題修正：前端音頻上傳協議**
    - 修正前：分兩次發送序號和音檔數據，使用大端序
    - 修正後：合併為一個二進制消息，使用小端序
    - 現在 `chunk_sequence` 可以正確遞增 (0, 1, 2, ...)
    - 時間戳將顯示為：00:00:00, 00:00:10, 00:00:20, ...
  - ✅ 修正的檔案包括：
    - frontend/lib/transcript-manager.ts
    - frontend/lib/transcript-manager-new.ts  
    - frontend/hooks/use-app-state.ts
    - frontend/hooks/use-recording-new.ts
    - frontend/hooks/use-transcript-new.ts
    - frontend/hooks/use-transcript.ts
    - frontend/hooks/use-app-state-context.ts
    - frontend/app/page.tsx
    - frontend/lib/services/recording-flow-service.ts
    - frontend/components/recording-active-state.tsx
    - **frontend/lib/stream/audio-uploader.ts** (關鍵修正)
