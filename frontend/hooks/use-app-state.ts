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
  const timestamp = Date.now()
  const isoTimestamp = new Date().toISOString()

  console.log('🔄 [狀態映射] 輸入參數 (詳細時序):', {
    status,
    type,
    isRecording,
    transcriptsPresent,
    timestamp,
    isoTimestamp,
    note: '檢查時序和邏輯流程'
  })

  let resultState: AppState

  // 詳細的狀態轉換邏輯和時序追蹤
  switch (status) {
    case "draft":
      resultState = "default"
      console.log('🔄 [狀態映射] draft → default (時序正常)')
      break
    case "active":
      if (type === "recording") {
        if (!isRecording) {
          resultState = "default"
          console.log('🔄 [狀態映射] recording session 但 isRecording=false → default (時序檢查通過)', {
            timestamp,
            reason: 'recording session inactive'
          })
        } else {
          // 關鍵的狀態轉換邏輯：recording_waiting → recording_active
          if (transcriptsPresent) {
            resultState = "recording_active"
            console.log(`🔄 [狀態映射] ✅ 關鍵轉換: recording_waiting → recording_active (時序成功)`, {
              transcriptsPresent,
              timestamp,
              trigger: 'first_transcript_received'
            })
          } else {
            resultState = "recording_waiting"
            console.log(`🔄 [狀態映射] 保持 recording_waiting 狀態 (等待逐字稿)`, {
              transcriptsPresent,
              timestamp,
              waiting: 'for_first_transcript'
            })
          }
        }
      } else {
        resultState = "default"
        console.log('🔄 [狀態映射] active session 但 type != recording → default', {
          type,
          timestamp
        })
      }
      break
    case "processing":
      resultState = "processing"
      console.log('🔄 [狀態映射] processing → processing (時序正常)', { timestamp })
      break
    case "completed":
      resultState = "finished"
      console.log('🔄 [狀態映射] completed → finished (時序正常)', { timestamp })
      break
    case "error":
      resultState = "default" // 錯誤時回到預設狀態
      console.log('🔄 [狀態映射] error → default (錯誤恢復)', {
        timestamp,
        recovery: true
      })
      break
    default:
      resultState = "default"
      console.log('🔄 [狀態映射] unknown → default (安全回退)', {
        unknownStatus: status,
        timestamp
      })
      break
  }

  console.log(`🔄 [狀態映射] 最終結果 (時序追蹤): ${status}(${type}) → ${resultState}`, {
    inputParams: { status, type, isRecording, transcriptsPresent },
    output: resultState,
    timestamp,
    duration: Date.now() - timestamp
  })

  return resultState
}

export function useAppState() {
  const [appData, setAppData] = useState<AppData>({
    state: "default",
    transcriptEntries: [],
    editorContent: "",
    isRecording: false,
    recordingTime: 0,
    session: null,
  })

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 使用各個專門的 hooks
  const session = useSession()
  const recording = useRecording()
  const notes = useNotes()
  const transcript = useTranscript()
  const { toast } = useToast()

  // 使用 useRef 追蹤前一個狀態值，避免循環依賴
  const prevStateRef = useRef<AppState>('default')
  const prevTranscriptCompletedRef = useRef(false)
  const prevErrorStateRef = useRef<{ recording: string | null, transcript: string | null }>({
    recording: null,
    transcript: null
  })

  // 優化的狀態映射函數，確保時序可預測性
  const mapStateFromSession = useCallback((
    currentSession: any,
    isRecording: boolean,
    transcripts: any[]
  ) => {
    const executionTimestamp = Date.now()

    if (!currentSession) {
      console.log('🔄 [狀態映射] 無活躍會話 → default', { executionTimestamp })
      return 'default'
    }

    // 實作更可靠的 transcriptsPresent 計算
    const transcriptsPresent = Array.isArray(transcripts) && transcripts.length > 0

    console.log('🔄 [狀態映射] 執行時序檢查:', {
      sessionId: currentSession.id,
      sessionStatus: currentSession.status,
      sessionType: currentSession.type,
      isRecording,
      transcriptCount: transcripts.length,
      transcriptsPresent,
      executionTimestamp,
      transcriptsSample: transcripts.slice(0, 2).map(t => ({
        text: t.text?.substring(0, 30) + '...',
        start_time: t.start_time,
        type: t.type
      })),
      note: '時序同步檢查完成'
    })

    const result = mapBackendToFrontendState(
      currentSession.status,
      currentSession.type,
      isRecording,
      transcriptsPresent
    )

    console.log('🔄 [狀態映射] 執行結果:', {
      input: {
        sessionStatus: currentSession.status,
        sessionType: currentSession.type,
        isRecording,
        transcriptsPresent
      },
      output: result,
      executionTimestamp,
      executionDuration: Date.now() - executionTimestamp
    })

    return result
  }, [])

  // 狀態同步：前端狀態與後端 session status 對應 - 強化一致性
  useEffect(() => {
    const activeSession = session.currentSession
    const effectExecutionTime = Date.now()

    console.log('🔄 [狀態同步] useEffect 觸發 (強化一致性版):', {
      hasActiveSession: !!activeSession,
      sessionId: activeSession?.id,
      sessionStatus: activeSession?.status,
      sessionType: activeSession?.type,
      recordingIsRecording: recording.isRecording,
      appDataIsRecording: appData.isRecording,
      isRecordingConsistent: recording.isRecording === appData.isRecording,
      transcriptCount: transcript.transcripts.length,
      recordingTranscriptCount: recording.transcripts.length,
      currentAppState: prevStateRef.current,
      effectExecutionTime,
      note: '強化錄音狀態一致性檢查'
    })

    if (activeSession) {
      // 確保使用最新的 recording.transcripts 狀態
      const latestTranscripts = recording.transcripts
      const transcriptsPresent = Array.isArray(latestTranscripts) && latestTranscripts.length > 0

      console.log('🔄 [狀態同步] 逐字稿狀態計算 (時序保證):', {
        recordingTranscriptCount: latestTranscripts.length,
        transcriptsPresent,
        latestTranscriptTime: latestTranscripts[latestTranscripts.length - 1]?.start_time,
        latestTranscriptText: latestTranscripts[latestTranscripts.length - 1]?.text?.substring(0, 30) + '...',
        effectExecutionTime,
        note: '已確保時序同步'
      })

      // 關鍵修復：強制使用 recording.isRecording 而不是 appData.isRecording
      // 這確保狀態映射邏輯使用最新的錄音狀態
      const frontendState = mapStateFromSession(
        activeSession,
        recording.isRecording, // 直接使用 recording hook 的狀態
        latestTranscripts
      )

      // 檢查是否需要同時更新 isRecording 和 state
      const needsIsRecordingUpdate = appData.isRecording !== recording.isRecording
      const needsStateUpdate = frontendState !== prevStateRef.current

      if (needsIsRecordingUpdate || needsStateUpdate) {
        console.log(`🔄 [狀態同步] 執行狀態更新:`, {
          needsIsRecordingUpdate,
          needsStateUpdate,
          appDataIsRecording: appData.isRecording,
          recordingIsRecording: recording.isRecording,
          previousState: prevStateRef.current,
          newState: frontendState,
          stateChangeTimestamp: Date.now(),
          executionDuration: Date.now() - effectExecutionTime,
          triggerSource: 'comprehensive_state_sync'
        })

        setAppData(prev => ({
          ...prev,
          state: frontendState,
          isRecording: recording.isRecording, // 同時強制同步 isRecording
        }))

        prevStateRef.current = frontendState
      } else {
        console.log('🔄 [狀態同步] 所有狀態一致，跳過更新', {
          currentState: frontendState,
          isRecording: recording.isRecording,
          executionTime: Date.now() - effectExecutionTime
        })
      }
    }
  }, [session.currentSession, recording.isRecording, recording.transcripts, mapStateFromSession])
  // 依賴於 recording.transcripts 而非 length，確保內容變化時觸發狀態同步

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

        // 如果是網路錯誤，不要拋出錯誤，讓用戶正常使用應用
        if (error instanceof Error && error.message.includes('Network Error')) {
          console.warn('⚠️ 初始化時 Backend 連線失敗，使用離線模式:', error.message)

          // 檢查是否有本地草稿
          const draftContent = localStorage.getItem('draft_note')
          if (draftContent) {
            setAppData(prev => ({ ...prev, editorContent: draftContent }))
            console.log('📝 離線模式：載入本地草稿')
          }
        } else {
          console.error('❌ 初始化失敗:', error)
          setError(error instanceof Error ? error.message : '初始化失敗')
        }
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

  // 同步錄音狀態 - 強化一致性檢查
  useEffect(() => {
    console.log('🔄 [錄音狀態同步] 更新 appData.isRecording:', {
      from: appData.isRecording,
      to: recording.isRecording,
      recordingTime: recording.recordingTime,
      timestamp: Date.now(),
      needsUpdate: appData.isRecording !== recording.isRecording
    })

    // 強制同步錄音狀態，確保一致性
    setAppData(prev => {
      const needsUpdate = prev.isRecording !== recording.isRecording || prev.recordingTime !== recording.recordingTime

      if (needsUpdate) {
        console.log('🔄 [錄音狀態同步] 執行狀態更新:', {
          prevIsRecording: prev.isRecording,
          newIsRecording: recording.isRecording,
          prevRecordingTime: prev.recordingTime,
          newRecordingTime: recording.recordingTime
        })
      }

      return {
        ...prev,
        isRecording: recording.isRecording,
        recordingTime: recording.recordingTime,
      }
    })
  }, [recording.isRecording, recording.recordingTime])

  // 移除重複的狀態一致性檢查，已整合到主要狀態同步邏輯中

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
      recordingTranscripts: recording.transcripts,
      currentState: appData.state,
      isRecording: appData.isRecording,
      note: '統一使用 recording.transcripts，避免雙重管理'
    })

    const transcriptEntries = recording.transcripts.map((transcriptMsg: TranscriptMessage) => {
      // 使用 start_time 並轉換為 HH:MM:SS 格式
      const startTime = transcriptMsg.start_time ?? 0
      const hours = Math.floor(startTime / 3600)
      const minutes = Math.floor((startTime % 3600) / 60)
      const seconds = Math.floor(startTime % 60)
      const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

      console.log('📝 [逐字稿轉換] 單個片段:', {
        text: transcriptMsg.text,
        timeStr,
        startTime,
        type: transcriptMsg.type
      })

      return {
        time: timeStr,
        text: transcriptMsg.text ?? '',
      }
    })

    console.log('📝 [逐字稿更新] 轉換完成:', {
      entriesCount: transcriptEntries.length,
      entries: transcriptEntries,
      firstEntry: transcriptEntries[0]?.text?.substring(0, 30) + '...',
      appDataBefore: appData.transcriptEntries
    })

    setAppData(prev => {
      console.log('📝 [逐字稿更新] setAppData 執行:', {
        prevTranscriptEntries: prev.transcriptEntries,
        newTranscriptEntries: transcriptEntries,
        isChanged: prev.transcriptEntries !== transcriptEntries
      })
      return {
        ...prev,
        transcriptEntries,
      }
    })
  }, [recording.transcripts])

  // 監聽轉錄完成，自動轉為 finished 狀態
  useEffect(() => {
    const currentCompleted = transcript.isCompleted
    const wasCompleted = prevTranscriptCompletedRef.current

    // 只在轉錄狀態從 false 變為 true 時處理
    if (currentCompleted && !wasCompleted && prevStateRef.current === "processing") {
      console.log('🔄 [轉錄完成] 轉錄完成，轉為 finished 狀態')

      setAppData(prev => {
        const newState = "finished"
        prevStateRef.current = newState
        return { ...prev, state: newState }
      })

      // 完成會話
      if (session.currentSession) {
        session.finishSession().catch(console.error)
      }
    }

    prevTranscriptCompletedRef.current = currentCompleted
  }, [
    transcript.isCompleted,
    session.currentSession,
    session.finishSession
  ])

  // 監聽錄音和轉錄錯誤，處理錯誤狀態
  useEffect(() => {
    const recordingError = recording.error
    const transcriptError = transcript.error
    const prevErrors = prevErrorStateRef.current

    // 只在錯誤狀態真正改變時處理（避免重複處理同樣的錯誤）
    if ((recordingError !== prevErrors.recording) || (transcriptError !== prevErrors.transcript)) {
      if (recordingError || transcriptError) {
        console.log('🚨 [錯誤處理] 檢測到錯誤:', {
          recordingError,
          transcriptError,
          currentState: prevStateRef.current,
          sessionId: session.currentSession?.id
        })

        const currentState = prevStateRef.current

        // 如果是錄音相關錯誤，停止錄音並回到預設狀態
        if (currentState === "recording_waiting" || currentState === "recording_active") {
          console.log('🚨 [錯誤處理] 錄音狀態錯誤，停止錄音並回到預設狀態')

          // 停止錄音
          recording.stopRecording()

          // 清理連線
          transcript.disconnect()

          // 回到預設狀態
          setAppData(prev => {
            prevStateRef.current = "default"
            return { ...prev, state: "default" }
          })

          // 顯示錯誤訊息
          const errorMessage = recordingError || transcriptError || '錄音或轉錄過程中發生錯誤'
          toast({
            title: '錄音錯誤',
            description: errorMessage,
            variant: 'destructive',
          })
        }

        // 如果是處理狀態的錯誤，也回到預設狀態
        if (currentState === "processing") {
          console.log('🚨 [錯誤處理] 處理狀態錯誤，回到預設狀態')

          setAppData(prev => {
            prevStateRef.current = "default"
            return { ...prev, state: "default" }
          })

          const errorMessage = transcriptError || recordingError || '處理轉錄過程中發生錯誤'
          toast({
            title: '處理錯誤',
            description: errorMessage,
            variant: 'destructive',
          })
        }
      }

      // 更新錯誤狀態追蹤
      prevErrorStateRef.current = {
        recording: recordingError,
        transcript: transcriptError
      }
    }
  }, [recording.error, transcript.error, session.currentSession, recording, transcript, toast])

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
      // 特別處理會話衝突錯誤
      if (err instanceof Error && err.message.includes('檢測到活躍會話衝突')) {
        const conflictMsg = '偵測到會話衝突，請重新整理頁面後再試'
        console.error("🎤 startRecording: 會話衝突錯誤:", err.message)
        setError(conflictMsg)
        toast({
          title: '會話衝突',
          description: '目前已有活躍會話，請重新整理頁面後再試，或等待當前會話結束',
          variant: 'destructive'
        })
        return
      }

      const msg = err instanceof Error ? err.message : '開始錄音失敗'
      console.error("🎤 startRecording: 流程中發生錯誤:", msg)
      setError(msg)
      toast({ title: '錄音失敗', description: msg, variant: 'destructive' })
    } finally {
      setIsLoading(false)
      console.log("🎤 startRecording: 流程結束")
    }
  }, [session, recording, transcript, appData.editorContent, toast])

  // 建立錄音會話
  const createRecordingSession = useCallback(async (title: string) => {
    setIsLoading(true)
    setError(null)

    try {
      const newSession = await session.createRecordingSession(title, appData.editorContent)
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
      // 特別處理會話衝突錯誤
      if (err instanceof Error && err.message.includes('檢測到活躍會話衝突')) {
        const conflictMsg = '偵測到會話衝突，請重新整理頁面後再試'
        console.error("🎤 createRecordingSession: 會話衝突錯誤:", err.message)
        setError(conflictMsg)
        toast({
          title: '會話衝突',
          description: '目前已有活躍會話，請重新整理頁面後再試，或等待當前會話結束',
          variant: 'destructive'
        })
        return
      }

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
  }, [session, notes, toast, appData.editorContent])

  // 開始錄音 - 支援四狀態流程
  const startRecording = useCallback(async (title: string) => {
    console.log("🎤 startRecording: 流程開始")
    setIsLoading(true)
    try {
      // 先檢查是否有活躍會話，確保前端狀態與後端同步
      console.log("🎤 startRecording: 檢查活躍會話狀態")
      const latestActiveSession = await session.checkActiveSession()

      let sessionToRecord = latestActiveSession || session.currentSession
      console.log("🎤 startRecording: 會話狀態檢查結果:", {
        latestActiveSession: latestActiveSession?.id,
        currentSession: session.currentSession?.id,
        finalSessionToUse: sessionToRecord?.id
      })

      if (latestActiveSession && !session.currentSession) {
        console.log("🎤 startRecording: 檢測到活躍會話，同步前端狀態")
      }

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
      } else if (sessionToRecord.type === 'recording') {
        console.log("🎤 startRecording: 使用現有的錄音會話:", sessionToRecord.id)
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
      // 特別處理會話衝突錯誤
      if (err instanceof Error && err.message.includes('檢測到活躍會話衝突')) {
        const conflictMsg = '偵測到會話衝突，請重新整理頁面後再試'
        console.error("🎤 startRecording: 會話衝突錯誤:", err.message)
        setError(conflictMsg)
        toast({
          title: '會話衝突',
          description: '目前已有活躍會話，請重新整理頁面後再試，或等待當前會話結束',
          variant: 'destructive'
        })
        return
      }

      const msg = err instanceof Error ? err.message : '開始錄音失敗'
      console.error("🎤 startRecording: 流程中發生錯誤:", msg)
      setError(msg)
      toast({ title: '錄音失敗', description: msg, variant: 'destructive' })
    } finally {
      setIsLoading(false)
      console.log("🎤 startRecording: 流程結束")
    }
  }, [session, recording, transcript, appData.editorContent, toast])

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
