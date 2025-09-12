-- 資料庫遷移：為 audio_files 表添加處理狀態追蹤欄位
-- 執行日期：2025-09-12
-- 目的：修復重啟後繼續處理舊切片的問題

-- 1. 為 audio_files 表添加處理狀態相關欄位
ALTER TABLE audio_files 
ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'uploaded' 
CHECK (processing_status IN ('uploaded', 'transcribing', 'completed', 'failed'));

ALTER TABLE audio_files 
ADD COLUMN IF NOT EXISTS error_message TEXT;

ALTER TABLE audio_files 
ADD COLUMN IF NOT EXISTS transcription_started_at TIMESTAMPTZ;

ALTER TABLE audio_files 
ADD COLUMN IF NOT EXISTS transcription_completed_at TIMESTAMPTZ;

ALTER TABLE audio_files 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- 2. 創建相關索引以優化查詢性能
CREATE INDEX IF NOT EXISTS idx_audio_files_processing_status ON audio_files (processing_status);
CREATE INDEX IF NOT EXISTS idx_audio_files_session_status ON audio_files (session_id, processing_status);

-- 3. 初始化現有記錄的處理狀態
-- 將所有現有音檔設為 'completed' 狀態，避免重新處理
UPDATE audio_files 
SET processing_status = 'completed',
    transcription_completed_at = created_at,
    updated_at = NOW()
WHERE processing_status IS NULL OR processing_status = 'uploaded';

-- 4. 創建觸發器自動更新 updated_at 時間戳
CREATE OR REPLACE FUNCTION update_audio_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_audio_files_updated_at_trigger 
    BEFORE UPDATE ON audio_files 
    FOR EACH ROW 
    EXECUTE PROCEDURE update_audio_files_updated_at();

-- 5. 添加註解說明欄位用途
COMMENT ON COLUMN audio_files.processing_status IS '處理狀態：uploaded=已上傳, transcribing=轉錄中, completed=完成, failed=失敗';
COMMENT ON COLUMN audio_files.error_message IS '錯誤訊息（當 processing_status=failed 時）';
COMMENT ON COLUMN audio_files.transcription_started_at IS '開始轉錄的時間';
COMMENT ON COLUMN audio_files.transcription_completed_at IS '完成轉錄的時間';
COMMENT ON COLUMN audio_files.updated_at IS '記錄最後更新時間';