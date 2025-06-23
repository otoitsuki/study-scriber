"""
StudyScriber SQLAlchemy 模型定義

專為 Supabase PostgreSQL 設計的資料庫模型
"""

import enum
from datetime import datetime
from typing import Optional, List
from uuid import UUID, uuid4
from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, Integer, String, Text,
    ForeignKey, BigInteger, UniqueConstraint, Index, CheckConstraint, DECIMAL
)
from sqlalchemy.dialects.postgresql import UUID as PostgresUUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .database import Base


# 列舉類型定義
class SessionType(str, enum.Enum):
    """會話類型"""
    NOTE_ONLY = "note_only"  # 純筆記模式
    RECORDING = "recording"   # 錄音模式


class SessionStatus(str, enum.Enum):
    """會話狀態（簡化版）"""
    ACTIVE = "active"        # 進行中（可編輯）
    COMPLETED = "completed"  # 已完成（可匯出）


class LanguageCode(str, enum.Enum):
    """
    語言代碼

    支援的語音識別語言：
    - zh-TW: 繁體中文（台灣）
    - en-US: 美式英文

    Note: 系統目前不支援混合語言 (MIXED)，
    請在建立會話時明確指定單一語言。
    """
    ZH_TW = "zh-TW"  # 繁體中文
    EN_US = "en-US"  # 美式英文


class Session(Base):
    """會話主表"""
    __tablename__ = "sessions"

    id = Column(PostgresUUID(as_uuid=True), primary_key=True, default=uuid4)
    title = Column(String(255), nullable=True, default="未命名筆記")
    type = Column(Enum(SessionType), nullable=False, default=SessionType.NOTE_ONLY)
    status = Column(Enum(SessionStatus), nullable=False, default=SessionStatus.ACTIVE)
    language = Column(Enum(LanguageCode), default=LanguageCode.ZH_TW)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # 關聯關係
    audio_files = relationship("AudioFile", back_populates="session", cascade="all, delete-orphan")
    transcript_segments = relationship("TranscriptSegment", back_populates="session", cascade="all, delete-orphan")
    transcript = relationship("Transcript", back_populates="session", uselist=False, cascade="all, delete-orphan")
    note = relationship("Note", back_populates="session", uselist=False, cascade="all, delete-orphan")

    # 索引與約束
    __table_args__ = (
        # 按建立時間降序排列的索引
        Index("idx_sessions_created", created_at.desc()),
        # 按狀態分組的索引
        Index("idx_sessions_status", status),
    )

    def __repr__(self):
        return f"<Session(id={self.id}, title='{self.title}', type={self.type}, status={self.status})>"


class AudioFile(Base):
    """音檔切片記錄"""
    __tablename__ = "audio_files"

    id = Column(PostgresUUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(PostgresUUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    chunk_sequence = Column(Integer, CheckConstraint("chunk_sequence >= 0"), nullable=False)
    r2_key = Column(Text, nullable=False)  # Cloudflare R2 物件鍵值
    r2_bucket = Column(Text, nullable=False)  # Cloudflare R2 儲存桶名稱
    file_size = Column(Integer, CheckConstraint("file_size >= 0"), nullable=True)
    duration_seconds = Column(DECIMAL(precision=10, scale=3), CheckConstraint("duration_seconds >= 0"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # 關聯關係
    session = relationship("Session", back_populates="audio_files")

    # 唯一約束
    __table_args__ = (
        UniqueConstraint("session_id", "chunk_sequence", name="uq_audio_session_chunk"),
        Index("idx_audio_session", "session_id"),
    )

    def __repr__(self):
        return f"<AudioFile(session_id={self.session_id}, chunk={self.chunk_sequence}, size={self.file_size})>"


class TranscriptSegment(Base):
    """逐字稿片段"""
    __tablename__ = "transcript_segments"

    id = Column(PostgresUUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(PostgresUUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    chunk_sequence = Column(Integer, CheckConstraint("chunk_sequence >= 0"), nullable=False)
    start_time = Column(DECIMAL(precision=10, scale=3), CheckConstraint("start_time >= 0"), nullable=False)  # 開始時間（秒）
    end_time = Column(DECIMAL(precision=10, scale=3), nullable=False)  # 結束時間（秒）
    text = Column(Text, nullable=False)
    confidence = Column(DECIMAL(precision=5, scale=4), CheckConstraint("confidence >= 0 AND confidence <= 1"), nullable=True)  # 信心度 0-1
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # 關聯關係
    session = relationship("Session", back_populates="transcript_segments")

    # 約束與索引
    __table_args__ = (
        UniqueConstraint("session_id", "chunk_sequence", name="uq_segment_session_chunk"),
        CheckConstraint("end_time >= start_time", name="ck_segment_time_order"),
        Index("idx_segments_session", "session_id"),
    )

    def __repr__(self):
        return f"<TranscriptSegment(session_id={self.session_id}, chunk={self.chunk_sequence}, start={self.start_time}, end={self.end_time})>"


class Transcript(Base):
    """完整逐字稿"""
    __tablename__ = "transcripts"

    id = Column(PostgresUUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(PostgresUUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True)
    full_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # 關聯關係
    session = relationship("Session", back_populates="transcript")

    def __repr__(self):
        return f"<Transcript(session_id={self.session_id})>"


class Note(Base):
    """筆記內容"""
    __tablename__ = "notes"

    id = Column(PostgresUUID(as_uuid=True), primary_key=True, default=uuid4)
    session_id = Column(PostgresUUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, unique=True)
    content = Column(Text, nullable=False, default="")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # 關聯關係
    session = relationship("Session", back_populates="note")

    def __repr__(self):
        return f"<Note(session_id={self.session_id}, updated_at={self.updated_at})>"
