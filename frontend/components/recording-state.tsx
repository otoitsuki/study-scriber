"use client"

import { RecordingWaitingState } from "./recording-waiting-state"
import { RecordingActiveState } from "./recording-active-state"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingStateProps {
  transcriptEntries: TranscriptEntry[]
  recordingTime: number
  onStopRecording: () => void
}

export function RecordingState({ transcriptEntries, recordingTime, onStopRecording }: RecordingStateProps) {
  if (transcriptEntries.length === 0) {
    return (
      <RecordingWaitingState
        recordingTime={recordingTime}
        onStopRecording={onStopRecording}
      />
    )
  }
  return (
    <RecordingActiveState
      transcriptEntries={transcriptEntries}
      onStopRecording={onStopRecording}
    />
  )
}
