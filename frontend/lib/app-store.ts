"use client"

import { useState, useCallback, useRef } from 'react'
import { serviceContainer, SERVICE_KEYS } from './services'
import type { RecordingFlowService, RecordingFlowListener } from './services/recording-flow-service'
import type { SessionResponse } from './api'
import { AppState, SessionStatus, SessionType, TranscriptEntry } from '../types/app-state'

/**
 * Store 狀態介面
 */
export interface AppStoreState {
  // 應用狀態
  currentState: AppState
  isLoading: boolean
  error: string | null

  // 會話狀態
  session: {
    id: string
    status: SessionStatus
    type: SessionType
  } | null

  // 錄音狀態
  isRecording: boolean
  recordingTime: number

  // 逐字稿狀態
  transcriptEntries: TranscriptEntry[]

  // 編輯器狀態
  editorContent: string
}

/**
 * Store 操作介面
 */
export interface AppStoreActions {
  // 核心業務操作
  startRecording: (title?: string) => Promise<void>
  stopRecording: () => Promise<void>

  // 編輯器操作
  updateEditorContent: (content: string) => void

  // 狀態重置
  resetState: () => void

  // 錯誤處理
  clearError: () => void
}

/**
 * Store Hook 返回值
 */
export interface AppStoreReturn {
  state: AppStoreState
  actions: AppStoreActions
}

/**
 * AppStore - 統一的狀態管理
 *
 * 職責：
 * 1. 管理應用狀態
 * 2. 調用服務層執行業務邏輯
 * 3. 處理 loading 和錯誤狀態
 * 4. 提供簡潔的 API 給 UI 層
 */
export function useAppStore(): AppStoreReturn {
  // === 狀態定義 ===
  const [currentState, setCurrentState] = useState<AppState>('default')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<AppStoreState['session']>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([])
  const [editorContent, setEditorContent] = useState('')

  // === 服務引用 ===
  const recordingFlowServiceRef = useRef<RecordingFlowService | null>(null)
  const flowListenerRef = useRef<RecordingFlowListener | null>(null)

  // === 初始化服務 ===
  const initializeRecordingFlowService = useCallback(() => {
    if (!recordingFlowServiceRef.current) {
      recordingFlowServiceRef.current = serviceContainer.resolve<RecordingFlowService>(
        SERVICE_KEYS.RECORDING_FLOW_SERVICE
      )
    }
    return recordingFlowServiceRef.current
  }, [])

  // === 流程監聽器 ===
  const createFlowListener = useCallback((): RecordingFlowListener => {
    return {
      onTranscriptReceived: (transcript) => {
        console.log('📝 [AppStore] 收到逐字稿:', transcript)
        setTranscriptEntries(prev => [...prev, transcript])
      },

      onFirstTranscriptReceived: () => {
        console.log('🎯 [AppStore] 收到第一個逐字稿，轉換狀態')
        setCurrentState('recording_active')
      },

      onRecordingStatusChange: (recording) => {
        console.log('�� [AppStore] 錄音狀態變更:', recording)
        setIsRecording(recording)
      },

      onTranscriptComplete: () => {
        console.log('✅ [AppStore] 逐字稿轉錄完成')
        setCurrentState('finished')
      },

      onError: (errorMessage) => {
        console.error('❌ [AppStore] 錄音流程錯誤:', errorMessage)
        setError(errorMessage)
        setIsLoading(false)
        setCurrentState('default')
      }
    }
  }, [])

  // === 錄音時間追蹤 ===
  const startRecordingTimeTracking = useCallback(() => {
    const interval = setInterval(() => {
      const service = recordingFlowServiceRef.current
      if (service && service.isActive()) {
        const time = service.getRecordingTime()
        setRecordingTime(time)
      } else {
        clearInterval(interval)
      }
    }, 1000)

    return interval
  }, [])

  // === 業務操作 ===

  /**
   * 開始錄音流程
   */
  const startRecording = useCallback(async (title?: string): Promise<void> => {
    console.log('🎤 [AppStore] 開始錄音流程')

    try {
      // 1. 設置 loading 狀態
      setIsLoading(true)
      setError(null)
      setCurrentState('recording_waiting')

      // 2. 初始化服務
      const recordingFlowService = initializeRecordingFlowService()

      // 3. 設置流程監聽器
      if (flowListenerRef.current) {
        recordingFlowService.removeListener(flowListenerRef.current)
      }
      flowListenerRef.current = createFlowListener()
      recordingFlowService.addListener(flowListenerRef.current)

      // 4. 啟動錄音流程
      const result: RecordingFlowResult = await recordingFlowService.startRecordingFlow(title)

      if (result.success) {
        // 成功：更新會話資訊和狀態
        setSession({
          id: result.sessionId,
          status: 'active' as SessionStatus,
          type: 'recording' as SessionType
        })

        setCurrentState('recording_waiting')

        // 啟動時間追蹤
        startRecordingTimeTracking()

        console.log('✅ [AppStore] 錄音流程啟動成功:', result.sessionId)
      } else {
        // 失敗：顯示錯誤
        throw new Error(result.error || '錄音流程啟動失敗')
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '開始錄音失敗'
      console.error('❌ [AppStore] 錄音流程啟動失敗:', error)

      setError(errorMessage)
      setCurrentState('default')
    } finally {
      setIsLoading(false)
    }
  }, [initializeRecordingFlowService, createFlowListener, startRecordingTimeTracking])

  /**
   * 停止錄音流程
   */
  const stopRecording = useCallback(async (): Promise<void> => {
    console.log('🛑 [AppStore] 停止錄音流程')

    try {
      setIsLoading(true)
      setCurrentState('processing')

      const recordingFlowService = recordingFlowServiceRef.current
      if (recordingFlowService) {
        await recordingFlowService.stopRecordingFlow()

        // 清理監聽器
        if (flowListenerRef.current) {
          recordingFlowService.removeListener(flowListenerRef.current)
          flowListenerRef.current = null
        }
      }

      // 更新狀態
      setIsRecording(false)
      setCurrentState('finished')

      console.log('✅ [AppStore] 錄音流程停止成功')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止錄音失敗'
      console.error('❌ [AppStore] 停止錄音失敗:', error)
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * 更新編輯器內容
   */
  const updateEditorContent = useCallback((content: string) => {
    setEditorContent(content)
  }, [])

  /**
   * 重置狀態
   */
  const resetState = useCallback(() => {
    console.log('🔄 [AppStore] 重置狀態')

    // 停止錄音流程（如果有）
    const recordingFlowService = recordingFlowServiceRef.current
    if (recordingFlowService && recordingFlowService.isActive()) {
      recordingFlowService.stopRecordingFlow().catch(console.error)
    }

    // 重置所有狀態
    setCurrentState('default')
    setIsLoading(false)
    setError(null)
    setSession(null)
    setIsRecording(false)
    setRecordingTime(0)
    setTranscriptEntries([])
    setEditorContent('')
  }, [])

  /**
   * 清除錯誤
   */
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // === 返回 Store 狀態和操作 ===
  return {
    state: {
      currentState,
      isLoading,
      error,
      session,
      isRecording,
      recordingTime,
      transcriptEntries,
      editorContent
    },
    actions: {
      startRecording,
      stopRecording,
      updateEditorContent,
      resetState,
      clearError
    }
  }
}
