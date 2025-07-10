"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'
import { SERVICE_KEYS, serviceContainer } from '../lib/services'
import type { IRecordingService, ITranscriptService, TranscriptMessage } from '../lib/services'

interface UseRecordingNewReturn {
  isRecording: boolean
  recordingTime: number
  transcripts: TranscriptMessage[]
  transcriptCompleted: boolean
  error: string | null
  startRecording: (sessionId: string) => Promise<void>
  stopRecording: () => void
  clearTranscripts: () => void
}

/**
 * useRecordingNew - 錄音管理 Hook (適配器層)
 *
 * 重構為適配器層：
 * - 內部調用 RecordingService 和 TranscriptService 而非直接管理音頻錄製器
 * - 保持對外接口完全不變，確保組件層無感知變更
 * - 簡化複雜的錄音邏輯，委託給服務層處理
 */
export function useRecordingNew(): UseRecordingNewReturn {
  // 使用新的 Context 狀態管理
  const context = useAppStateContext()

  // 本地狀態（將逐漸遷移到 Context）
  const [localError, setLocalError] = useState<string | null>(null)
  const [localTranscriptCompleted, setLocalTranscriptCompleted] = useState(false)

  // 服務引用
  const recordingServiceRef = useRef<IRecordingService | null>(null)
  const transcriptServiceRef = useRef<ITranscriptService | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // 全域唯一錄音計時器 - 使用 useRef 保持穩定引用
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)

  // waiting→active 超時保險
  const waitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  console.log('🔄 [useRecordingNew] Hook 初始化 (適配器層)，功能開關狀態:', {
    useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
    useNewRecordingHook: isFeatureEnabled('useNewRecordingHook'),
    contextState: context.appData.state,
    contextIsRecording: context.appData.isRecording,
    contextRecordingTime: context.appData.recordingTime,
    timestamp: new Date().toISOString()
  })

  // 清除 waiting 超時
  const clearWaitingTimeout = useCallback(() => {
    if (waitingTimeoutRef.current) {
      clearTimeout(waitingTimeoutRef.current)
      waitingTimeoutRef.current = null
      console.log('⏰ [useRecordingNew] Waiting 超時已清除')
    }
  }, [])

  // 初始化服務實例
  const initializeServices = useCallback(() => {
    if (!recordingServiceRef.current) {
      try {
        recordingServiceRef.current = serviceContainer.resolve<IRecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
        console.log('✅ [useRecordingNew] RecordingService 初始化成功')
      } catch (error) {
        console.error('❌ [useRecordingNew] 無法解析 RecordingService:', error)
        throw new Error('錄音服務初始化失敗')
      }
    }

    if (!transcriptServiceRef.current) {
      try {
        transcriptServiceRef.current = serviceContainer.resolve<ITranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)
        console.log('✅ [useRecordingNew] TranscriptService 初始化成功')
      } catch (error) {
        console.error('❌ [useRecordingNew] 無法解析 TranscriptService:', error)
        throw new Error('逐字稿服務初始化失敗')
      }
    }
  }, [])

  // 處理逐字稿接收 - 整合 Context
  const handleTranscript = useCallback((transcript: TranscriptMessage) => {
    console.log('📝 [useRecordingNew] 收到逐字稿訊息:', {
      type: transcript.type,
      text: transcript.text,
      textLength: transcript.text?.length || 0,
      start_time: transcript.start_time,
      end_time: transcript.end_time,
      start_sequence: transcript.start_sequence,
      confidence: transcript.confidence,
      sessionId: currentSessionIdRef.current,
      timestamp: new Date().toISOString(),
    })

    // 處理轉錄完成通知
    if (transcript.type === 'transcript_complete' || transcript.message === 'transcription_complete') {
      console.log('✅ [useRecordingNew] 逐字稿轉錄完成，設定 transcriptCompleted=true')
      setLocalTranscriptCompleted(true)
      return
    }

    // 處理 active phase 訊息（重要：這會觸發狀態轉換）
    if (transcript.type === 'active' || transcript.phase === 'active') {
      console.log('🚀 [useRecordingNew] 收到 active phase 訊息，轉錄開始')
      // 清除 waiting 超時
      clearWaitingTimeout()
      // 使用狀態機觸發轉換
      const result = context.transition('FIRST_TRANSCRIPT_RECEIVED')
      if (result?.success) {
        console.log('✅ [useRecordingNew] 狀態機轉換成功: recording_waiting → recording_active')
      }
      return
    }

    // 只處理逐字稿片段類型的訊息
    if (transcript.type !== 'transcript_segment') {
      console.log('⚠️ [useRecordingNew] 跳過非逐字稿片段訊息:', transcript.type)
      return
    }

    if (!transcript.text) {
      console.log('⚠️ [useRecordingNew] 跳過空文字逐字稿')
      return
    }

    console.log('🔄 [useRecordingNew] 開始處理逐字稿片段...', {
      text: transcript.text,
      textPreview: transcript.text.substring(0, 50) + '...',
      sequence: transcript.start_sequence,
      startTime: transcript.start_time,
      endTime: transcript.end_time
    })

    // 使用 Context 更新逐字稿 - 轉換為 TranscriptEntry 格式
    const startTime = transcript.start_time ?? 0
    const hours = Math.floor(startTime / 3600)
    const minutes = Math.floor((startTime % 3600) / 60)
    const seconds = Math.floor(startTime % 60)
    const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

    const transcriptEntry = {
      time: timeStr,
      text: transcript.text ?? '',
    }

    // 如果是第一個逐字稿片段且狀態還是 waiting，先觸發狀態轉換
    const isFirstTranscript = context.appData.state === 'recording_waiting' && context.appData.transcriptEntries.length === 0

    context.addTranscriptEntry(transcriptEntry)
    console.log('✅ [useRecordingNew] 逐字稿已添加到 Context')

    if (isFirstTranscript) {
      // 清除 waiting 超時
      clearWaitingTimeout()
      const result = context.transition('FIRST_TRANSCRIPT_RECEIVED')
      if (result?.success) {
        console.log('✅ [useRecordingNew] 收到第一個逐字稿片段，狀態機轉換: recording_waiting → recording_active')
      } else {
        console.warn('⚠️ [useRecordingNew] 狀態機轉換失敗:', result?.error)
      }
    }
  }, [context, clearWaitingTimeout])

  // 開始錄音 - 使用服務層
  const startRecording = useCallback(async (sessionId: string): Promise<void> => {
    try {
      setLocalError(null)
      context.setError(null)
      setLocalTranscriptCompleted(false)
      currentSessionIdRef.current = sessionId

      // 立即啟動計時器
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current)
        recTimerRef.current = null
      }
      recordingStartedAtRef.current = Date.now()
      context.setRecordingTime(0)
      recTimerRef.current = setInterval(() => {
        if (recordingStartedAtRef.current) {
          const sec = Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
          context.setRecordingTime(sec)
        }
      }, 1000)

      context.setRecording(true)
      console.log('⏱️ [useRecordingNew] 計時器立即啟動')

      // 設置 waiting→active 超時保險（20秒）
      clearWaitingTimeout()
      waitingTimeoutRef.current = setTimeout(() => {
        if (context.appData.state === 'recording_waiting') {
          console.warn('⚠️ [useRecordingNew] 20秒內未收到逐字稿，強制轉換到 recording_active')
          const result = context.transition('FIRST_TRANSCRIPT_RECEIVED')
          if (result?.success) {
            console.log('✅ [useRecordingNew] 超時保險觸發: recording_waiting → recording_active')
          } else {
            console.error('❌ [useRecordingNew] 超時保險轉換失敗:', result?.error)
          }
        }
      }, 20000)
      console.log('⏰ [useRecordingNew] 已設置 20 秒 waiting 超時保險')

      // 初始化服務
      initializeServices()
      const recordingService = recordingServiceRef.current!
      console.log('Recorder instance', recordingService)
      const transcriptService = transcriptServiceRef.current!

      // 確保先建立 WebSocket 連線再註冊監聽器，避免漏接訊息
      await transcriptService.connect(sessionId)

      // 設置錄音狀態監聽（保留原本 interval 作為備用）
      const checkRecordingState = () => {
        const state = recordingService.getRecordingState()
        context.setRecording(state.isRecording)
        // context.setRecordingTime(state.recordingTime) // 由 recTimer 主導
        if (state.error) {
          setLocalError(state.error)
          context.setError(state.error)
        }
      }
      const stateCheckInterval = setInterval(checkRecordingState, 1000)

      transcriptService.addTranscriptListener(sessionId, handleTranscript)
      await recordingService.startRecording(sessionId)

      const cleanup = () => {
        clearInterval(stateCheckInterval)
        transcriptService.removeTranscriptListener(sessionId, handleTranscript)
        if (recTimerRef.current) {
          clearInterval(recTimerRef.current)
          recTimerRef.current = null
          recordingStartedAtRef.current = null
          console.log('⏹️ [useRecordingNew] 計時器已清除')
        }
        // 清除 waiting 超時
        clearWaitingTimeout()
      }
      (globalThis as any).currentRecordingCleanup = cleanup
      console.log('✅ [useRecordingNew] 錄音開始成功 (服務層)，Session ID:', sessionId)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '開始錄音失敗'
      setLocalError(errorMessage)
      context.setError(errorMessage)
      console.error('❌ [useRecordingNew] 開始錄音失敗:', err)
      // 清除 waiting 超時
      clearWaitingTimeout()
    }
  }, [initializeServices, handleTranscript, context, clearWaitingTimeout])

  // 停止錄音 - 使用服務層
  const stopRecording = useCallback(() => {
    try {
      console.log('🛑 [useRecordingNew] 停止錄音 (適配器層)')
      // 清除 recTimer
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current)
        recTimerRef.current = null
        recordingStartedAtRef.current = null
        console.log('⏹️ [useRecordingNew] 計時器已清除')
      }
      // 清除 waiting 超時
      clearWaitingTimeout()
      // 執行清理函數
      const cleanup = (globalThis as any).currentRecordingCleanup
      if (cleanup) {
        cleanup()
        delete (globalThis as any).currentRecordingCleanup
      }
      // 使用服務層停止錄音
      const recordingService = recordingServiceRef.current
      if (recordingService) {
        recordingService.stopRecording()
      }

      // 更新 Context 狀態
      context.setRecording(false)

      console.log('✅ [useRecordingNew] 錄音停止成功 (服務層)，等待轉錄完成')

    } catch (err) {
      console.error('❌ [useRecordingNew] 停止錄音失敗:', err)
      const errorMessage = '停止錄音時發生錯誤'
      setLocalError(errorMessage)
      context.setError(errorMessage)
    }
  }, [context, clearWaitingTimeout])

  // 清空逐字稿 - 整合 Context
  const clearTranscripts = useCallback(() => {
    context.setTranscriptEntries([])
    setLocalTranscriptCompleted(false)
    console.log('🔄 [useRecordingNew] 逐字稿已清除 (適配器層)')
  }, [context])

  // 清理資源
  useEffect(() => {
    return () => {
      // 清理逐字稿監聽器
      if (currentSessionIdRef.current && transcriptServiceRef.current) {
        transcriptServiceRef.current.removeTranscriptListener(currentSessionIdRef.current, handleTranscript)
      }

      // 清理錄音狀態檢查
      const cleanup = (globalThis as any).currentRecordingCleanup
      if (cleanup) {
        cleanup()
        delete (globalThis as any).currentRecordingCleanup
      }

      // 清理計時器
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current)
        recTimerRef.current = null
        recordingStartedAtRef.current = null
        console.log('🔚 [useRecordingNew] useEffect cleanup: 計時器已清除')
      }

      // 清理 waiting 超時
      clearWaitingTimeout()
    }
  }, [handleTranscript, clearWaitingTimeout])

  // 組件真正卸載時的清理（例如頁面切換）
  useEffect(() => {
    const handleUnload = () => {
      console.log('🔚 [useRecordingNew] 頁面卸載，清理所有資源 (適配器層)')
      const cleanup = (globalThis as any).currentRecordingCleanup
      if (cleanup) {
        cleanup()
        delete (globalThis as any).currentRecordingCleanup
      }

      const recordingService = recordingServiceRef.current
      if (recordingService) {
        recordingService.stopRecording()
      }
    }

    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
    }
  }, [])

  // 轉換 TranscriptMessage[] 為向後相容格式
  const compatibleTranscripts: TranscriptMessage[] = context.appData.transcriptEntries.map((entry, index) => ({
    type: 'transcript_segment',
    text: entry.text,
    start_time: 0, // 簡化處理，實際應該從 time 字串解析
    end_time: 0,
    start_sequence: index,
    confidence: 1.0,
    timestamp: Date.now(),
  }))

  // 返回介面保持與舊版相容
  return {
    isRecording: context.appData.isRecording,
    recordingTime: context.appData.recordingTime,
    transcripts: compatibleTranscripts,
    transcriptCompleted: localTranscriptCompleted,
    error: context.error || localError,
    startRecording,
    stopRecording,
    clearTranscripts,
  }
}
