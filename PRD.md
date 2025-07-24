# StudyScriber PRD

---

## 1. 專案願景

提供「邊錄邊轉錄」的雲端筆記，讓內部訓練、講座筆記一次到位：可選錄音、即時逐字稿、Markdown 筆記與匯出，一條龍完成。

---

## 2. 產品定位

| 項目     | 描述                                                               |
| -------- | ------------------------------------------------------------------ |
| 目標族群 | 成年自學者                                                         |
| 痛點     | 備課／聽課同時要做筆記、整理逐字稿耗時、有時只需要筆記功能         |
| 核心價值 | 1 個畫面完成「純筆記」或「錄音 → 即時逐字稿 → 筆記」，課後一鍵匯出 |

---

## 3. 核心功能

### 3.1 雲端 Markdown 筆記系統

**實作狀態：** ✅ 已完成  
**技術實現：** React + Supabase + 自動儲存機制  

### 3.2 雙模式錄音與即時轉錄

**實作狀態：** ✅ 已完成  
**技術實現：** WebM 直接轉錄 + WebSocket 即時推送  


### 3.3 雙引擎語音辨識系統

**實作狀態：** ✅ 已完成  
**技術實現：** Factory Pattern + Provider 統一介面  

**支援引擎：**
- **Whisper (Azure OpenAI)**
- **GPT4o**



### 3.4 匯出與資料打包

**實作狀態：** ✅ 已完成  
**技術實現：** ZIP 打包 + 時間戳格式化  

**匯出內容：**
- **Markdown 筆記** (`note.md`)：完整的筆記內容，保持原始格式
- **時間戳逐字稿** (`transcript.txt`)：格式化的逐字稿，包含精確時間戳

---

## 4. 技術架構

### 4.1 後端技術棧

**核心框架：** FastAPI (Python)  
**資料庫：** Supabase PostgreSQL  
**即時通訊：** WebSocket  

**技術組件：**
```python
FastAPI (Web 框架)
├── Pydantic (資料驗證)
├── WebSocket (即時通訊)
├── Azure OpenAI (STT)
├── Cloudflare R2 (音檔儲存)
└── FFmpeg (音檔處理)
```

**關鍵特性：**
- **高效能 API**：FastAPI 提供自動 API 文件生成和高效能非同步處理
- **型別安全**：Pydantic 確保資料驗證和序列化的型別安全
- **即時通訊**：WebSocket 支援即時逐字稿推送和狀態同步
- **音檔處理**：FFmpeg 支援多格式音檔轉換和處理

### 4.2 前端技術棧

**核心框架：** React + Next.js  
**程式語言：** TypeScript  
**狀態管理：** Zustand  

**技術組件：**
```typescript
React + Next.js (UI 框架)
├── TypeScript (型別安全)
├── Tailwind CSS + shadcn/ui (樣式系統)
├── Zustand (狀態管理)
├── WebSocket Client (即時通訊)
├── MediaRecorder API (音檔錄製)
└── Vitest + Playwright (測試框架)
```

**關鍵特性：**
- **現代化 UI**：React 18 + Next.js 13 提供最新的前端開發體驗
- **型別安全**：TypeScript 確保編譯時型別檢查，減少執行時錯誤
- **響應式設計**：Tailwind CSS + shadcn/ui 提供一致的設計系統
- **輕量狀態管理**：Zustand 提供簡潔的狀態管理解決方案
- **原生音檔錄製**：MediaRecorder API 支援瀏覽器原生音檔錄製

### 4.3 資料庫設計

**資料庫系統：** Supabase PostgreSQL  
