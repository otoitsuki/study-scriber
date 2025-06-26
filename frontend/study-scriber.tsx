"use client"

import dynamic from "next/dynamic"
import "easymde/dist/easymde.min.css"
import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"

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
import { Button } from "@/components/ui/button"

export default function Component() {
  const { appData, isLoading, error, startRecording, stopRecording, newNote, saveLocalDraft, session } = useAppState()
  const [draftTitle, setDraftTitle] = useState("")

  // 追蹤狀態流轉
  console.log("[DEBUG] appData.state:", appData.state)
  console.log("[DEBUG] appData.isRecording:", appData.isRecording)
  if (session) {
    console.log("[DEBUG] session.status:", session.status, "session.type:", session.type)
  } else {
    console.log("[DEBUG] session: null")
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
    switch (appData.state) {
      case "default":
        return <DefaultState onStartRecording={() => {
          console.log("📱 StudyScriber: 準備調用 startRecording，標題:", draftTitle)
          startRecording(draftTitle)
        }} />
      case "recording":
        return (
          <RecordingState
            transcriptEntries={appData.transcriptEntries}
            recordingTime={appData.recordingTime}
            onStopRecording={stopRecording}
          />
        )
      case "processing":
        return <WaitingState />
      case "finished":
        return <FinishState transcriptEntries={appData.transcriptEntries} />
      default:
        return <DefaultState onStartRecording={() => {
          console.log("📱 StudyScriber: 準備調用 startRecording (default)，標題:", draftTitle)
          startRecording(draftTitle)
        }} />
    }
  }

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Full Width Header - Fixed height of 80px */}
      <div className="bg-background border-b border-border px-6 flex-shrink-0 w-full h-20 flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-foreground">Study Scriber</h1>

        {/* Show action buttons only in finished state */}
        {appData.state === "finished" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={newNote} size="sm" className="px-4 h-8">
              New note
            </Button>
            <Button onClick={() => console.log('Export functionality')} size="sm" className="px-4 h-8">
              Export
            </Button>
          </div>
        )}
      </div>

      {/* Main Content - Two Panel Layout - Adjusted for fixed header height */}
      <div className="flex h-[calc(100vh-80px)]">
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
