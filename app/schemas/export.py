from pydantic import BaseModel, UUID4
from typing import Optional, List
from datetime import datetime

class ExportRequest(BaseModel):
    note_id: UUID4
    note_content: str
    include_audio: Optional[bool] = False

class TranscriptionSegment(BaseModel):
    id: UUID4
    text: str
    timestamp_start: float
    timestamp_end: Optional[float] = None
    chunk_id: str

class NoteExportData(BaseModel):
    note_id: UUID4
    title: Optional[str]
    content: str
    transcriptions: List[TranscriptionSegment]
    created_at: datetime
    updated_at: datetime
