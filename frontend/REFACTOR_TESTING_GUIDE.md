# 🧪 TranscriptManager 重構測試指南

本指南說明如何安全地測試重構後的 TranscriptManager 實現。

## 📋 **重構概覽**

### **重構內容**
✅ **型別安全** - 使用 TypeScript discriminated union  
✅ **事件驅動** - 移除 hack，使用 EventEmitter  
✅ **可維護性** - 清晰的事件分發機制  
✅ **向後兼容** - 漸進式切換機制  

### **新舊對比**
| 特性       | 舊實現                 | 新實現               |
| ---------- | ---------------------- | -------------------- |
| 型別安全   | ❌ `any` 類型           | ✅ 嚴格型別檢查       |
| 事件處理   | ❌ WebSocket hack       | ✅ TypedEmitter       |
| 程式碼結構 | ❌ 巨型 `handleMessage` | ✅ 分離的處理器       |
| 維護性     | ❌ 難以擴展             | ✅ 易於添加新訊息類型 |

## 🎯 **測試步驟**

### **1. 檢查當前狀態**
```javascript
// 開啟瀏覽器開發者工具，輸入：
window.featureFlags.getAll()

// 應該看到：
// { useRefactoredTranscriptManager: false, ... }
```

### **2. 啟用新實現**
```javascript
// 方法 1: 使用專用測試方法
window.featureFlags.testNewTranscriptManager()

// 方法 2: 手動啟用
window.featureFlags.enableRefactoredTranscriptManager()

// 方法 3: 使用適配器
window.transcriptManagerAdapter.switchToRefactored()
```

### **3. 測試基本功能**
1. **開始錄音** - 點擊錄音按鈕
2. **檢查連接** - 確認 WebSocket 連接成功
3. **逐字稿接收** - 確認能正常接收逐字稿
4. **停止錄音** - 確認能正常停止

### **4. 檢查實現狀態**
```javascript
// 檢查當前使用的實現
window.transcriptManagerAdapter.getCurrentImplementation()
// 應該返回: 'refactored'

// 檢查詳細狀態
window.diagnose()
```

### **5. 切換回舊實現（如需要）**
```javascript
// 如果遇到問題，立即切換回舊實現
window.transcriptManagerAdapter.switchToLegacy()

// 或者
window.featureFlags.disableRefactoredTranscriptManager()
```

## 🔍 **驗證點**

### **✅ 功能正常的標誌**
- [x] WebSocket 連接成功
- [x] 收到 "連接已建立" 訊息
- [x] 逐字稿條目正常顯示
- [x] 狀態從 `recording_waiting` → `recording_active`
- [x] 無 TypeScript 編譯錯誤
- [x] 無控制台 JavaScript 錯誤

### **🚨 需要注意的警告**
```javascript
// 新實現會顯示棄用警告（這是正常的）
⚠️ [TranscriptManager] addListener 已棄用，請使用事件驅動方式
⚠️ [TranscriptManager] removeListener 已棄用，請使用事件驅動方式
```

### **❌ 問題指標**
- ❌ WebSocket 連接失敗
- ❌ 無法接收逐字稿
- ❌ 控制台出現未捕獲的錯誤
- ❌ 狀態卡在 `recording_waiting`

## 🛠️ **除錯工具**

### **全域除錯介面**
```javascript
// 功能旗標控制
window.featureFlags.enableRefactoredTranscriptManager()
window.featureFlags.disableRefactoredTranscriptManager()
window.featureFlags.getAll()

// TranscriptManager 適配器
window.transcriptManagerAdapter.getCurrentImplementation()
window.transcriptManagerAdapter.switchToRefactored()
window.transcriptManagerAdapter.switchToLegacy()
window.transcriptManagerAdapter.reload()

// 原有診斷工具
window.diagnose()
window.transcriptManager // 當前活躍的 manager 實例
```

### **日誌監控**
開啟控制台，關注以下日誌：
```
🎯 [TranscriptManagerAdapter] 使用 新 實現
✅ [TranscriptManagerAdapter] 已載入重構後的 TranscriptManager
🔥 [TranscriptWebSocket] 原始 WebSocket 訊息
🎯 [TranscriptWebSocket] 分發事件: transcript_segment
📝 [TranscriptManager] 收到逐字稿片段
```

## 📊 **測試場景**

### **場景 1: 基本錄音流程**
1. 啟用新實現
2. 開始錄音
3. 等待逐字稿
4. 停止錄音
5. ✅ 驗證完整性

### **場景 2: 切換測試**
1. 使用舊實現錄音（確認正常）
2. 切換到新實現
3. 重新錄音（確認正常）
4. ✅ 驗證切換無問題

### **場景 3: 錯誤恢復**
1. 啟用新實現
2. 如果出現問題
3. 立即切換回舊實現
4. ✅ 驗證業務連續性

## ⚠️ **安全注意事項**

### **回滾策略**
- 🛡️ **預設使用舊實現** - 確保穩定性
- 🔄 **一鍵切換** - 遇到問題立即回滾
- 📝 **狀態保持** - 切換時不影響現有會話

### **監控要點**
- 💻 **客戶端錯誤** - 控制台錯誤監控
- 🌐 **WebSocket 連接** - 連接成功率
- 📈 **功能完整性** - 逐字稿接收率
- ⚡ **性能影響** - 記憶體使用和響應時間

## 🎉 **重構收益**

測試通過後，你將獲得：
- ✅ **型別安全** - 編譯時錯誤檢查
- ✅ **可維護性** - 清晰的程式碼結構
- ✅ **可擴展性** - 易於添加新功能
- ✅ **除錯友善** - TypeScript IntelliSense 支援

---

## 🚀 **立即開始測試**

```javascript
// 複製貼上到控制台，立即開始測試：
console.log('🧪 開始測試重構後的 TranscriptManager')
window.featureFlags.testNewTranscriptManager()
console.log('✅ 新實現已啟用，請開始錄音測試')
```

**祝測試順利！** 🎯 
