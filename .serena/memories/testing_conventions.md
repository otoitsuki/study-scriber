# 測試慣例與最佳實踐

## 測試架構
```
tests/
├── unit/              # 單元測試 - 測試單一功能
├── integration/       # 整合測試 - 測試多組件協作
├── fixtures/          # 測試資料與 fixture
└── conftest.py        # pytest 配置

```

## 測試命名規範
- 測試檔案：`test_*.py`
- 測試函數：`test_功能描述()`
- 測試類別：`Test功能類別`

## Mock 策略
### Supabase Mock
```python
@pytest.fixture(autouse=True)
def mock_supabase_globally():
    with patch('app.db.supabase_config.create_client') as mock_create_client:
        mock_client = MagicMock()
        mock_create_client.return_value = mock_client
        yield mock_client
```

### WebSocket 測試
- HTTP API：使用 `AsyncClient`
- WebSocket：使用 `TestClient`

## 測試環境設定
```python
# 避免真實服務連線
os.environ["SUPABASE_URL"] = "https://test.supabase.co"
os.environ["SUPABASE_KEY"] = "test_key"
os.environ["DB_MODE"] = "supabase"
```

## 驗證標準
1. **功能完整性** (30%) - 需求符合度
2. **技術品質** (30%) - 程式碼健壯性  
3. **整合相容性** (20%) - 系統整合
4. **效能擴展性** (20%) - 效能最佳化

## 常見問題解決
- Mock 時機：確保在 app 初始化前就 mock
- 環境變數：測試前設定避免真實連線
- WebSocket：使用正確的 TestClient 方法