import io
import zipfile
from datetime import datetime, timedelta
from app.schemas.export import NoteExportData, TranscriptionSegment
import uuid
import pytest
from typing import List

class DummyTranscription:
    def __init__(self, id, text, start, end, chunk_id):
        self.id = id
        self.text = text
        self.timestamp_start = start
        self.timestamp_end = end
        self.chunk_id = chunk_id

class ExportService:
    def __init__(self):
        self.zip_buffer = io.BytesIO()

    def generate_stt_transcript(self, transcriptions: List[TranscriptionSegment]) -> str:
        """生成 STT 格式的逐字稿"""
        lines = []

        # 轉錄內容
        for segment in sorted(transcriptions, key=lambda x: x.timestamp_start):
            # 清理文字內容並忽略空白轉錄
            text = segment.text.strip().replace('\n', ' ')

            # 跳過沒有文字內容的轉錄，避免產生只有時間戳的空白行
            if not text:
                continue

            timestamp = self._format_timestamp(segment.timestamp_start)
            lines.append(f"[{timestamp}] {text}")

        return '\n'.join(lines)

    def _format_timestamp(self, seconds: float) -> str:
        """將秒數轉換為 HH:MM:SS.mmm 格式（毫秒四捨五入）"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        milliseconds = int(round((seconds % 1) * 1000))
        if milliseconds == 1000:
            secs += 1
            milliseconds = 0
            if secs == 60:
                minutes += 1
                secs = 0
                if minutes == 60:
                    hours += 1
                    minutes = 0
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{milliseconds:03d}"

    def create_zip(self, note_data: NoteExportData) -> io.BytesIO:
        """建立包含筆記和逐字稿的 ZIP 檔案（不含 metadata.txt）"""
        self.zip_buffer = io.BytesIO()

        with zipfile.ZipFile(self.zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. 加入 Markdown 筆記
            zip_file.writestr('note.md', note_data.content)

            # 2. 加入 STT 逐字稿
            stt_content = self.generate_stt_transcript(note_data.transcriptions)
            zip_file.writestr('transcript.txt', stt_content)

        self.zip_buffer.seek(0)
        return self.zip_buffer

def test_generate_stt_transcript():
    service = ExportService()
    segments = [
        TranscriptionSegment(
            id=uuid.uuid4(),
            text="Hello world",
            timestamp_start=1.23,
            timestamp_end=2.34,
            chunk_id="a"
        ),
        TranscriptionSegment(
            id=uuid.uuid4(),
            text="Second line",
            timestamp_start=3.45,
            timestamp_end=4.56,
            chunk_id="b"
        )
    ]
    stt = service.generate_stt_transcript(segments)
    assert "Hello world" in stt
    assert "Second line" in stt
    assert "[00:00:01.230]" in stt or "[00:00:01.23]" in stt
    assert "總段落數: 2" in stt

def test_create_zip_contains_files(tmp_path):
    service = ExportService()
    note_data = NoteExportData(
        note_id=uuid.uuid4(),
        title="Test Note",
        content="# Title\n內容...",
        transcriptions=[
            TranscriptionSegment(
                id=uuid.uuid4(),
                text="Line 1",
                timestamp_start=0.0,
                timestamp_end=1.0,
                chunk_id="a"
            )
        ],
        created_at=datetime(2024,1,1,12,0,0),
        updated_at=datetime(2024,1,2,12,0,0)
    )
    zip_buffer = service.create_zip(note_data)
    with zipfile.ZipFile(zip_buffer) as zf:
        assert set(zf.namelist()) == {"note.md", "transcript.txt"}
        note = zf.read("note.md").decode()
        assert "# Title" in note
        transcript = zf.read("transcript.txt").decode()
        assert "Line 1" in transcript
