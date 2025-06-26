# StudyScriber 測試工具

## WebSocket 推送測試

### 🧪 測試工具

1. **`test/websocket_push_test.py`** - 完整的 WebSocket 推送測試
2. **`test/websocket_debug.py`** - 快速除錯工具  
3. **`test/simple_websocket_test.py`** - 簡化測試工具
4. **`test/frontend_debug.html`** - 前端 WebSocket 除錯工具

### 目的
測試後端 WebSocket 是否正確推送逐字稿到前端應用程式。

### 測試步驟

#### 1. 啟動服務
```bash
# 啟動後端服務
uv run python main.py

# 啟動前端服務（另一個終端）
cd frontend
npm run dev
```

#### 2. 建立錄音 Session
1. 開啟瀏覽器到 `http://localhost:3000`
2. 點擊「開始錄音」按鈕
3. 前端會建立新的錄音 session 並轉到 recording 狀態

#### 3. 取得 Session ID
從瀏覽器開發者工具中找到 session_id：

**方法 1: 從 Network 面板**
- 開啟 F12 開發者工具
- 切換到 Network 面板
- 尋找 WebSocket 連接，URL 類似：`ws://localhost:8000/ws/transcript_feed/{session_id}`
- 複製 session_id

**方法 2: 從 Console 面板**
- 開啟 F12 開發者工具
- 切換到 Console 面板
- 尋找類似訊息：`✅ WebSocket 連接成功: ws://localhost:8000/ws/transcript_feed/{session_id}`
- 複製 session_id

#### 4. 執行推送測試
```bash
# 執行 WebSocket 推送測試
python test/websocket_push_test.py <session_id>

# 範例
python test/websocket_push_test.py 12345678-1234-1234-1234-123456789abc
```

#### 5. 觀察結果
在前端應用程式中觀察：

✅ **正常情況下應該看到：**
- RecordingState 組件的逐字稿區域顯示測試文字
- 逐字稿按順序出現（每3秒一段）
- 收到 `transcript_complete` 後狀態轉為 `finished`
- 瀏覽器 Console 無錯誤訊息

❌ **問題情況：**
- 逐字稿區域空白或不更新
- Console 有 WebSocket 錯誤
- 狀態未正確轉換

### 測試訊息內容
測試腳本會依序推送以下逐字稿：
1. "歡迎使用 StudyScriber 雲端筆記應用程式"
2. "這是一個支援即時語音轉錄的智慧筆記工具"
3. "我們正在測試 WebSocket 推送功能是否正常運作"
4. "如果你能在前端看到這些文字，表示推送功能正常"
5. "接下來會測試更長的逐字稿內容"
6. "包含標點符號、數字 123 和英文 Hello World"
7. "最後我們會發送轉錄完成的訊息"

### 疑難排解

#### 連接失敗
- 確認後端服務正在運行
- 確認 WebSocket 端點可用
- 檢查 session_id 是否正確

#### 前端無反應
- 檢查前端是否在 recording 狀態
- 檢查瀏覽器 Console 是否有錯誤
- 確認 TranscriptWebSocket 連接正常

#### 狀態未轉換
- 檢查 useAppState Hook 是否正確處理 `transcript_complete`
- 檢查 TranscriptManager 是否正確接收訊息

### 進階測試

#### 手動測試特定訊息
修改 `test/websocket_push_test.py` 中的 `test_segments` 陣列來測試特定內容。

#### 測試不同訊息格式
可以修改 `create_test_transcript_message` 方法來測試不同的訊息格式。

## 🔧 前端除錯工具

如果前端應用程式無法正常顯示逐字稿，可以使用專門的除錯工具：

### 使用 `test/frontend_debug.html`
1. 用瀏覽器開啟 `file:///path/to/test/frontend_debug.html`
2. 輸入 Session ID（或使用預設值）
3. 點擊「連接 WebSocket」
4. 在另一個終端執行推送測試：
   ```bash
   python test/simple_websocket_test.py <session_id>
   ```
5. 觀察除錯頁面的日誌，確認：
   - WebSocket 是否成功連接
   - 是否收到逐字稿訊息
   - 訊息格式是否正確

### 除錯功能
- **即時連接狀態**：顯示 WebSocket 連接狀態
- **訊息日誌**：記錄所有收發的訊息
- **測試工具**：可發送 ping 訊息測試連接
- **逐字稿高亮**：特別標示逐字稿內容

### 相關檔案
- `test/websocket_push_test.py` - WebSocket 推送測試腳本
- `test/frontend_debug.html` - 前端 WebSocket 除錯工具
- `frontend/lib/websocket.ts` - 前端 WebSocket 管理
- `frontend/hooks/use-transcript.ts` - 逐字稿接收 Hook
- `app/ws/transcript_feed.py` - 後端 WebSocket 端點 
