"use client"

import { Loader2 } from "lucide-react"

export function WaitingState() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      <div className="text-center">
        <div className="text-lg font-medium text-foreground">Transcription in progress,</div>
        <div className="text-lg font-medium text-foreground">please wait.</div>
      </div>
    </div>
  )
}
