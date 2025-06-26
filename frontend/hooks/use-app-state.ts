"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import type { AppData, AppState, SessionStatus, SessionType } from "../types/app-state"
import { useSession } from "./use-session"
import { useRecording } from "./use-recording"
import { useNotes } from "./use-notes"
import { useTranscript } from "./use-transcript"
import { TranscriptMessage } from "../lib/websocket"
import { useToast } from "@/components/ui/use-toast"

// 前後端狀態映射規則
const mapBackendToFrontendState = (
  status: SessionStatus,
  type: SessionType,
  isRecording: boolean
): AppState => {
  switch (status) {
    case "draft":
      return "default"
    case "active":
      if (type === "recording") {
        return isRecording ? "recording" : "default"
      }
      return "default"
    case "processing":
      return "processing"
    case "completed":
      return "finished"
    case "error":
      return "default" // 錯誤時回到預設狀態
    default:
      return "default"
  }
}

export function useAppState() {
  const [appData, setAppData] = useState<AppData>({
    state: "default",
    transcriptEntries: [],
    editorContent: "",
    isRecording: false,
    recordingTime: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 使用各個專門的 hooks
  const session = useSession()
  const recording = useRecording()
  const notes = useNotes()
  const transcript = useTranscript()
  const { toast } = useToast()

  // 狀態同步：前端狀態與後端 session status 對應
  useEffect(() => {
    const activeSession = session.currentSession
    if (activeSession) {
      const frontendState = mapBackendToFrontendState(
        activeSession.status,
        activeSession.type,
        recording.isRecording
      )

      setAppData(prev => ({
        ...prev,
        state: frontendState
      }))
    }
  }, [session.currentSession, recording.isRecording])

  // 初始化應用狀態 - 只在組件掛載時執行一次
  useEffect(() => {
    let isMounted = true

    const initializeApp = async () => {
      console.log('🚀 初始化應用狀態...')
      setIsLoading(true)

      try {
        // 檢查是否有活躍會話
        const activeSession = await session.checkActiveSession()
        if (!isMounted) return // 組件已卸載，停止執行

        if (activeSession) {
          // 載入筆記內容
          await notes.loadNote(activeSession.id)
        } else {
          // 檢查是否有本地草稿
          const draftContent = localStorage.getItem('draft_note')
          if (draftContent) {
            setAppData(prev => ({ ...prev, editorContent: draftContent }))
            console.log('📝 載入本地草稿')
          }
        }
      } catch (error) {
        if (!isMounted) return // 組件已卸載，停止執行
        console.error('❌ 初始化失敗:', error)
        setError(error instanceof Error ? error.message : '初始化失敗')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    initializeApp()

    return () => {
      isMounted = false
    }
  }, []) // 空依賴項，只在組件掛載時執行一次

  // 同步錄音狀態
  useEffect(() => {
    setAppData(prev => ({
      ...prev,
      isRecording: recording.isRecording,
      recordingTime: recording.recordingTime,
    }))
  }, [recording.isRecording, recording.recordingTime])

  // 同步筆記內容
  useEffect(() => {
    setAppData(prev => ({
      ...prev,
      editorContent: notes.noteContent,
    }))
  }, [notes.noteContent])

  // 處理逐字稿更新 - 使用專門的 useTranscript hook
  useEffect(() => {
    const sourceTranscripts = transcript.transcripts.length > 0 ? transcript.transcripts : recording.transcripts

    const transcriptEntries = sourceTranscripts.map((transcriptMsg: TranscriptMessage) => {
      // 使用 start_time 或 timestamp 計算時間
      const startTime = transcriptMsg.start_time ?? 0
      const minutes = Math.floor(startTime / 60)
      const seconds = Math.floor(startTime % 60)
      const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

      return {
        time: timeStr,
        text: transcriptMsg.text ?? '',
      }
    })

    setAppData(prev => ({
      ...prev,
      transcriptEntries,
    }))
  }, [transcript.transcripts, recording.transcripts])

  // 監聽轉錄完成，自動轉為 finished 狀態
  useEffect(() => {
    if (transcript.isCompleted && appData.state === "processing") {
      setAppData(prev => ({ ...prev, state: "finished" }))

      // 完成會話
      if (session.currentSession) {
        session.finishSession().catch(console.error)
      }
    }
  }, [
    transcript.isCompleted,
    appData.state,
    session.currentSession,
    session.finishSession
  ])

  // 建立純筆記會話
  const createNoteSession = useCallback(async (title: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const newSession = await session.createNoteSession(title)
      if (newSession) {
        // 載入筆記內容
        await notes.loadNote(newSession.id)

        // 清除本地草稿
        localStorage.removeItem('draft_note')

        console.log('✅ 純筆記會話建立成功')

        toast({
          title: '筆記會話已建立',
          description: `會話 "${title}" 建立成功`,
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '建立純筆記會話失敗'
      setError(errorMessage)
      console.error('❌ 建立純筆記會話失敗:', err)

      toast({
        title: '建立失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [session, notes, toast])

  // 建立錄音會話
  const createRecordingSession = useCallback(async (title: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const newSession = await session.createRecordingSession(title)
      if (newSession) {
        // 載入筆記內容
        await notes.loadNote(newSession.id)

        // 清除本地草稿
        localStorage.removeItem('draft_note')

        console.log('✅ 錄音會話建立成功')

        toast({
          title: '錄音會話已建立',
          description: `會話 "${title}" 建立成功`,
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '建立錄音會話失敗'
      setError(errorMessage)
      console.error('❌ 建立錄音會話失敗:', err)

      toast({
        title: '建立失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [session, notes, toast])

  // 升級會話為錄音模式
  const upgradeToRecording = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const updatedSession = await session.upgradeToRecording()
      if (updatedSession) {
        console.log('✅ 會話升級為錄音模式成功')

        toast({
          title: '升級成功',
          description: '會話已升級為錄音模式',
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '升級會話失敗'
      setError(errorMessage)
      console.error('❌ 升級會話失敗:', err)

      toast({
        title: '升級失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [session, toast])

  // 開始錄音 - 支援四狀態流程
  const startRecording = useCallback(async (title: string) => {
    console.log("🎤 startRecording: 流程開始")
    setIsLoading(true)
    try {
      let sessionToRecord = session.currentSession
      console.log("🎤 startRecording: 目前 session:", sessionToRecord)

      if (!sessionToRecord) {
        console.log("🎤 startRecording: 沒有 session，建立新的錄音 session")
        const newSession = await session.createRecordingSession(title, appData.editorContent)
        if (!newSession) {
          console.error("🎤 startRecording: 建立 session 失敗，回傳值為 null")
          throw new Error('無法建立新的錄音會話')
        }
        console.log("🎤 startRecording: Session 建立成功:", newSession)
        sessionToRecord = newSession
        localStorage.removeItem('draft_note')
      } else if (sessionToRecord.type === 'note_only') {
        console.log("🎤 startRecording: 偵測到 note_only session，進行升級")
        const upgradedSession = await session.upgradeToRecording()
        if (!upgradedSession) {
          console.error("🎤 startRecording: 升級 session 失敗，回傳值為 null")
          throw new Error('無法升級會話')
        }
        console.log("🎤 startRecording: Session 升級成功:", upgradedSession)
        sessionToRecord = upgradedSession
      }

      console.log("🎤 startRecording: 準備呼叫 recording.startRecording")
      // recording.startRecording 現在使用 TranscriptManager，會統一管理連接
      await recording.startRecording(sessionToRecord.id)
      console.log("🎤 startRecording: recording.startRecording 呼叫完畢")

      console.log("🎤 startRecording: 準備連接 transcript")
      // 同時連接 useTranscript hook 以確保逐字稿顯示
      await transcript.connect(sessionToRecord.id)
      console.log("🎤 startRecording: transcript.connect 呼叫完畢")

      toast({ title: '錄音開始' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '開始錄音失敗'
      console.error("🎤 startRecording: 流程中發生錯誤:", msg)
      setError(msg)
      toast({ title: '錄音失敗', description: msg, variant: 'destructive' })
    } finally {
      setIsLoading(false)
      console.log("🎤 startRecording: 流程結束")
    }
  }, [session, recording, transcript, appData.editorContent, toast])

  // 停止錄音 - 自動轉為 processing 狀態
  const stopRecording = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      await recording.stopRecording()

      // 斷開 transcript 連接
      transcript.disconnect()

      // 狀態轉為 processing
      setAppData(prev => ({ ...prev, state: "processing" }))

      console.log('✅ 錄音停止，開始處理逐字稿')

      toast({
        title: '處理中',
        description: '正在處理錄音內容，請稍候...',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '停止錄音失敗'
      setError(errorMessage)
      console.error('❌ 停止錄音失敗:', err)

      toast({
        title: '停止失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [recording, toast])

  // 完成會話
  const finishSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      await session.finishSession()
      console.log('✅ 會話完成')

      toast({
        title: '會話完成',
        description: '您可以匯出筆記或開始新的筆記',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '完成會話失敗'
      setError(errorMessage)
      console.error('❌ 完成會話失敗:', err)

      toast({
        title: '完成失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [session, toast])

  // 開新筆記 - 清空當前資料，狀態回到 default
  const newNote = useCallback(() => {
    // 清空當前資料
    setAppData({
      state: "default",
      transcriptEntries: [],
      editorContent: "",
      isRecording: false,
      recordingTime: 0,
    })

    // 清除會話、錄音和逐字稿狀態
    session.clearSession()
    recording.clearTranscripts()
    transcript.clearTranscripts()
    notes.clearNote()

    // 清除本地草稿
    localStorage.removeItem('draft_note')

    setError(null)
    console.log('🔄 已開始新筆記')

    toast({
      title: '新筆記',
      description: '已清空內容，可以開始新的筆記',
    })
  }, [session, recording, transcript, notes, toast])

  // 自動儲存筆記內容到本地草稿
  const saveLocalDraft = useCallback((content: string) => {
    if (!session.currentSession && content.trim()) {
      localStorage.setItem('draft_note', content)
    }
  }, [session.currentSession])

  return {
    // 應用狀態
    appData,
    isLoading,
    error,

    // 會話管理
    createNoteSession,
    createRecordingSession,
    upgradeToRecording,
    finishSession,
    newNote,

    // 錄音控制
    startRecording,
    stopRecording,

    // 本地草稿
    saveLocalDraft,

    // 外部狀態
    session: session.currentSession,
    sessionLoading: session.isLoading,
    sessionError: session.error,

    // 錄音狀態
    recordingError: recording.error,

    // 逐字稿狀態
    transcriptConnected: transcript.isConnected,
    transcriptError: transcript.error,
    transcriptAutoScroll: transcript.autoScrollEnabled,
    enableAutoScroll: transcript.enableAutoScroll,
    disableAutoScroll: transcript.disableAutoScroll,
    scrollToLatest: transcript.scrollToLatest,
  }
}
