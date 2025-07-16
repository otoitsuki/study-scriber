# StudyScriber PRD 對齊設計文件

## 概述

本設計文件詳細規劃如何將現有的 PRD 文件與實際程式實作進行對齊，確保產品需求文件準確反映系統的真實功能、技術架構和用戶體驗。

## 架構

### 文件結構設計

```
PRD.md (更新後)
├── 1. 專案願景 (保持不變)
├── 2. 產品定位 (微調目標族群描述)
├── 3. 核心功能 (大幅更新)
│   ├── 3.1 雲端 Markdown 筆記系統
│   ├── 3.2 雙模式錄音與即時轉錄
│   ├── 3.3 雙引擎語音辨識系統
│   ├── 3.4 會話管理與狀態控制
│   └── 3.5 智能匯出與資料打包
├── 4. 技術架構 (新增)
│   ├── 4.1 後端技術棧
│   ├── 4.2 前端技術棧
│   ├── 4.3 資料庫設計
│   └── 4.4 雲端服務整合
└── 5. 用戶體驗流程 (新增)
    ├── 5.1 純筆記模式流程
    ├── 5.2 錄音模式流程
    └── 5.3 匯出與分享流程
```

### 內容對齊策略

1. **保留原有願景**：維持產品的核心價值主張
2. **擴展功能描述**：詳細描述實際實作的功能
3. **新增技術細節**：補充技術架構和實作細節
4. **完善用戶流程**：描述實際的用戶操作體驗

## 組件和介面

### 核心功能組件

#### 3.1 雲端 Markdown 筆記系統
- **實作狀態**：✅ 已完成
- **技術實現**：React + Supabase + 自動儲存
- **關鍵特性**：
  - 即時自動儲存
  - 時間戳衝突檢測
  - 離線草稿支援
  - UPSERT 邏輯

#### 3.2 雙模式錄音與即時轉錄
- **實作狀態**：✅ 已完成
- **技術實現**：WebM 直接轉錄 + WebSocket 即時推送
- **關鍵特性**：
  - note_only 和 recording 雙模式
  - 會話升級機制
  - 10秒音檔切片
  - 背景處理轉錄

#### 3.3 雙引擎語音辨識系統
- **實作狀態**：✅ 已完成
- **技術實現**：Factory Pattern + Provider 介面
- **支援引擎**：
  - Whisper (Azure OpenAI)
  - Gemini 2.5 Pro (Vertex AI)
- **關鍵特性**：
  - UI 即時切換
  - 會話級別管理
  - 統一介面設計

#### 3.4 會話管理與狀態控制
- **實作狀態**：✅ 已完成
- **技術實現**：狀態機 + 資料庫約束
- **狀態類型**：
  - 會話狀態：active, completed, error
  - 錄音狀態：default, recording_waiting, recording_active, finish
- **關鍵特性**：
  - 單一活躍會話限制
  - 自動狀態轉換
  - 錯誤恢復機制

#### 3.5 智能匯出與資料打包
- **實作狀態**：✅ 已完成
- **技術實現**：ZIP 打包 + 時間戳格式化
- **匯出內容**：
  - Markdown 筆記 (note.md)
  - 時間戳逐字稿 (transcript.txt)
- **格式範例**：`[00:01:23] 逐字稿內容`

### 技術架構組件

#### 4.1 後端技術棧
```python
FastAPI (Web 框架)
├── Supabase PostgreSQL (資料庫)
├── SQLAlchemy 2.0 (ORM)
├── WebSocket (即時通訊)
├── Azure OpenAI (Whisper STT)
├── Google Vertex AI (Gemini STT)
└── Cloudflare R2 (音檔儲存)
```

#### 4.2 前端技術棧
```typescript
React + Next.js (UI 框架)
├── TypeScript (型別安全)
├── Tailwind CSS + shadcn/ui (樣式)
├── Zustand (狀態管理)
├── WebSocket Client (即時通訊)
└── MediaRecorder API (音檔錄製)
```

#### 4.3 資料庫設計
```sql
sessions (會話管理)
├── notes (筆記內容) [1:1]
├── audio_files (音檔切片) [1:N]
├── transcript_segments (逐字稿片段) [1:N]
└── transcripts (完整逐字稿) [1:1]
```

## 資料模型

### 會話資料模型
```typescript
interface Session {
  id: UUID
  type: 'note_only' | 'recording'
  status: 'active' | 'completed' | 'error'
  title: string
  lang_code: 'zh-TW' | 'en-US'
  stt_provider: 'whisper' | 'gemini'
  started_at?: DateTime
  completed_at?: DateTime
  created_at: DateTime
  updated_at: DateTime
}
```

### 筆記資料模型
```typescript
interface Note {
  id: UUID
  session_id: UUID
  content: string  // Markdown 內容
  client_ts?: DateTime  // 客戶端時間戳
  created_at: DateTime
  updated_at: DateTime
}
```

### 逐字稿資料模型
```typescript
interface TranscriptSegment {
  id: UUID
  session_id: UUID
  chunk_sequence: number
  start_time: number  // 秒數
  end_time: number
  text: string
  confidence: number
  lang_code: 'zh-TW' | 'en-US'
  created_at: DateTime
}
```

## 錯誤處理

### 轉錄錯誤處理
1. **音檔上傳失敗**：重試機制 + 用戶提示
2. **STT 服務錯誤**：自動切換備用 Provider
3. **網路中斷**：離線模式 + 自動恢復
4. **時間戳衝突**：版本比較 + 合併提示

### 會話狀態錯誤
1. **重複活躍會話**：資料庫約束防護
2. **狀態不一致**：前端狀態同步機制
3. **WebSocket 斷線**：自動重連 + 狀態恢復

## 測試策略

### 單元測試
- API 端點測試 (FastAPI TestClient)
- 前端組件測試 (Vitest + React Testing Library)
- STT Provider 測試 (Mock 服務)

### 整合測試
- 端到端錄音流程測試 (Playwright)
- WebSocket 通訊測試
- 資料庫約束測試

### 效能測試
- 音檔上傳效能測試
- 即時轉錄延遲測試
- 大量逐字稿渲染測試

## 部署與維運

### 環境配置
```env
# 必須配置
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=xxx
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_ENDPOINT=xxx

# 可選配置
GEMINI_API_KEY=xxx  # 啟用 Gemini STT
R2_ACCOUNT_ID=xxx   # 啟用 R2 儲存
```

### 監控指標
- 轉錄成功率
- WebSocket 連接穩定性
- 資料庫查詢效能
- 用戶會話完成率

## 用戶體驗設計

### 純筆記模式流程
1. 用戶開啟應用 → 顯示 DefaultState
2. 直接編輯筆記 → 自動建立 note_only 會話
3. 內容自動儲存 → 時間戳衝突檢測
4. 可選升級為錄音模式

### 錄音模式流程
1. 點擊 "Start Recording" → 建立 recording 會話
2. 顯示 RecordingWaitingState → 等待首個逐字稿
3. 收到逐字稿 → 切換至 RecordingActiveState
4. 停止錄音 → 切換至 FinishState
5. 完成會話 → 返回 DefaultState

### STT Provider 切換流程
1. 點擊設定按鈕 → 顯示 Provider 選項
2. 選擇新 Provider → 檢查會話狀態
3. 未開始錄音 → 允許切換
4. 已開始錄音 → 顯示錯誤提示

## 技術決策記錄

### WebM 直接轉錄架構
- **決策**：跳過 FFmpeg 轉換，直接發送 WebM 到 STT API
- **原因**：減少 60% 處理時間，降低 80% 錯誤率
- **權衡**：需要 STT 服務支援 WebM 格式

### 雙 STT Provider 設計
- **決策**：使用 Factory Pattern 支援多個 STT 引擎
- **原因**：提供用戶選擇，降低單一服務依賴風險
- **權衡**：增加系統複雜度，需要統一介面設計

### 單一活躍會話限制
- **決策**：資料庫層級約束確保同時只有一個活躍會話
- **原因**：簡化狀態管理，避免資源衝突
- **權衡**：限制多會話並行使用場景
