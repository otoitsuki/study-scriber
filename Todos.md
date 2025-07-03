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

- [x] **Task 4: 修改 _transcribe_audio 方法使用 verbose_json 並實作過濾**
  - 📁 檔案：`app/services/azure_openai_v2.py`
  - 🎯 修改 `_transcribe_audio` 方法，將 `response_format` 改為 "verbose_json"
  - 📋 功能：
    - 使用 `_keep` 函數過濾幻覺段落
    - 增加詳細的日誌記錄
    - 更新監控指標
  - 🔄 依賴：Task 3 完成
  - 🆔 TaskID: `f9e4060d-f2ec-4882-9529-211b1f9aca64`
  - ✅ 驗證標準：API 調用正確、過濾功能運作、日誌完整
  - 🎉 **已完成**：成功修改 `_transcribe_audio` 方法支援 `verbose_json` 格式，整合 `_keep` 函數過濾幻覺段落，添加詳細的段落過濾統計日誌（總數、保留、過濾），增強轉錄結果包含段落統計資訊，並通過 7 個完整的單元測試，涵蓋成功過濾、全段落過濾、空段落、API 錯誤、頻率限制、日誌記錄和 Prometheus 指標更新等情況

- [x] **Task 5: 為 _keep 函數和過濾邏輯撰寫單元測試**
  - 📁 檔案：測試檔案 (遵循專案測試結構)
  - 🎯 為新實作的 `_keep` 函數和修改後的 `_transcribe_audio` 方法撰寫完整的單元測試
  - 📋 功能：使用用戶提供的測試範例，確保過濾邏輯在各種邊界條件下都能正確運作
  - 🔄 依賴：Task 4 完成
  - 🆔 TaskID: `bfbd159c-8774-4a17-a984-cb7fa388c359`
  - ✅ 驗證標準：遵循 TDD 原則，測試覆蓋完整
  - 🎉 **已完成**：完整的測試已在 Task 3 和 Task 4 中實作完成 - Task 3 包含 `_keep` 函數的 9 個完整測試（涵蓋有效段落、高靜音機率、低置信度、高重複比率、邊界值、缺少欄位、Prometheus 計數器、多重過濾條件、自定義門檻值），Task 4 包含 `_transcribe_audio` verbose_json 功能的 7 個完整測試（涵蓋成功過濾、全段落過濾、空段落、API 錯誤、頻率限制、日誌記錄、Prometheus 指標更新）

- [x] **Task 6: 更新 .env.example 檔案添加過濾門檻配置範例**
  - 📁 檔案：`.env.example`
  - 🎯 在 Azure OpenAI 區段新增 Whisper 段落過濾門檻的配置範例和詳細說明
  - 📋 功能：
    - 提供清楚的中文註解說明各參數用途和建議值
    - 讓使用者可以直接複製到自己的 .env 檔案中
  - 🔄 依賴：Task 1 完成
  - 🆔 TaskID: `e609aecd-faa9-4b2c-bd39-cf97042f4256`
  - ✅ 驗證標準：文件清楚易懂、配置範例實用
  - 🎉 **已完成**：在 `.env.example` 檔案中新增完整的「Whisper 幻覺過濾設定」區段，包含三個過濾參數（`FILTER_NO_SPEECH=0.8`、`FILTER_LOGPROB=-1.0`、`FILTER_COMPRESSION=2.4`）的詳細中文說明，涵蓋參數用途、數值範圍、建議值和實際效果，讓使用者能夠輕鬆理解和配置幻覺過濾功能

## 🚀 緊急任務：並發處理優化解決逐字稿延遲問題

### 目標
解決當前錄音兩分鐘但只顯示一段逐字稿的嚴重延遲問題。主要原因是硬編碼的單並發限制（`MAX_CONCURRENT_TRANSCRIPTIONS = 1`），導致所有音檔切片必須排隊等待處理。目標將轉錄延遲從 60 秒+ 降至 15 秒內，支援 3-5 個音檔切片並發處理。

### 📋 優化方案（基於現有架構）
用戶提出的三層控制機制與現有系統高度吻合：
1. **Queue防丟失** ✅ 現有：`PriorityQueue`（更強大）
2. **滑動視窗API控制** ✅ 現有：`SlidingWindowRateLimiter`（更完善）  
3. **Semaphore併發控制** ⚠️ 現有：但需從1調整到3

**核心流程**：`queue.get() → sem.acquire() → sliding.acquire() → call_whisper()`

### 實作任務

- [ ] **Task 1: 外部化並發控制參數配置（立即生效）**
  - 📁 檔案：`app/core/config.py`, `app/services/azure_openai_v2.py`, `.env.local`
  - 🎯 採用用戶建議的參數配置，基於現有架構優化而非重寫
  - 📋 核心修改：
    - 在 `config.py` 新增：
      ```python
      # 採用更直觀的命名（用戶建議）
      MAX_CONCURRENT_TRANSCRIPTIONS: int = Field(3, description="最大並發轉錄數")
      TRANSCRIPTION_WORKERS_COUNT: int = Field(3, description="轉錄Worker數量") 
      QUEUE_BACKLOG_THRESHOLD: int = Field(10, description="隊列積壓警報門檻")
      QUEUE_MONITOR_INTERVAL: int = Field(5, description="監控間隔(秒)")
      QUEUE_ALERT_COOLDOWN: int = Field(30, description="警報冷卻時間(秒)")
      ```
    - 移除 `azure_openai_v2.py` 中的硬編碼常數：
      ```python
      # 舊：MAX_CONCURRENT_TRANSCRIPTIONS = 1
      # 新：從 settings 讀取
      ```
    - 更新 `TranscriptionQueueManager` 使用配置值
  - ⚠️ 關鍵：保持現有錯誤處理、監控、段落過濾機制
  - 🆔 TaskID: `7346d0d6-cc90-4996-b812-e1d476fb1614`
  - ✅ 驗證標準：配置正確讀取、支援 3 並發、向後兼容、日誌正確

- [ ] **Task 2: 啟用滑動視窗API配額控制（立即生效）**
  - 📁 檔案：`.env.local`, `app/core/config.py`
  - 🎯 啟用現有的滑動視窗機制，採用用戶建議的配置參數
  - 📋 配置調整（立即可行）：
    ```bash
    # 啟用現有滑動視窗（用戶方案核心）
    USE_SLIDING_WINDOW_RATE_LIMIT=true
    
    # 保持3 requests/60s（符合Azure API限制）
    SLIDING_WINDOW_MAX_REQUESTS=3
    SLIDING_WINDOW_SECONDS=60
    ```
  - ⚠️ 關鍵：現有實現比用戶的 `SlidingLimiter` 更完善（有統計、監控）
  - 🔄 依賴：Task 1 完成
  - 🆔 TaskID: `b61d8e48-5ab2-4de8-a828-6b10748eec48`
  - ✅ 驗證標準：API 頻率控制正確、無 429 錯誤、Prometheus 指標正常

- [ ] **Task 3: 優化隊列監控參數（用戶建議）**
  - 📁 檔案：`app/core/config.py`, `app/services/azure_openai_v2.py`
  - 🎯 採用用戶建議的監控參數，提供更及時的狀態回饋
  - 📋 監控優化（用戶建議的參數）：
    ```python
    # 用戶建議：更及時的監控
    QUEUE_BACKLOG_THRESHOLD = 10     # 從30降到10（用戶建議）
    QUEUE_MONITOR_INTERVAL = 5       # 從10s降到5s（用戶建議）
    QUEUE_ALERT_COOLDOWN = 30        # 從60s降到30s（用戶建議）
    ```
  - ⚠️ 優勢：現有系統比用戶的簡單廣播更完善（Prometheus + WebSocket）
  - 🔄 依賴：Task 1 完成
  - 🆔 TaskID: `0941f260-d478-4ec7-be06-4f217b109acd`
  - ✅ 驗證標準：積壓早期檢測、監控回饋及時、警報合理

- [ ] **Task 4: 整合配置到環境變數（5分鐘立即解決80%問題）**
  - 📁 檔案：`.env.local`
  - 🎯 採用用戶建議的參數值，提供立即可用的配置
  - 📋 立即可行的配置（基於用戶方案）：
    ```bash
    # ============================================
    # 🚀 並發處理優化配置（用戶建議參數）
    # ============================================
    # 核心瓶頸解決：從單併發提升到3併發
    MAX_CONCURRENT_TRANSCRIPTIONS=3
    TRANSCRIPTION_WORKERS_COUNT=3
    
    # 監控優化：更及時的狀態回饋（用戶建議）
    QUEUE_BACKLOG_THRESHOLD=10        # 從30降到10
    QUEUE_MONITOR_INTERVAL=5          # 從10s降到5s  
    QUEUE_ALERT_COOLDOWN=30           # 從60s降到30s
    
    # ============================================
    # 🪟 滑動視窗API控制（啟用現有機制）
    # ============================================
    # 啟用滑動視窗（用戶方案核心邏輯）
    USE_SLIDING_WINDOW_RATE_LIMIT=true
    
    # Azure API配額控制：3 requests/60s
    SLIDING_WINDOW_MAX_REQUESTS=3
    SLIDING_WINDOW_SECONDS=60
    ```
  - ⚠️ 關鍵：這些參數可立即生效，無需重寫代碼
  - 🔄 依賴：Task 1, 2, 3 完成
  - 🆔 TaskID: `bb7f495f-a788-4dd9-b216-9978f77d3a9a`
  - ✅ 驗證標準：環境變數正確讀取、配置匹配、註釋清楚

- [ ] **Task 5: 測試驗證優化效果（預期10-15秒延遲）**
  - 📁 檔案：系統整體測試
  - 🎯 驗證用戶方案的預期效果：字幕平均延遲 ≈ 10-15s
  - 📋 測試步驟（基於用戶方案流程）：
    ```bash
    # 1. 重啟服務應用新配置
    make restart
    
    # 2. 檢查配置載入（用戶建議的參數）
    # - MAX_CONCURRENT=3 ✓
    # - SLIDING_WINDOW enabled ✓  
    # - QUEUE_ALERT=10 ✓
    
    # 3. 驗證併發流程（用戶方案核心）
    # queue.get() → sem.acquire() → sliding.acquire() → call_whisper()
    
    # 4. 測試預期效果
    # - 錄音2-3分鐘測試逐字稿速度
    # - 預期：延遲降至10-15秒（用戶方案目標）
    # - 監控：3個並發任務同時處理
    ```
  - ⚠️ 關鍵：現有架構保留了錯誤處理、段落過濾等用戶方案未涵蓋的功能
  - 🔄 依賴：Task 1, 2, 3, 4 完成
  - 🆔 TaskID: `52eea2c3-d684-4119-9b6f-91da8e234bc3`
  - ✅ 驗證標準：延遲 < 15秒、支援 3 並發、積壓解決、穩定性維持

### 🎯 預期效果（基於用戶方案）
- ✅ **延遲優化**：從 60 秒+ 降至 10-15 秒（用戶方案目標）
- ✅ **併發提升**：支援 3 個音檔切片並發處理（`sem.acquire()`）  
- ✅ **API控制**：永不 429 錯誤（`sliding.acquire()`）
- ✅ **隊列防護**：保證不丟檔（`queue.get()`）
- ✅ **架構優勢**：保留現有錯誤處理、監控、段落過濾機制

### 📊 方案對比

| 指標     | 現況         | 用戶方案 | 現有架構優化後 |
| -------- | ------------ | -------- | -------------- |
| 併發處理 | 1個          | 3個      | 3個 ✅          |
| API控制  | 手動         | 滑動視窗 | 滑動視窗 ✅     |
| 延遲時間 | 60s+         | 10-15s   | 10-15s ✅       |
| 錯誤處理 | 完整         | 簡化     | 完整 ✅         |
| 監控系統 | Prometheus   | 基礎廣播 | Prometheus ✅   |
| 段落過濾 | verbose_json | 無       | verbose_json ✅ |

### 🚀 立即行動（5分鐘解決）
```bash
# 在 .env.local 中修改這幾行即可立即生效
MAX_CONCURRENT_TRANSCRIPTIONS=3
USE_SLIDING_WINDOW_RATE_LIMIT=true  
QUEUE_BACKLOG_THRESHOLD=10
QUEUE_MONITOR_INTERVAL=5

# 然後重啟
make restart
```

### 注意事項
- 🔬 **基於現有架構**：無需重寫，只需參數調優
- 📊 **保留企業級功能**：錯誤處理、監控、段落過濾
- 🔄 **可快速回滾**：如遇問題可立即恢復單並發
- 📝 **效果監控**：Prometheus指標可即時觀測優化效果
