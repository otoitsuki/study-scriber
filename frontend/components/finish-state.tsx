"use client"

import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Download, RotateCcw, ChevronDown } from "lucide-react"
import type { TranscriptEntry } from "../types/app-state"

interface FinishStateProps {
  transcriptEntries: TranscriptEntry[]
  onNewNote?: () => void
  onExport?: () => void
  onToLatest?: () => void
}

export function FinishState({ transcriptEntries, onNewNote, onExport, onToLatest }: FinishStateProps) {
  return (
    <div className="h-full flex flex-col">
      <ScrollArea className="flex-1">
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

      <div className="p-4 border-t border-border space-y-2">
        {/* Action buttons row */}
        <div className="flex justify-center gap-2">
          {onExport && (
            <Button
              onClick={onExport}
              variant="default"
              size="sm"
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
          )}
          {onNewNote && (
            <Button
              onClick={onNewNote}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              New note
            </Button>
          )}
          {onToLatest && (
            <Button
              onClick={onToLatest}
              variant="ghost"
              size="sm"
              className="flex items-center gap-2"
            >
              <ChevronDown className="w-4 h-4" />
              To Latest
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
