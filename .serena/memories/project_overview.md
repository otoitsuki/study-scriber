# StudyScriber 專案概述

## 專案目的
StudyScriber 是雲端筆記應用，提供「邊錄邊轉錄」功能，支援純筆記與錄音模式。

## 技術架構
### 後端
- **FastAPI** - Python Web 框架
- **Supabase PostgreSQL** - 雲端資料庫
- **Azure OpenAI Whisper** - 語音轉錄
- **Cloudflare R2** - 音檔儲存
- **WebSocket** - 即時通訊

### 前端  
- **Next.js + React** - 前端框架
- **TypeScript** - 型別安全
- **Tailwind CSS** - 樣式框架

## 專案結構
```
study-scriber/
├── app/                 # FastAPI 後端
│   ├── api/            # HTTP API 路由
│   ├── ws/             # WebSocket 端點  
│   ├── services/       # 業務邏輯服務
│   ├── db/             # 資料庫配置
│   └── schemas/        # Pydantic 模型
├── frontend/           # Next.js 前端
├── tests/              # 測試套件
│   ├── unit/          # 單元測試
│   └── integration/   # 整合測試
└── main.py            # 應用程式入口
```

## 核心功能
- 四狀態設計：default → recording → processing → finished
- 支援純筆記與錄音模式
- 即時語音轉錄
- Markdown 筆記編輯
- 檔案匯出功能