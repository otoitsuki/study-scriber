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
