-- StudyScriber Supabase 資料庫初始化腳本
-- 專為 Supabase 環境設計的資料庫架構

-- 建立自定義類型 (Enum)
DO $$ BEGIN
    CREATE TYPE session_type AS ENUM ('note_only', 'recording');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('active', 'completed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE lang_code AS ENUM ('zh-TW', 'en-US');
    COMMENT ON TYPE lang_code IS '語言代碼：zh-TW=繁體中文, en-US=美式英文';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 建立 sessions 表
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    type session_type NOT NULL DEFAULT 'note_only',
    status session_status NOT NULL DEFAULT 'active',
    title VARCHAR(255) DEFAULT '未命名筆記',
    language lang_code NOT NULL DEFAULT 'zh-TW',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ NULL
);

-- 建立 notes 表
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- 每個 session 只能有一個筆記
    UNIQUE (session_id)
);

-- 建立 audio_files 表
CREATE TABLE IF NOT EXISTS audio_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    chunk_sequence INTEGER NOT NULL,
    blob_url TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    duration_seconds DECIMAL(10, 3),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- 每個 session 的 chunk_sequence 必須唯一
    UNIQUE (session_id, chunk_sequence)
);

-- 建立 transcript_segments 表
CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    chunk_sequence INTEGER NOT NULL,
    start_time DECIMAL(10, 3) NOT NULL,
    end_time DECIMAL(10, 3) NOT NULL,
    text TEXT NOT NULL,
    confidence DECIMAL(5, 4) DEFAULT 0.0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 建立 transcripts 表
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    full_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    -- 每個 session 只能有一個完整逐字稿
    UNIQUE (session_id)
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at);

CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes (session_id);

CREATE INDEX IF NOT EXISTS idx_audio_files_session_id ON audio_files (session_id);

CREATE INDEX IF NOT EXISTS idx_audio_files_sequence ON audio_files (session_id, chunk_sequence);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_id ON transcript_segments (session_id);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_sequence ON transcript_segments (session_id, chunk_sequence);

CREATE INDEX IF NOT EXISTS idx_transcripts_session_id ON transcripts (session_id);

-- 建立更新時間戳的觸發器函式
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 為需要的表格建立更新時間戳觸發器
DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_notes_updated_at ON notes;

CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_transcripts_updated_at ON transcripts;

CREATE TRIGGER update_transcripts_updated_at
    BEFORE UPDATE ON transcripts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 建立單一 active session 約束觸發器函式
CREATE OR REPLACE FUNCTION check_single_active_session()
RETURNS TRIGGER AS $$
BEGIN
    -- 檢查是否有其他 active session
    IF NEW.status = 'active' THEN
        -- 將其他 active session 設為 completed
        UPDATE sessions
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP
        WHERE status = 'active' AND id != NEW.id;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

-- 建立觸發器確保單一 active session
DROP TRIGGER IF EXISTS ensure_single_active_session ON sessions;

CREATE TRIGGER ensure_single_active_session
    BEFORE INSERT OR UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION check_single_active_session();

-- 成功信息
SELECT 'StudyScriber 資料庫初始化完成！' as message;