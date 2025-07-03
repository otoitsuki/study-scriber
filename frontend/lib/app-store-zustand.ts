"use client"

import { create } from 'zustand'
import { serviceContainer, SERVICE_KEYS } from './services'
import type { ISessionService } from './services/interfaces'
import { AppState, SessionStatus, SessionType, TranscriptEntry } from '../types/app-state'
import { TranscriptManager } from './transcript-manager'

/**
 * App 狀態介面
 */
interface AppStoreState {
  // 應用狀態
  appState: AppState
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
  recordingStartTime: number | null

  // 內部計時器
  timerId: NodeJS.Timeout | null

  // 逐字稿狀態
  transcriptEntries: TranscriptEntry[]

  // 編輯器狀態
  editorContent: string
}

/**
 * App 操作介面
 */
interface AppStoreActions {
  // 核心業務操作
  startRecording: (title?: string) => Promise<void>
  stopRecording: () => Promise<void>

  // 狀態管理
  setState: (appState: AppState) => void
  setSession: (session: AppStoreState['session']) => void
  setRecording: (isRecording: boolean) => void
  setError: (error: string | null) => void
  clearError: () => void

  // 編輯器操作
  updateEditorContent: (content: string) => void
  addTranscriptEntry: (entry: TranscriptEntry) => void

  // 計時器操作
  startTimer: () => void
  stopTimer: () => void
  cleanup: () => void

  // 錄音時間操作
  setRecordingStart: (timestamp: number) => void

  // 狀態重置
  resetState: () => void
}

/**
 * 完整的 Store 類型
 */
type AppStore = AppStoreState & AppStoreActions

/**
 * 基於 Zustand 的 App Store
 *
 * 實現用戶要求的會話衝突處理策略：
 * 1. startRecording 時優先調用 ensureRecordingSession
 * 2. 優雅處理 409 衝突，自動載入現有會話
 * 3. 提供清晰的狀態管理和錯誤處理
 */
export const useAppStore = create<AppStore>((set, get) => ({
  // === 初始狀態 ===
  appState: 'default' as AppState,
  isLoading: false,
  error: null,
  session: null,
  isRecording: false,
  recordingTime: 0,
  recordingStartTime: null,
  timerId: null,
  transcriptEntries: [],
  editorContent: '',

  // === 核心業務操作 ===

  /**
   * 開始錄音 - 使用雙 WebSocket 完整錄音流程
   */
  startRecording: async (title?: string) => {
    console.log('🎤 [AppStore] 開始雙 WebSocket 錄音流程')

    // 1. 設置等待狀態
    set({
      appState: 'recording_waiting',
      isLoading: true,
      error: null
    })

    try {
      // 2. 獲取當前的錄音開始時間（由 onstart 事件設置）
      const currentState = get()
      const startTs = currentState.recordingStartTime

      console.log('🕐 [AppStore] 錄音開始時間:', {
        startTs,
        startTsDate: startTs ? new Date(startTs).toISOString() : 'N/A',
        hasStartTime: !!startTs
      })

      // 3. 獲取 RecordingFlowService
      const { RecordingFlowService } = await import('./services/recording-flow-service')
      const recordingFlowService = new RecordingFlowService()
      await recordingFlowService.initialize()

      // 4. 啟動完整錄音流程（包含雙 WebSocket），傳遞開始時間戳
      console.log('🔍 [AppStore] 啟動完整錄音流程...')
      const sessionResponse = await recordingFlowService.startRecordingFlow(
        title || `錄音筆記 ${new Date().toLocaleString()}`,
        undefined, // content
        startTs    // 傳遞錄音開始時間戳
      )

      console.log('✅ [AppStore] 雙 WebSocket 錄音流程啟動成功:', {
        sessionId: sessionResponse.id,
        withStartTs: !!startTs
      })

      // 5. 更新狀態，保持等待逐字稿
      set({
        appState: 'recording_waiting',
        session: {
          id: sessionResponse.id,
          status: sessionResponse.status as SessionStatus,
          type: sessionResponse.type as SessionType
        },
        isRecording: true,
        isLoading: false
      })

      // 6. 不需要再次啟動計時器，因為已經在 setRecordingStart 中啟動了
      console.log('🕐 [AppStore] 計時器已在 onstart 事件中啟動，錄音時間:', currentState.recordingTime)

        // 7. 儲存服務實例供停止時使用
        ; (globalThis as any).currentRecordingFlowService = recordingFlowService

      console.log('🎯 [AppStore] 雙 WebSocket 錄音模式啟動成功')

    } catch (error) {
      // 8. 錯誤處理
      const errorMessage = error instanceof Error ? error.message : '開始錄音失敗'
      console.error('❌ [AppStore] 無法開始錄音:', error)

      // 清理計時器（如果已啟動）
      get().stopTimer()

      set({
        appState: 'default',
        error: errorMessage,
        isLoading: false,
        session: null,
        isRecording: false
      })

      console.error('🚨 [AppStore] 雙 WebSocket 錄音啟動失敗，請重試')
    }
  },

  /**
   * 停止錄音 - 停止雙 WebSocket 錄音流程
   */
  stopRecording: async () => {
    console.log('🛑 [AppStore] 停止雙 WebSocket 錄音流程')

    // 停止計時器
    get().stopTimer()

    set({
      appState: 'processing',
      isLoading: true
    })

    try {
      // 獲取並調用 RecordingFlowService
      const recordingFlowService = (globalThis as any).currentRecordingFlowService

      if (recordingFlowService) {
        await recordingFlowService.stopRecordingFlow()
        await recordingFlowService.cleanup()

          // 清理全局引用
          ; (globalThis as any).currentRecordingFlowService = null

        console.log('✅ [AppStore] RecordingFlowService 停止成功')
      } else {
        console.warn('⚠️ [AppStore] 沒有找到活躍的 RecordingFlowService')
      }

      set({
        appState: 'finished',
        isRecording: false,
        isLoading: false
      })

      console.log('✅ [AppStore] 雙 WebSocket 錄音停止成功')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止錄音失敗'
      console.error('❌ [AppStore] 停止錄音失敗:', error)

      set({
        error: errorMessage,
        isLoading: false
      })
    }
  },

  // === 狀態管理操作 ===

  setState: (appState: AppState) => {
    set({ appState })
  },

  setSession: (session: AppStoreState['session']) => {
    set({ session })
  },

  setRecording: (isRecording: boolean) => {
    set({ isRecording })
  },

  setError: (error: string | null) => {
    set({ error })
  },

  clearError: () => {
    set({ error: null })
  },

  // === 編輯器操作 ===

  updateEditorContent: (content: string) => {
    set({ editorContent: content })
  },

  addTranscriptEntry: (entry: TranscriptEntry) => {
    console.log('[S] add entry', entry.text.slice(0, 20))
    set((state) => ({
      transcriptEntries: [...state.transcriptEntries, entry],
      // 🎯 收到第一個逐字稿時，從 recording_waiting → recording_active
      appState: state.appState === 'recording_waiting' ? 'recording_active' : state.appState
    }))
  },

  setRecordingTime: (time: number) => {
    set({ recordingTime: time })
  },

  // 設置錄音開始時間並啟動基於實際時間的計時器
  setRecordingStart: (timestamp: number) => {
    console.log('🚀 [AppStore] 設置錄音開始時間:', new Date(timestamp).toISOString())
    set({ recordingStartTime: timestamp, recordingTime: 0 })

    // 啟動基於實際時間的計時器
    get().startTimer()
  },

  // 計時邏輯 - 修改為基於實際時間戳的計算
  startTimer: () => {
    const currentState = get()
    if (currentState.timerId) return // 防止重複啟動

    const timerId = setInterval(() => {
      const state = get()
      if (state.recordingStartTime) {
        const elapsed = Math.floor((Date.now() - state.recordingStartTime) / 1000)
        set({ recordingTime: elapsed })
      } else {
        // Fallback 到舊邏輯
        set(prevState => ({ recordingTime: prevState.recordingTime + 1 }))
      }
    }, 1000)

    set({ timerId })
    console.log('🕐 [AppStore] 錄音計時器已啟動')
  },

  stopTimer: () => {
    const currentState = get()
    if (currentState.timerId) {
      clearInterval(currentState.timerId)
      set({ timerId: null, recordingTime: 0, recordingStartTime: null })
      console.log('⏹️ [AppStore] 錄音計時器已停止並重置')
    }
  },

  cleanup: () => {
    const currentState = get()
    if (currentState.timerId) {
      clearInterval(currentState.timerId)
      set({ timerId: null })
      console.log('🧹 [AppStore] 計時器已清理')
    }
  },

  // === 狀態重置 ===

  resetState: () => {
    console.log('🔄 [AppStore] 重置狀態')

    // 清理計時器
    const currentState = get()
    if (currentState.timerId) {
      clearInterval(currentState.timerId)
    }

    set({
      appState: 'default',
      isLoading: false,
      error: null,
      session: null,
      isRecording: false,
      recordingTime: 0,
      recordingStartTime: null,
      timerId: null,
      transcriptEntries: [],
      editorContent: ''
    })
  }
}))

/**
 * 便利的 Hook：只獲取狀態
 */
export const useAppState = () => useAppStore((state: AppStore) => ({
  appState: state.appState,
  isLoading: state.isLoading,
  error: state.error,
  session: state.session,
  isRecording: state.isRecording,
  recordingTime: state.recordingTime,
  transcriptEntries: state.transcriptEntries,
  editorContent: state.editorContent
}))

/**
 * 便利的 Hook：只獲取操作
 */
export const useAppActions = () => useAppStore((state: AppStore) => ({
  startRecording: state.startRecording,
  stopRecording: state.stopRecording,
  setState: state.setState,
  setSession: state.setSession,
  setRecording: state.setRecording,
  setError: state.setError,
  clearError: state.clearError,
  updateEditorContent: state.updateEditorContent,
  addTranscriptEntry: state.addTranscriptEntry,
  setRecordingStart: state.setRecordingStart,
  resetState: state.resetState
}))

export default useAppStore
