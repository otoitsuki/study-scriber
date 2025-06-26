"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import type { TranscriptEntry } from "../types/app-state"

interface FinishStateProps {
  transcriptEntries: TranscriptEntry[]
}

export function FinishState({ transcriptEntries }: FinishStateProps) {
  return (
    <ScrollArea className="h-full w-full">
      <div className="p-6 space-y-4">
        {transcriptEntries.map((entry, index) => (
          <div key={index} className="flex gap-4 text-sm">
            <span className="text-muted-foreground font-mono text-xs mt-1 min-w-[40px] flex-shrink-0">
              {entry.time}
            </span>
            <span className="text-foreground leading-relaxed">{entry.text}</span>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
