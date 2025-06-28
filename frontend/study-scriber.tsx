"use client"

import dynamic from "next/dynamic"
import "easymde/dist/easymde.min.css"
import { useMemo, useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RotateCcw, Download } from "lucide-react"
import { useRecording } from "./hooks/use-recording"

// 動態匯入 SimpleMDE 以避免 SSR 問題
const SimpleMDE = dynamic(() => import("react-simplemde-editor"), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-muted-foreground">載入編輯器中...</div>
})
import { useAppState } from "./hooks/use-app-state"
import { DefaultState } from "./components/default-state"
import { RecordingState } from "./components/recording-state"
import { WaitingState } from "./components/waiting-state"
import { FinishState } from "./components/finish-state"

export default function Component() {
  const {
    appData,
    isLoading,
    error,
    startRecording,
    stopRecording,
    newNote,
    saveLocalDraft,
    session,
    recordingError,
    transcriptError,
    createNoteSession,
    sessionLoading,
  } = useAppState()
  const [draftTitle, setDraftTitle] = useState("")

  // 追蹤狀態流轉
  console.log("[DEBUG] appData.state:", appData.state)
  console.log("[DEBUG] appData.isRecording:", appData.isRecording)
  if (session) {
    console.log("[DEBUG] session.status:", session.status, "session.type:", session.type)
  } else {
    console.log("[DEBUG] session: null")
  }

  // 暴露 appData 到 window 對象用於調試
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).appData = appData;
      (window as any).session = session;
    }
  }, [appData, session])

  // 暴露 recording hook 到 window 以便調試
  const recording = useRecording()
  if (typeof window !== 'undefined') {
    (window as any).recordingHook = recording
  }

  const editorOptions = useMemo(() => {
    return {
      spellChecker: false,
      placeholder: "Start writing your notes...",
      status: false,
      toolbar: [
        "bold",
        "italic",
        "strikethrough",
        "|",
        "heading-1",
        "heading-2",
        "heading-3",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "image",
        "table",
        "|",
        "preview",
        "side-by-side",
        "fullscreen",
      ] as const,
      autofocus: true,
      tabSize: 2,
    }
  }, [])

  const renderRightPanel = () => {
    // 組合錯誤訊息
    const combinedError = recordingError || transcriptError || null

    switch (appData.state) {
      case "default":
        return <DefaultState
          onStartRecording={() => {
            console.log("📱 StudyScriber: 準備調用 startRecording，標題:", draftTitle)
            startRecording(draftTitle)
          }}
        />
      case "recording_active":
        return (
          <RecordingState
            transcriptEntries={appData.transcriptEntries}
            recordingTime={appData.recordingTime}
            onStopRecording={stopRecording}
            error={combinedError}
          />
        )
      case "recording_waiting":
        return (
          <RecordingState
            transcriptEntries={appData.transcriptEntries}
            recordingTime={appData.recordingTime}
            onStopRecording={stopRecording}
            error={combinedError}
          />
        )
      case "processing":
        return <WaitingState />
      case "finished":
        return (
          <FinishState
            transcriptEntries={appData.transcriptEntries}
            onExport={() => {
              // TODO: 實現匯出功能
              console.log('Export functionality not implemented yet')
            }}
            onToLatest={() => {
              // TODO: 實現捲動到最新功能
              console.log('To Latest functionality not implemented yet')
            }}
          />
        )
      default:
        return <DefaultState
          onStartRecording={() => {
            console.log("📱 StudyScriber: 準備調用 startRecording (default)，標題:", draftTitle)
            startRecording(draftTitle)
          }}
        />
    }
  }

  return (
    <div className="h-screen bg-background flex flex-col" suppressHydrationWarning={true}>
      {/* Full Width Header - Fixed height of 80px */}
      <div className="bg-background border-b border-border px-6 flex-shrink-0 w-full h-20 flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-foreground">Study Scriber</h1>

        {/* Header action buttons */}
        <div className="flex gap-2">
          {/* New note 按鈕 - 在有活躍會話或需要的狀態下顯示 */}
          {((appData.state === "default" && !!session) ||
            appData.state === "recording_waiting" ||
            appData.state === "recording_active" ||
            appData.state === "finished") && (
              <Button variant="outline" onClick={newNote} size="sm" className="px-4 h-8 flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
                New note
              </Button>
            )}

          {/* Export 按鈕 - 只在 finished 狀態顯示 */}
          {appData.state === "finished" && (
            <Button onClick={() => console.log('Export functionality')} size="sm" className="px-4 h-8 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export
            </Button>
          )}
        </div>
      </div>

      {/* Main Content - Two Panel Layout - Adjusted for fixed header height */}
      <div className="flex h-[calc(100vh-80px)]" suppressHydrationWarning={true}>
        {/* Left Panel - SimpleMDE Editor */}
        <div className="flex-1 bg-background border-r border-border h-full">
          <div className="h-full p-6 flex flex-col gap-4">
            <Input
              placeholder="請輸入標題..."
              className="text-lg font-semibold"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              disabled={appData.state === 'processing' || appData.state === 'finished' || appData.isRecording}
            />
            <div className="h-full editor-container flex-grow">
              <SimpleMDE
                options={editorOptions}
                value={appData.editorContent}
                onChange={saveLocalDraft}
              />
            </div>
          </div>
        </div>

        {/* Right Panel - State-dependent content */}
        <div className="w-80 bg-background flex-shrink-0 h-full">{renderRightPanel()}</div>
      </div>
    </div>
  )
}
