"use client"

import dynamic from "next/dynamic"
import "easymde/dist/easymde.min.css"
import { useMemo, useState, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { RotateCcw, Download } from "lucide-react"


// 動態匯入 SimpleMDE 以避免 SSR 問題
const SimpleMDE = dynamic(() => import("react-simplemde-editor"), {
  ssr: false,
  loading: () => <div className="h-full flex items-center justify-center text-muted-foreground">載入編輯器中...</div>
})
import { useAppStore } from "./lib/app-store-zustand"
import { DefaultState } from "./components/default-state"
import { RecordingState } from "./components/recording-state"
import { WaitingState } from "./components/waiting-state"
import { FinishState } from "./components/finish-state"

export default function Component() {
  // 使用 Zustand store
  const appState = useAppStore(state => state.appState)
  const isLoading = useAppStore(state => state.isLoading)
  const error = useAppStore(state => state.error)
  const session = useAppStore(state => state.session)
  const isRecording = useAppStore(state => state.isRecording)
  const recordingTime = useAppStore(state => state.recordingTime)
  const transcriptEntries = useAppStore(state => state.transcriptEntries)
  const editorContent = useAppStore(state => state.editorContent)
  
  // Actions
  const startRecording = useAppStore(state => state.startRecording)
  const stopRecording = useAppStore(state => state.stopRecording)
  const updateEditorContent = useAppStore(state => state.updateEditorContent)
  const resetState = useAppStore(state => state.resetState)
  const clearError = useAppStore(state => state.clearError)
  // ✅ 移除 draftTitle 狀態 - 標題不再必填

  // 使用 Zustand store - 所有狀態已在上方宣告

  // 檢查並清理異常的 localStorage 狀態
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const appStateData = localStorage.getItem('app_state_v1')
      if (appStateData) {
        try {
          const parsedState = JSON.parse(appStateData)
          console.log("🔍 [StudyScriber] 檢查 localStorage 狀態:", parsedState)

          // 如果狀態是異常的錄音狀態，清除它
          if (parsedState.state && ['recording_waiting', 'recording_active', 'processing'].includes(parsedState.state)) {
            console.log("🧹 [StudyScriber] 清除異常的 localStorage 狀態")
            localStorage.removeItem('app_state_v1')
            localStorage.removeItem('last_session')
            // 刷新頁面以重新初始化
            window.location.reload()
            return
          }
        } catch (error) {
          console.error("❌ [StudyScriber] 解析 localStorage 失敗:", error)
          localStorage.removeItem('app_state_v1')
          localStorage.removeItem('last_session')
        }
      }
    }
  }, [])

  // 追蹤狀態流轉
  console.log("[DEBUG] appState:", appState)
  console.log("[DEBUG] isRecording:", isRecording)
  if (session) {
    console.log("[DEBUG] session.status:", session.status, "session.type:", session.type)
  } else {
    console.log("[DEBUG] session: null")
  }

  // 添加調試功能到 window
  if (typeof window !== 'undefined') {
    // 暴露完整狀態到 window.appData 以便診斷
    (window as any).appData = {
      state: appState,
      isRecording,
      recordingTime,
      transcriptEntries,
      editorContent,
      session,
      isLoading,
      error
    }
  }

  // 暴露錄音狀態到 window 以便調試
  if (typeof window !== 'undefined') {
    (window as any).recordingHook = { isRecording, recordingTime }
  }

  // 暴露 session 到 window 以便調試
  if (typeof window !== 'undefined') {
    (window as any).sessionHook = {
      currentSession: session,
      isLoading: isLoading,
      error: error
    }
  }

  useEffect(() => {
    console.log("📱 StudyScriber: state 更新:", {
      state: appState,
      isRecording: isRecording,
      recordingTime: recordingTime,
      transcriptEntries: transcriptEntries,
      editorContent: editorContent,
      session: session,
      isLoading: isLoading,
      error: error,
    })
  }, [appState, isRecording, recordingTime, transcriptEntries, editorContent, session, isLoading, error])

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
    // 狀態異常檢查：如果是 recording_waiting 但沒有 session，應該顯示 default 狀態
    if (appState === "recording_waiting" && !session) {
      console.log("⚠️ [StudyScriber] 檢測到狀態異常: recording_waiting 但沒有 session，顯示 DefaultState")
      return <DefaultState
        onStartRecording={() => {
          console.log("📱 StudyScriber: 準備調用 startRecording（狀態修復）")
          startRecording()
        }}
      />
    }

    switch (appState) {
      case "default":
        console.log("🔄 [StudyScriber] 渲染 DefaultState，startRecording 函數:", typeof startRecording)
        return <DefaultState
          onStartRecording={() => {
            console.log("📱 StudyScriber: 準備調用 startRecording")
            console.log("📱 StudyScriber: startRecording 函數類型:", typeof startRecording)
            startRecording()
          }}
        />
      case "recording_active":
        return (
          <RecordingState
            transcriptEntries={transcriptEntries}
            recordingTime={recordingTime}
            onStopRecording={stopRecording}
            error={error}
          />
        )
      case "recording_waiting":
        return (
          <RecordingState
            transcriptEntries={transcriptEntries}
            recordingTime={recordingTime}
            onStopRecording={stopRecording}
            error={error}
          />
        )
      case "processing":
        return <WaitingState />
      case "finished":
        return (
          <FinishState
            transcriptEntries={transcriptEntries}
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
            console.log("📱 StudyScriber: 準備調用 startRecording (default)")
            startRecording()
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
          {((appState === "default" && !!session) ||
            appState === "recording_waiting" ||
            appState === "recording_active" ||
            appState === "finished") && (
              <Button variant="outline" onClick={resetState} size="sm" className="px-4 h-8 flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
                New note
              </Button>
            )}

          {/* Export 按鈕 - 只在 finished 狀態顯示 */}
          {appState === "finished" && (
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
            {/* ✅ 移除標題輸入欄位 - 標題不再必填 */}
            <div className="h-full editor-container flex-grow" data-testid="editor-container">
              <SimpleMDE
                options={editorOptions}
                value={editorContent}
                onChange={updateEditorContent}
                getMdeInstance={(instance) => {
                  if (process.env.NODE_ENV !== 'production') {
                    (window as any).theEditor = instance;
                  }
                }}
              />
              {/* 降級的 textarea 用於測試環境 */}
              <textarea
                data-testid="fallback-editor"
                className="hidden"
                value={editorContent}
                onChange={(e) => updateEditorContent(e.target.value)}
                placeholder="Start writing your notes..."
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
