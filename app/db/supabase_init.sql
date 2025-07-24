/* -----------------------------------------------
StudyScriber – Supabase Database Bootstrap v2025-07-13
------------------------------------------------- */

-- ---------- ENUM TYPES ----------
DO $$ BEGIN
    CREATE TYPE session_type AS ENUM ('note_only', 'recording');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM ('active', 'completed', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE lang_code AS ENUM ('zh-TW', 'en-US');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TYPE lang_code IS '語言代碼：zh-TW=繁體中文；en-US=美式英文';

-- ---------- TABLE: sessions ----------
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    user_id UUID REFERENCES auth.users (id),
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ,
    status session_status DEFAULT 'active',
    -- 'recording', 'file_upload'
    type session_type DEFAULT 'recording',
    -- B-016: add lang_code
    lang_code TEXT,
    stt_provider TEXT,
    summary TEXT,
    -- B-019: add started_at
    started_at TIMESTAMPTZ
);

-- ---------- TABLE: notes ----------
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    client_ts TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id) -- 每個 session 僅一條 note
);

-- ---------- TABLE: audio_files ----------
CREATE TABLE IF NOT EXISTS audio_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    chunk_sequence INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    r2_bucket TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    duration_seconds DECIMAL(10, 3),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id, chunk_sequence)
);

-- ---------- TABLE: transcript_segments ----------
CREATE TABLE IF NOT EXISTS transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    chunk_sequence INTEGER NOT NULL,
    start_time DECIMAL(10, 3) NOT NULL,
    end_time DECIMAL(10, 3) NOT NULL,
    text TEXT NOT NULL,
    confidence DECIMAL(5, 4) DEFAULT 0.0,
    lang_code lang_code DEFAULT 'zh-TW', -- ★ 改名
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ---------- TABLE: transcripts ----------
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid (),
    session_id UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    full_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (session_id) -- 每個 session 僅一條完整逐字稿
);

-- ---------- INDEXES ----------
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions (created_at);

CREATE INDEX IF NOT EXISTS idx_notes_session_id ON notes (session_id);

CREATE INDEX IF NOT EXISTS idx_audio_files_session_id ON audio_files (session_id);

CREATE INDEX IF NOT EXISTS idx_audio_files_sequence ON audio_files (session_id, chunk_sequence);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_session_id ON transcript_segments (session_id);

CREATE INDEX IF NOT EXISTS idx_transcript_segments_sequence ON transcript_segments (session_id, chunk_sequence);

CREATE INDEX IF NOT EXISTS idx_transcripts_session_id ON transcripts (session_id);

-- ---------- TRIGGER: update updated_at ----------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;

DROP TRIGGER IF EXISTS update_notes_updated_at ON notes;

DROP TRIGGER IF EXISTS update_transcripts_updated_at ON transcripts;

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transcripts_updated_at
    BEFORE UPDATE ON transcripts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- TRIGGER: single active session ----------
CREATE OR REPLACE FUNCTION check_single_active_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE sessions
           SET status      = 'completed',
               completed_at = CURRENT_TIMESTAMP
         WHERE status = 'active'
           AND id      <> NEW.id;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ensure_single_active_session ON sessions;

CREATE TRIGGER ensure_single_active_session
    BEFORE INSERT OR UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION check_single_active_session();

-- ---------- DONE ----------
SELECT 'StudyScriber 資料庫初始化完成！' AS message;
