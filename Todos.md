## 🚀 優先任務：滑動視窗 Rate Limiting 改進逐字稿延遲

### 目標
將現有的單並發 + 指數退避架構升級為精確的每分鐘 3 次 Whisper API 呼叫控制，目標將平均延遲從 3-5 分鐘降低到 1-2 分鐘。

### 實作任務

- [x] **Task 1: 實作滑動視窗頻率限制器核心模組**
  - 📁 檔案：`app/services/azure_openai_v2.py`
  - 🎯 實作 `SlidingWindowRateLimiter` 類別，使用 `Semaphore + asyncio.call_later()` 機制
  - 📋 核心功能：
    - `async def acquire()` - 取得 API 呼叫許可
    - `def _release_permit()` - 60秒後自動釋放許可
    - `def get_stats()` - 回傳當前狀態統計
  - ⚠️ 關鍵技術挑戰：確保 `call_later()` 正確釋放 semaphore，無記憶體洩漏
  - ✅ 驗證標準：正確控制併發數、自動釋放機制、統計準確性

- [x] **Task 2: 擴展配置系統支援滑動視窗參數**
  - 📁 檔案：`app/core/config.py`, `.env.local`
  - 🎯 新增環境變數配置和 Feature Flag 機制
  - 📋 配置項：
    ```python
    USE_SLIDING_WINDOW_RATE_LIMIT: bool = Field(False)
    SLIDING_WINDOW_MAX_REQUESTS: int = Field(3) 
    SLIDING_WINDOW_SECONDS: int = Field(60)
    ```
  - 🔄 實作 `get_rate_limiter()` 工廠函數支援策略切換
  - ✅ 驗證標準：環境變數正確讀取、Feature Flag 正常切換、向後相容

- [x] **Task 3: 整合滑動視窗到現有轉錄服務架構**
  - 📁 檔案：`app/services/azure_openai_v2.py` 中的 `_transcribe_audio()` 方法
  - 🎯 修改現有的 `rate_limit.wait()` 使用，支援動態 Rate Limiter 切換
  - 📋 整合要點：
    - 保持 `await rate_limit.wait()` 介面不變
    - 優化 RateLimitError 處理，根據 Rate Limiter 類型提供適當錯誤訊息
    - 確保 `backoff()` 和 `reset()` 方法在兩種模式下都正常工作
    - 維持與現有 Prometheus 指標的相容性
  - 🔄 完成功能：
    - ✅ 新增 `SlidingWindowRateLimiter.backoff()` 和 `._delay` 屬性相容
    - ✅ 優化 RateLimitError 處理邏輯，根據類型顯示不同錯誤訊息
    - ✅ 保持與現有架構完全相容
  - ✅ 驗證標準：無縫切換、錯誤處理一致、Prometheus 指標正常、介面相容性完整

- [x] **Task 4: 新增滑動視窗專用 Prometheus 監控指標**
  - 📁 檔案：`app/services/azure_openai_v2.py` Prometheus 指標區段
  - 🎯 擴展現有的 Prometheus 監控系統，新增滑動視窗專用指標
  - 📋 監控指標：
    ```python
    SLIDING_WINDOW_PERMITS = prom.Gauge("滑動視窗可用許可數量")
    SLIDING_WINDOW_ACTIVE_REQUESTS = prom.Gauge("滑動視窗活躍請求數")
    SLIDING_WINDOW_QUEUE_TIME = prom.Summary("滑動視窗等待時間")
    API_QUOTA_UTILIZATION = prom.Gauge("Azure API 配額利用率百分比")
    RATE_LIMITER_TYPE = prom.Gauge("Rate Limiter 類型指標")
    ```
  - 🔄 整合功能：
    - ✅ 在 `SlidingWindowRateLimiter.acquire()` 中新增指標更新和等待時間測量
    - ✅ 在 `_release_permit()` 中更新釋放後的指標狀態
    - ✅ 在 `get_rate_limiter()` 工廠函數中追蹤當前使用的 Rate Limiter 類型
    - ✅ 完整的 NoOpMetric 模式支援，確保沒有 Prometheus 也能運行
  - ✅ 驗證標準：Prometheus 指標正確匯出、滑動視窗許可數量追蹤準確、API 配額利用率計算正確、NoOpMetric 模式無錯誤

- [ ] **Task 5: 改善前端積壓通知和延遲估算顯示**
  - 📁 檔案：`frontend/lib/websocket.ts`, `frontend/components/queue-status-banner.tsx`
  - 🎯 改進 `stt_backlog` 事件處理，實作精確延遲估算 UI
  - 📋 UI 改進：
    - 顯示隊列大小和預估等待時間
    - 新增隊列狀態 Banner 組件
    - 支援 `stt_recovery` 事件隱藏通知
  - ✅ 驗證標準：通知準確顯示、UI 一致性、使用者體驗良好

- [ ] **Task 6: 實作完整測試套件和 A/B 測試機制**
  - 📁 檔案：`tests/test_sliding_window_rate_limiter.py`, CI 整合
  - 🎯 建立完整測試覆蓋和 A/B 測試監控機制
  - 📋 測試覆蓋：
    - 單元測試：`call_later()` 時序行為、semaphore 控制
    - 整合測試：與 `TranscriptionQueueManager` 整合
    - 效能測試：新舊策略延遲比較
  - ✅ 驗證標準：測試覆蓋率 >90%、A/B 測試機制、CI 整合

---

### Backlog: 後端清理與優化

- [ ] **1. 移除舊 WebSocket 上傳**
  - 刪除 `app/ws/upload_audio.py`
  - 移除相關路由註冊
  - 清理 ack/missing 邏輯

- [ ] **2. 簡化轉錄服務**
  - 移除串流處理複雜邏輯
  - 專注於單檔處理優化
  - 保留 Whisper 429 重試機制
