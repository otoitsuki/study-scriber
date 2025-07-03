# 音頻切片時間配置指南

## 📋 概述

Study Scriber 支援透過環境變數配置音頻切片時間，讓你可以根據需求調整錄音間隔。

## ⚙️ 配置方式

### 後端配置

修改 `.env` 檔案（根目錄）：

```bash
# 音頻切片時長（秒）- 控制錄音和處理間隔
AUDIO_CHUNK_DURATION_SEC=10

# 逐字稿顯示間隔（秒）- 控制時間戳顯示間隔
TRANSCRIPT_DISPLAY_INTERVAL_SEC=10
```

### 前端配置

修改 `frontend/.env.local` 檔案：

```bash
# 方法一：直接設定毫秒數 (優先級較高)
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS=10000

# 方法二：設定秒數 (會自動轉換為毫秒)
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC=10
```

> ⚠️ **重要**：前後端設定值必須保持一致！

## 🔄 設定範例

### 5 秒切片（低延遲）

**後端 `.env`：**
```bash
AUDIO_CHUNK_DURATION_SEC=5
```

**前端 `frontend/.env.local`：**
```bash
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC=5
```

### 15 秒切片（省頻寬）

**後端 `.env`：**
```bash
AUDIO_CHUNK_DURATION_SEC=15
```

**前端 `frontend/.env.local`：**
```bash
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC=15
```

### 30 秒切片（適合長時間會議）

**後端 `.env`：**
```bash
AUDIO_CHUNK_DURATION_SEC=30
```

**前端 `frontend/.env.local`：**
```bash
NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC=30
```

## 🎯 建議值

| 使用場景 | 音頻切片時長 | 逐字稿顯示間隔 | 優點               | 缺點         |
| -------- | ------------ | -------------- | ------------------ | ------------ |
| 即時對話 | 5-8 秒       | 5-8 秒         | 低延遲，快速反應   | 較多網路請求 |
| 標準筆記 | 10-15 秒     | 10 秒          | 平衡效能與延遲     | 預設推薦     |
| 長時會議 | 20-30 秒     | 15-20 秒       | 節省頻寬，減少請求 | 較高延遲     |

## 🔧 高級配置：分離音頻切片與顯示間隔

你現在可以**獨立調整**兩個設定：

### 音頻切片時長 (`AUDIO_CHUNK_DURATION_SEC`)
- 控制前端每隔多久發送音頻數據到後端
- 影響網路流量和處理延遲
- 建議值：10-15 秒

### 逐字稿顯示間隔 (`TRANSCRIPT_DISPLAY_INTERVAL_SEC`)  
- 控制逐字稿時間戳的顯示間隔
- 純視覺效果，不影響實際處理
- 建議值：10 秒（較好的閱讀體驗）

### 範例組合
```bash
# 組合 1：標準配置（兩者一致）
AUDIO_CHUNK_DURATION_SEC=15
TRANSCRIPT_DISPLAY_INTERVAL_SEC=15

# 組合 2：優化顯示（你目前的偏好）
AUDIO_CHUNK_DURATION_SEC=15  # 較長間隔，節省頻寬
TRANSCRIPT_DISPLAY_INTERVAL_SEC=10  # 較短顯示，更好體驗

# 組合 3：超快響應
AUDIO_CHUNK_DURATION_SEC=8
TRANSCRIPT_DISPLAY_INTERVAL_SEC=8
```

## 🔧 重啟要求

修改環境變數後需要重啟服務：

```bash
# 重啟後端
make restart

# 重啟前端 (新終端視窗)
cd frontend
npm run dev
```

## 🐛 疑難排解

### Q: 前後端設定不一致會怎樣？
A: 可能導致轉錄延遲、音頻丟失或錯誤同步。

### Q: 切片時間過短會有什麼問題？
A: 增加網路負載，可能造成頻繁的 API 呼叫。

### Q: 切片時間過長會有什麼問題？
A: 增加轉錄延遲，用戶體驗較差。

### Q: 如何驗證配置是否生效？
A: 查看瀏覽器開發者工具 Console，會顯示當前音頻配置：
```
🔧 [Config] 音訊配置: {
  chunkInterval: 10000,
  chunkIntervalSec: 10,
  mimeType: "audio/webm;codecs=opus",
  source: "SEC"
}
```

## 📁 相關檔案

**後端**：
- `app/core/config.py` - 配置定義
- `app/api/segments.py` - 使用配置
- `app/services/azure_openai_v2.py` - 轉錄服務

**前端**：
- `frontend/lib/config.ts` - 配置管理
- `frontend/lib/*-audio-recorder.ts` - 錄音器類別
- `frontend/hooks/use-recording.ts` - 錄音 Hook 
