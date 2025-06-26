"use client"

import { Button } from "@/components/ui/button"
import { Upload, FileText } from "lucide-react"

interface DefaultStateProps {
  onStartRecording: () => void
}

export function DefaultState({ onStartRecording }: DefaultStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 space-y-6">
      <Button onClick={onStartRecording} size="lg" className="flex items-center gap-3 px-8 py-4 text-base">
        <Upload className="w-5 h-5" />
        Start Recording
      </Button>

      <div className="text-center text-muted-foreground text-sm space-y-1">
        <p className="flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" />
          或直接開始編寫筆記
        </p>
        <p>錄音功能隨時可以啟用</p>
      </div>
    </div>
  )
}
