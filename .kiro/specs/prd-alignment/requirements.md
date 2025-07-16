# StudyScriber PRD 對齊需求文件

## 簡介

本需求文件旨在將現有的 PRD 文件與實際程式實作進行對齊，確保產品需求文件準確反映系統的實際功能和技術架構。

## 需求

### 需求 1：核心功能對齊

**用戶故事：** 作為產品經理，我希望 PRD 能準確反映系統的實際功能，以便正確傳達產品價值和技術能力。

#### 驗收標準

1. WHEN 檢視 PRD 功能列表 THEN 系統 SHALL 包含所有已實作的核心功能
2. WHEN 描述錄音功能 THEN 系統 SHALL 準確反映 WebM 直接轉錄架構
3. WHEN 說明語音辨識 THEN 系統 SHALL 包含 Whisper 和 Gemini 2.5 Pro 雙引擎支援
4. WHEN 描述筆記功能 THEN 系統 SHALL 反映 Markdown 編輯和自動儲存功能
5. WHEN 說明匯出功能 THEN 系統 SHALL 包含 ZIP 檔案匯出和逐字稿時間戳功能

### 需求 2：技術架構描述

**用戶故事：** 作為技術人員，我希望 PRD 能準確描述系統的技術架構，以便了解實作細節和技術選型。

#### 驗收標準

1. WHEN 描述後端架構 THEN 系統 SHALL 包含 FastAPI、Supabase PostgreSQL、WebSocket 等技術棧
2. WHEN 說明前端架構 THEN 系統 SHALL 包含 React、Next.js、TypeScript 等技術
3. WHEN 描述資料庫設計 THEN 系統 SHALL 反映實際的表格結構和關聯關係
4. WHEN 說明音檔處理 THEN 系統 SHALL 包含 Cloudflare R2 儲存和 FFmpeg 轉換
5. WHEN 描述即時通訊 THEN 系統 SHALL 包含 WebSocket 和 TranscriptManager 架構

### 需求 3：用戶體驗流程

**用戶故事：** 作為用戶，我希望 PRD 能清楚描述實際的使用流程，以便了解產品的操作方式。

#### 驗收標準

1. WHEN 描述純筆記模式 THEN 系統 SHALL 包含直接編輯 Markdown 和自動儲存功能
2. WHEN 描述錄音模式 THEN 系統 SHALL 包含會話建立、即時轉錄、狀態管理流程
3. WHEN 說明會話管理 THEN 系統 SHALL 包含單一活躍會話限制和狀態轉換
4. WHEN 描述 STT Provider 切換 THEN 系統 SHALL 包含 UI 選擇和會話級別管理
5. WHEN 說明匯出流程 THEN 系統 SHALL 包含完整的筆記和逐字稿打包功能

### 需求 4：系統狀態管理

**用戶故事：** 作為開發者，我希望 PRD 能準確描述系統的狀態管理機制，以便理解應用程式的行為邏輯。

#### 驗收標準

1. WHEN 描述會話狀態 THEN 系統 SHALL 包含 active、completed、error 三種狀態
2. WHEN 說明錄音狀態 THEN 系統 SHALL 包含 default、recording_waiting、recording_active、finish 狀態
3. WHEN 描述會話類型 THEN 系統 SHALL 包含 note_only 和 recording 兩種類型
4. WHEN 說明狀態轉換 THEN 系統 SHALL 包含會話升級和完成流程
5. WHEN 描述錯誤處理 THEN 系統 SHALL 包含轉錄失敗和網路錯誤恢復機制

### 需求 5：資料結構對齊

**用戶故事：** 作為資料庫管理員，我希望 PRD 能準確反映實際的資料結構，以便了解資料模型和關聯關係。

#### 驗收標準

1. WHEN 描述會話資料 THEN 系統 SHALL 包含 sessions 表的完整欄位定義
2. WHEN 說明筆記資料 THEN 系統 SHALL 包含 notes 表和時間戳衝突檢測
3. WHEN 描述音檔資料 THEN 系統 SHALL 包含 audio_files 表和 R2 儲存資訊
4. WHEN 說明逐字稿資料 THEN 系統 SHALL 包含 transcript_segments 和 transcripts 表
5. WHEN 描述資料約束 THEN 系統 SHALL 包含外鍵關聯和級聯刪除規則

### 需求 6：API 端點對齊

**用戶故事：** 作為 API 使用者，我希望 PRD 能準確描述可用的 API 端點，以便正確整合系統功能。

#### 驗收標準

1. WHEN 描述會話 API THEN 系統 SHALL 包含建立、完成、升級、刪除等端點
2. WHEN 說明筆記 API THEN 系統 SHALL 包含儲存、取得、匯出等端點
3. WHEN 描述音檔 API THEN 系統 SHALL 包含切片上傳和背景處理流程
4. WHEN 說明匯出 API THEN 系統 SHALL 包含 ZIP 檔案生成和下載功能
5. WHEN 描述 WebSocket API THEN 系統 SHALL 包含即時逐字稿推送機制
