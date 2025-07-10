"use client"

import { Button } from "@/components/ui/button"
import { Upload, FileText } from "lucide-react"

interface DefaultStateProps {
  onStartRecording: () => void
}

export function DefaultState({ onStartRecording }: DefaultStateProps) {
  const handleClick = () => {
    console.log("🔘 [DefaultState] 按鈕被點擊")
    console.log("🔘 [DefaultState] onStartRecording 函數:", typeof onStartRecording)
    try {
      onStartRecording()
      console.log("🔘 [DefaultState] onStartRecording 調用成功")
    } catch (error) {
      console.error("🔘 [DefaultState] onStartRecording 調用失敗:", error)
    }
  }

  console.log("🔄 [DefaultState] 組件渲染，onStartRecording:", typeof onStartRecording)

  return (
    <div className="h-full flex flex-col p-6">
      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center space-y-6">
        <Button
          onClick={handleClick}
          size="lg"
          className="flex items-center gap-3 px-8 py-4 text-base"
          data-testid="start-recording-button"
        >
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
    </div>
  )
}
