"use client"

import { Button } from "@/components/ui/button"
import { Upload, FileText, RotateCcw } from "lucide-react"

interface DefaultStateProps {
  onStartRecording: () => void
  onNewNote?: () => void
  hasActiveSession?: boolean
}

export function DefaultState({ onStartRecording, onNewNote, hasActiveSession = false }: DefaultStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-6">
      {/* 如果有活躍會話，顯示 New Note 按鈕 */}
      {hasActiveSession && onNewNote && (
        <Button
          onClick={onNewNote}
          variant="outline"
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="w-4 h-4" />
          New note
        </Button>
      )}

      <Button onClick={onStartRecording} className="bg-foreground text-background hover:bg-foreground/90 px-6 py-3">
        Start recording
      </Button>

      <div className="text-muted-foreground text-sm">to see live transcript</div>

      <div className="text-muted-foreground text-sm">or</div>

      <div className="space-y-4">
        <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground" disabled>
          <Upload className="w-4 h-4" />
          Upload recording
          <span className="text-xs italic">coming soon</span>
        </Button>

        <Button variant="ghost" className="flex items-center gap-2 text-muted-foreground" disabled>
          <FileText className="w-4 h-4" />
          Paste transcript
          <span className="text-xs italic">coming soon</span>
        </Button>
      </div>
    </div>
  )
}
