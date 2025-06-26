# StudyScriber 測試套件

## 🎯 「一段一轉」架構測試

本測試套件專為 StudyScriber 的「一段一轉」轉錄架構設計，確保系統的穩定性和性能。

### 📋 測試結構

```
tests/
├── unit/                           # 單元測試
│   ├── test_transcription_logic.py # 轉錄邏輯核心測試
│   ├── test_azure_openai_v2.py     # Azure OpenAI 服務測試
│   └── test_upload_audio.py        # 音檔上傳測試
├── integration/                    # 整合測試
│   └── test_one_chunk_one_transcription.py  # 完整流程測試
├── fixtures/                       # 測試資料
├── conftest.py                     # pytest 配置
└── test_report.py                  # 測試報告生成器
```

### 🧪 執行測試

#### 使用 Makefile（推薦）

```bash
# 查看所有可用命令
make help

# 執行所有測試
make test

# 執行單元測試
make test-unit

# 生成詳細測試報告
make test-report

# 驗證架構完整性
make verify-architecture
```

#### 直接使用 pytest

```bash
# 執行所有測試
uv run pytest tests/ -v

# 執行特定測試檔案
uv run pytest tests/unit/test_transcription_logic.py -v

# 執行特定測試
uv run pytest tests/unit/test_transcription_logic.py::TestTranscriptionLogic::test_twelve_second_chunks -v
```

### 🏗️ 架構測試重點

#### 1. 核心邏輯測試
- ✅ **12秒切片處理** - 驗證固定間隔切片
- ✅ **低延遲處理** - 確保處理時間 < 500ms
- ✅ **並行處理** - 多切片同時處理
- ✅ **順序處理** - 連續切片處理
- ✅ **錯誤處理** - 無效資料處理
- ✅ **重複切片處理** - 防止重複處理

#### 2. 資料格式測試
- ✅ **WebM 驗證** - 簡化驗證邏輯
- ✅ **WAV 轉換** - FFmpeg 轉換測試
- ✅ **轉錄功能** - 模擬 API 呼叫

#### 3. 性能測試
- ✅ **處理時間** - 端到端延遲測量
- ✅ **併發處理** - 多任務並行能力
- ✅ **資源清理** - 任務完成後清理

### 📊 測試報告

執行 `make test-report` 會生成詳細的測試報告，包含：

- 📈 測試通過率統計
- 🏗️ 架構驗證狀態
- ⚡ 性能指標評估
- 💡 下一步建議

### 🔧 架構驗證

「一段一轉」架構的關鍵特性：

| 特性 | 舊方式 | 新方式 |
|------|--------|--------|
| **處理流程** | 收集→合併→轉錄 | 直接轉錄 |
| **延遲** | 累積延遲 | **幾百毫秒** |
| **切片間隔** | 不定 | **12秒固定** |
| **錯誤處理** | 影響整批 | **單個重試** |
| **程式複雜度** | 高 | **簡潔** |

### 🚀 資料流

```
前端錄音 (12s) → WebM chunk → WebSocket 上傳 
                                    ↓
                              FFmpeg stdin 
                                    ↓
                              WAV bytes 
                                    ↓
                              Whisper API
                                    ↓
                              逐字稿結果 ← WebSocket 推送
```

### 🛠️ 技術細節

#### FFmpeg 參數優化
```bash
ffmpeg -fflags +genpts -i pipe:0 -ac 1 -ar 16000 -f wav -y pipe:1
```
- `-fflags +genpts`: 處理不完整的流式資料
- `-ac 1`: 單聲道
- `-ar 16000`: 16kHz 採樣率
- `-y`: 覆蓋輸出

#### 前端配置
```typescript
const config = {
    chunkInterval: 12000,  // 12秒切片
    mimeType: 'audio/webm;codecs=opus'
};
```

### 🐛 故障排除

#### 測試失敗常見原因

1. **資料庫連接錯誤**
   - 確保測試環境變數正確設定
   - 檢查 `tests/conftest.py` 中的模擬配置

2. **依賴項目缺失**
   ```bash
   uv sync  # 安裝 Python 依賴
   ```

3. **FFmpeg 未安裝**
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu
   sudo apt install ffmpeg
   ```

#### 測試環境檢查
```bash
make check-env  # 檢查開發環境
```

### 📝 新增測試

#### 單元測試範例
```python
@pytest.mark.asyncio
async def test_new_feature(service, session_id):
    """測試新功能"""
    result = await service.new_method(session_id, test_data)
    assert result is not None
    # 更多斷言...
```

#### 整合測試範例
```python
@pytest.mark.asyncio
async def test_end_to_end_flow():
    """測試端到端流程"""
    # 設定測試資料
    # 執行完整流程
    # 驗證結果
```

### 🔄 持續整合

測試應該在以下情況執行：
- 🔄 每次程式碼提交前
- 🚀 部署前驗證
- 📅 定期回歸測試
- 🐛 修復 bug 後驗證

### 📚 相關資源

- [pytest 官方文檔](https://docs.pytest.org/)
- [FastAPI 測試指南](https://fastapi.tiangolo.com/tutorial/testing/)
- [Azure OpenAI API 文檔](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [WebSocket 測試最佳實踐](https://websockets.readthedocs.io/en/stable/) 
