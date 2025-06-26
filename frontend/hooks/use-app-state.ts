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
  isRecording: boolean,
  transcriptsPresent: boolean
): AppState => {
  console.log('🔄 [狀態映射] 輸入參數:', {
    status,
    type,
    isRecording,
    transcriptsPresent,
    timestamp: new Date().toISOString()
  })

  let resultState: AppState

  switch (status) {
    case "draft":
      resultState = "default"
      break
    case "active":
      if (type === "recording") {
        if (!isRecording) {
          resultState = "default"
          console.log('🔄 [狀態映射] recording session 但 isRecording=false，回到 default')
        } else {
          resultState = transcriptsPresent ? "recording_active" : "recording_waiting"
          console.log(`🔄 [狀態映射] recording session + isRecording=true，transcriptsPresent=${transcriptsPresent} → ${resultState}`)
        }
      } else {
        resultState = "default"
      }
      break
    case "processing":
      resultState = "processing"
      break
    case "completed":
      resultState = "finished"
      break
    case "error":
      resultState = "default" // 錯誤時回到預設狀態
      console.log('🔄 [狀態映射] 檢測到錯誤狀態，轉換到 default')
      break
    default:
      resultState = "default"
      break
  }

  console.log(`🔄 [狀態映射] 最終結果: ${status}(${type}) → ${resultState}`)
  return resultState
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
    console.log('🔄 [狀態同步] useEffect 觸發:', {
      hasActiveSession: !!activeSession,
      sessionId: activeSession?.id,
      sessionStatus: activeSession?.status,
      sessionType: activeSession?.type,
      isRecording: recording.isRecording,
      transcriptCount: transcript.transcripts.length,
      recordingTranscriptCount: recording.transcripts.length,
      currentAppState: appData.state
    })

    if (activeSession) {
      // 統一使用 recording.transcripts，避免雙重逐字稿管理
      const transcriptsPresent = (recording.transcripts.length > 0)
      console.log('🔄 [狀態同步] 計算 transcriptsPresent (統一路徑):', {
        recordingTranscriptCount: recording.transcripts.length,
        transcriptsPresent,
        note: '已移除 transcript.transcripts 避免雙重管理'
      })

      const frontendState = mapBackendToFrontendState(
        activeSession.status,
        activeSession.type,
        recording.isRecording,
        transcriptsPresent
      )

      console.log(`🔄 [狀態同步] 狀態變化: ${appData.state} → ${frontendState}`)

      setAppData(prev => ({
        ...prev,
        state: frontendState
      }))
    }
  }, [session.currentSession, recording.isRecording, recording.transcripts.length, appData.state])

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

  // 處理逐字稿更新 - 統一使用 recording.transcripts
  useEffect(() => {
    console.log('📝 [逐字稿更新] useEffect 觸發:', {
      recordingTranscriptCount: recording.transcripts.length,
      note: '統一使用 recording.transcripts，避免雙重管理'
    })

    const transcriptEntries = recording.transcripts.map((transcriptMsg: TranscriptMessage) => {
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

    console.log('📝 [逐字稿更新] 轉換完成:', {
      entriesCount: transcriptEntries.length,
      firstEntry: transcriptEntries[0]?.text?.substring(0, 30) + '...'
    })

    setAppData(prev => ({
      ...prev,
      transcriptEntries,
    }))
  }, [recording.transcripts])

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

  // 監聽錄音和轉錄錯誤，處理錯誤狀態
  useEffect(() => {
    const recordingError = recording.error
    const transcriptError = transcript.error

    if (recordingError || transcriptError) {
      console.log('🚨 [錯誤處理] 檢測到錯誤:', {
        recordingError,
        transcriptError,
        currentState: appData.state,
        sessionId: session.currentSession?.id
      })

      // 如果是錄音相關錯誤，停止錄音並回到預設狀態
      if (appData.state === "recording_waiting" || appData.state === "recording_active") {
        console.log('🚨 [錯誤處理] 錄音狀態錯誤，停止錄音並回到預設狀態')

        // 停止錄音
        recording.stopRecording()

        // 清理連線
        transcript.disconnect()

        // 回到預設狀態
        setAppData(prev => ({ ...prev, state: "default" }))

        // 顯示錯誤訊息
        const errorMessage = recordingError || transcriptError || '錄音或轉錄過程中發生錯誤'
        toast({
          title: '錄音錯誤',
          description: errorMessage,
          variant: 'destructive',
        })
      }

      // 如果是處理狀態的錯誤，也回到預設狀態
      if (appData.state === "processing") {
        console.log('🚨 [錯誤處理] 處理狀態錯誤，回到預設狀態')

        setAppData(prev => ({ ...prev, state: "default" }))

        const errorMessage = transcriptError || recordingError || '處理轉錄過程中發生錯誤'
        toast({
          title: '處理錯誤',
          description: errorMessage,
          variant: 'destructive',
        })
      }
    }
  }, [recording.error, transcript.error, appData.state, session.currentSession, recording, transcript, toast])

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
      // recording.startRecording 使用 TranscriptManager，統一管理逐字稿連接
      await recording.startRecording(sessionToRecord.id)
      console.log("🎤 startRecording: recording.startRecording 呼叫完畢")

      console.log("🎤 startRecording: 跳過 transcript.connect，避免雙重監聽器")
      // 移除重複連接：useRecording 已經透過 TranscriptManager 連接逐字稿
      // 避免 useTranscript 和 useRecording 同時添加監聽器導致競爭條件
      console.log("🎤 startRecording: 逐字稿將由 useRecording hook 統一管理")

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
  const newNote = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 如果有活躍會話，先刪除它
      if (session.currentSession) {
        console.log('🗑️ 刪除當前活躍會話:', session.currentSession.id)
        await session.deleteSession()
        console.log('✅ 會話刪除成功')
      }

      // 清空當前資料
      setAppData({
        state: "default",
        transcriptEntries: [],
        editorContent: "",
        isRecording: false,
        recordingTime: 0,
      })

      // 清除錄音和逐字稿狀態
      recording.clearTranscripts()
      transcript.clearTranscripts()
      notes.clearNote()

      // 清除本地草稿
      localStorage.removeItem('draft_note')

      console.log('🔄 已開始新筆記')

      toast({
        title: '新筆記',
        description: '已清空內容，可以開始新的筆記',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '開始新筆記失敗'
      setError(errorMessage)
      console.error('❌ 開始新筆記失敗:', err)

      toast({
        title: '操作失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
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

export { mapBackendToFrontendState }
