"use client"

import { RecordingWaitingState } from "./recording-waiting-state"
import { RecordingActiveState } from "./recording-active-state"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingStateProps {
  transcriptEntries: TranscriptEntry[]
  recordingTime: number
  onStopRecording: () => void
  error?: string | null
}

export function RecordingState({ transcriptEntries, recordingTime, onStopRecording, error }: RecordingStateProps) {
  if (transcriptEntries.length === 0) {
    return (
      <RecordingWaitingState
        recordingTime={recordingTime}
        onStopRecording={onStopRecording}
        transcriptEntries={transcriptEntries}
        error={error}
      />
    )
  }
  return (
    <RecordingActiveState
      transcriptEntries={transcriptEntries}
      recordingTime={recordingTime}
      onStopRecording={onStopRecording}
    />
  )
}
