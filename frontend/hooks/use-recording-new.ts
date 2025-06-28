"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { AudioUploadWebSocket, AckMissingMessage } from '../lib/websocket'
import { AudioRecorder, AudioChunk } from '../lib/audio-recorder'
import { transcriptManager, TranscriptMessage } from '../lib/transcript-manager'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'

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

export function useRecordingNew(): UseRecordingNewReturn {
  // 使用新的 Context 狀態管理
  const context = useAppStateContext()

  // 本地狀態（將逐漸遷移到 Context）
  const [localError, setLocalError] = useState<string | null>(null)
  const [localTranscriptCompleted, setLocalTranscriptCompleted] = useState(false)

  // WebSocket 和錄音器引用
  const audioUploadWsRef = useRef<AudioUploadWebSocket | null>(null)
  const audioRecorderRef = useRef<AudioRecorder | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // 計時器和狀態引用
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
  const chunksRef = useRef<AudioChunk[]>([])
  const retryCountsRef = useRef<Map<number, number>>(new Map())
  // 保護計時器不被意外清除
  const timerProtectionRef = useRef<boolean>(false)

  console.log('🔄 [useRecordingNew] Hook 初始化，功能開關狀態:', {
    useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
    useNewRecordingHook: isFeatureEnabled('useNewRecordingHook'),
    contextState: context.appData.state,
    contextIsRecording: context.appData.isRecording,
    contextRecordingTime: context.appData.recordingTime,
  })

  // 清理計時器
  const clearTimer = useCallback(() => {
    console.log('🛑 [useRecordingNew] clearTimer 被調用，當前計時器狀態:', !!timerRef.current)
    // 如果計時器受保護（錄音中），不清除
    if (timerProtectionRef.current) {
      console.log('🛡️ [useRecordingNew] 計時器受保護，跳過清除')
      return
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
      console.log('🛑 [useRecordingNew] 計時器已清除')
    }
  }, [])

  // 清理心跳計時器
  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  // 開始音檔上傳心跳
  const startHeartbeat = useCallback((uploadWs: AudioUploadWebSocket) => {
    clearHeartbeat()

    heartbeatRef.current = setInterval(() => {
      if (uploadWs.isConnected) {
        uploadWs.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now()
        }))
      }
    }, 30000) // 每30秒發送一次心跳
  }, [clearHeartbeat])

  // 開始錄音計時器 - 整合 Context
  const startTimer = useCallback(() => {
    console.log('⏰ [useRecordingNew] startTimer 被調用')
    clearTimer()
    context.setRecordingTime(0)
    let currentTime = 0
    console.log('⏰ [useRecordingNew] 啟動錄音計時器')

    timerRef.current = setInterval(() => {
      // 使用本地變數追蹤時間，避免閉包問題
      currentTime += 1
      console.log('⏰ [useRecordingNew] 計時器 tick:', currentTime)
      context.setRecordingTime(currentTime)
    }, 1000)

    // 啟動保護機制
    timerProtectionRef.current = true
    console.log('⏰ [useRecordingNew] 計時器已設置，ID:', timerRef.current)
  }, [clearTimer, context])

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
      fullMessage: transcript
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
    const minutes = Math.floor(startTime / 60)
    const seconds = Math.floor(startTime % 60)
    const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

    const transcriptEntry = {
      time: timeStr,
      text: transcript.text ?? '',
    }

    // 如果是第一個逐字稿片段且狀態還是 waiting，先觸發狀態轉換
    const isFirstTranscript = context.appData.state === 'recording_waiting' && context.appData.transcriptEntries.length === 0

    context.addTranscriptEntry(transcriptEntry)
    console.log('✅ [useRecordingNew] 逐字稿已添加到 Context')

    if (isFirstTranscript) {
      const result = context.transition('FIRST_TRANSCRIPT_RECEIVED')
      if (result?.success) {
        console.log('✅ [useRecordingNew] 收到第一個逐字稿片段，狀態機轉換: recording_waiting → recording_active')
      } else {
        console.warn('⚠️ [useRecordingNew] 狀態機轉換失敗:', result?.error)
      }
    }
  }, [context])

  // 處理 ACK/Missing 訊息 - 支援重傳機制
  const handleAckMissing = useCallback((data: AckMissingMessage) => {
    console.log('📨 [useRecordingNew] 收到 ACK/Missing:', data)

    if (data.missing.length > 0) {
      console.warn('⚠️ 有遺失的音檔切片需要重傳:', data.missing)

      // 實作重傳機制
      data.missing.forEach(sequence => {
        const retryCount = retryCountsRef.current.get(sequence) ?? 0

        if (retryCount < 5) { // 最多重傳 5 次
          retryCountsRef.current.set(sequence, retryCount + 1)

          // 尋找對應的音檔切片進行重傳（如果還存在）
          if (chunksRef.current[sequence]) {
            console.log(`🔄 重傳音檔切片 #${sequence} (第 ${retryCount + 1} 次)`)
            audioUploadWsRef.current?.uploadAudioChunk(chunksRef.current[sequence].blob)
          }
        } else {
          console.error(`❌ 音檔切片 #${sequence} 重傳次數已達上限`)
        }
      })
    }
  }, [])

  // 處理音檔切片
  const handleAudioChunk = useCallback((chunk: AudioChunk) => {
    console.log(`🎵 [useRecordingNew] 收到音檔切片 #${chunk.sequence}, 大小: ${chunk.blob.size} bytes`)

    // 儲存切片供重傳使用
    chunksRef.current[chunk.sequence] = chunk

    // 如果 WebSocket 已連接，立即上傳
    if (audioUploadWsRef.current?.isConnected) {
      audioUploadWsRef.current.uploadAudioChunk(chunk.blob)
    }
  }, [])

  // 開始錄音 - 整合 Context 狀態管理
  const startRecording = useCallback(async (sessionId: string): Promise<void> => {
    try {
      setLocalError(null)
      context.setError(null)
      setLocalTranscriptCompleted(false)
      currentSessionIdRef.current = sessionId

      console.log('🎤 [useRecordingNew] 開始錄音流程:', { sessionId })

      // 確保在瀏覽器環境中執行
      if (typeof window === 'undefined') {
        throw new Error('此功能僅在瀏覽器環境中可用')
      }

      // 步驟 1: 建立音檔錄製器（12 秒切片）
      console.log('🎤 [useRecordingNew] 步驟 1: 初始化音檔錄製器')
      const audioRecorder = new AudioRecorder({
        chunkInterval: 12000, // 12 秒切片
        mimeType: 'audio/webm;codecs=opus'
      })

      audioRecorderRef.current = audioRecorder
      chunksRef.current = []
      retryCountsRef.current.clear()

      // 設定音檔錄製器事件
      audioRecorder.onChunk(handleAudioChunk)
      audioRecorder.onError((err) => {
        console.error('❌ [useRecordingNew] AudioRecorder 錯誤:', err)
        setLocalError(err.message)
        context.setError(err.message)
      })

      // 步驟 2: 初始化音訊權限
      console.log('🎤 [useRecordingNew] 步驟 2: 初始化音訊權限')
      await audioRecorder.initialize()

      // 步驟 3: 建立 WebSocket 連線（並行建立，確保都就緒）
      console.log('🎤 [useRecordingNew] 步驟 3: 建立 WebSocket 連線')

      // 3a. 建立音檔上傳 WebSocket
      console.log('🔌 [useRecordingNew] 建立音檔上傳 WebSocket')
      const uploadWs = new AudioUploadWebSocket(sessionId)
      await uploadWs.connect()

      // 設定音檔上傳 WebSocket 事件處理
      uploadWs.onAckMissing(handleAckMissing)
      audioUploadWsRef.current = uploadWs

      // 3b. 建立逐字稿接收 WebSocket（透過 TranscriptManager）
      console.log('🔌 [useRecordingNew] 建立逐字稿接收 WebSocket')
      await transcriptManager.connect(sessionId)
      transcriptManager.addListener(sessionId, handleTranscript)

      // 步驟 4: 驗證連線狀態
      console.log('🎤 [useRecordingNew] 步驟 4: 驗證連線狀態')
      if (!uploadWs.isConnected) {
        throw new Error('音檔上傳 WebSocket 連線失敗')
      }

      if (!transcriptManager.isConnected(sessionId)) {
        throw new Error('逐字稿接收 WebSocket 連線失敗')
      }

      console.log('✅ [useRecordingNew] 所有 WebSocket 連線已建立')

      // 步驟 5: 啟動心跳機制
      console.log('🎤 [useRecordingNew] 步驟 5: 啟動心跳機制')
      startHeartbeat(uploadWs)

      // 步驟 6: 開始錄音 - 使用 Context 狀態管理
      console.log('🎤 [useRecordingNew] 步驟 6: 開始錄音')

      // 先設置錄音狀態到 Context
      context.setRecording(true)
      console.log('🎤 [useRecordingNew] 錄音狀態已設置到 Context: true')

      console.log('✅ [useRecordingNew] 準備啟動 audioRecorder.startRecording()')
      await audioRecorder.startRecording()
      console.log('🎤 [useRecordingNew] audioRecorder.startRecording() 完成，準備啟動計時器')
      startTimer()

      console.log('✅ [useRecordingNew] 錄音開始成功，Session ID:', sessionId)
      console.log('⏰ [useRecordingNew] 檢查計時器狀態:', {
        timerExists: !!timerRef.current,
        recordingTime: context.appData.recordingTime,
        isRecording: context.appData.isRecording
      })

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '開始錄音失敗'
      setLocalError(errorMessage)
      context.setError(errorMessage)
      console.error('❌ [useRecordingNew] 開始錄音失敗:', err)

      // 錯誤時清理資源
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopRecording()
      }
      if (audioUploadWsRef.current) {
        audioUploadWsRef.current.disconnect()
        audioUploadWsRef.current = null
      }
      if (currentSessionIdRef.current) {
        transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
      }
    }
  }, [handleAudioChunk, handleAckMissing, handleTranscript, startTimer, startHeartbeat, context])

  // 停止錄音 - 整合 Context 狀態管理
  const stopRecording = useCallback(() => {
    try {
      // 關閉計時器保護
      timerProtectionRef.current = false

      // 停止音檔錄製器
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopRecording()
      }

      // 關閉音檔上傳 WebSocket
      if (audioUploadWsRef.current) {
        audioUploadWsRef.current.disconnect()
        audioUploadWsRef.current = null
      }

      // 使用 Context 更新狀態
      context.setRecording(false)
      clearTimer()
      clearHeartbeat()

      console.log('✅ [useRecordingNew] 錄音停止，等待轉錄完成')

      // 注意：不斷開 TranscriptManager 連接，繼續接收轉錄結果

    } catch (err) {
      console.error('❌ [useRecordingNew] 停止錄音失敗:', err)
      const errorMessage = '停止錄音時發生錯誤'
      setLocalError(errorMessage)
      context.setError(errorMessage)
    }
  }, [clearTimer, clearHeartbeat, context])

  // 清空逐字稿 - 整合 Context
  const clearTranscripts = useCallback(() => {
    context.setTranscriptEntries([])
    setLocalTranscriptCompleted(false)
    console.log('🔄 [useRecordingNew] 逐字稿已清除')
  }, [context])

  // 清理資源
  useEffect(() => {
    return () => {
      // 移除 TranscriptManager 監聽器
      if (currentSessionIdRef.current) {
        transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
      }

      // 不在 cleanup 中清理計時器，避免 React StrictMode 問題
      // 計時器會在 stopRecording 或組件真正卸載時清理
      clearHeartbeat()

      // 關閉音檔上傳 WebSocket
      if (audioUploadWsRef.current) {
        audioUploadWsRef.current.disconnect()
      }

      // 注意：不在這裡停止錄音器，避免 React StrictMode 重新渲染時意外停止
      // 錄音的停止應該由使用者明確觸發或錯誤處理觸發
    }
  }, [clearHeartbeat, handleTranscript])

  // 組件真正卸載時的清理（例如頁面切換）
  useEffect(() => {
    // 使用 window unload 事件來檢測真正的頁面卸載
    const handleUnload = () => {
      console.log('🔚 [useRecordingNew] 頁面卸載，清理所有資源')
      timerProtectionRef.current = false
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopRecording()
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
