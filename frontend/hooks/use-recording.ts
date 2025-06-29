"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { AudioUploadWebSocket, AckMissingMessage } from '../lib/websocket'
import { AudioRecorder, AudioChunk } from '../lib/audio-recorder'
import { transcriptManager, TranscriptMessage } from '../lib/transcript-manager'
import { getAudioChunkIntervalMs, getAudioConfigInfo } from '../lib/config'

interface UseRecordingReturn {
  isRecording: boolean
  recordingTime: number
  transcripts: TranscriptMessage[]
  transcriptCompleted: boolean
  error: string | null
  startRecording: (sessionId: string) => Promise<void>
  stopRecording: () => void
  clearTranscripts: () => void
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([])
  const [transcriptCompleted, setTranscriptCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // WebSocket 和錄音器引用
  const audioUploadWsRef = useRef<AudioUploadWebSocket | null>(null)
  const audioRecorderRef = useRef<AudioRecorder | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)

  // 計時器和狀態引用
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
  const chunksRef = useRef<AudioChunk[]>([])
  const retryCountsRef = useRef<Map<number, number>>(new Map())

  // 清理計時器
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
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

  // 開始錄音計時器
  const startTimer = useCallback(() => {
    clearTimer()
    setRecordingTime(0)

    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1)
    }, 1000)
  }, [clearTimer])

  // 處理逐字稿接收 - 透過 TranscriptManager
  const handleTranscript = useCallback((transcript: TranscriptMessage) => {
    console.log('📝 [useRecording] 收到逐字稿訊息:', {
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
      console.log('✅ [useRecording] 逐字稿轉錄完成，設定 transcriptCompleted=true')
      setTranscriptCompleted(true)
      return
    }

    // 處理 active phase 訊息（重要：這會觸發狀態轉換）
    if (transcript.type === 'active' || transcript.phase === 'active') {
      console.log('🚀 [useRecording] 收到 active phase 訊息，轉錄開始')
      // 這裡可以設置一個標記，表示轉錄已開始
      return
    }

    // 只處理逐字稿片段類型的訊息
    if (transcript.type !== 'transcript_segment') {
      console.log('⚠️ [useRecording] 跳過非逐字稿片段訊息:', transcript.type)
      return
    }

    if (!transcript.text) {
      console.log('⚠️ [useRecording] 跳過空文字逐字稿')
      return
    }

    console.log('🔄 [useRecording] 開始處理逐字稿片段...', {
      text: transcript.text,
      textPreview: transcript.text.substring(0, 50) + '...',
      sequence: transcript.start_sequence,
      startTime: transcript.start_time,
      endTime: transcript.end_time
    })

    setTranscripts((prev) => {
      console.log('📊 [useRecording] 合併前狀態:', {
        existingCount: prev.length,
        newSegmentText: transcript.text,
        newSegmentSequence: transcript.start_sequence,
        newSegmentTime: transcript.start_time
      })

      // 使用 start_sequence 作為排序依據，如果沒有則使用時間戳
      const sequence = transcript.start_sequence ?? transcript.timestamp ?? 0

      // 依照序號排序並去重
      const filtered = prev.filter(t => {
        const existingSequence = t.start_sequence ?? t.timestamp ?? 0
        return existingSequence !== sequence
      })

      const updated = [...filtered, transcript].sort((a, b) => {
        const aSequence = a.start_sequence ?? a.timestamp ?? 0
        const bSequence = b.start_sequence ?? b.timestamp ?? 0
        return aSequence - bSequence
      })

      console.log('📊 [useRecording] 合併後狀態:', {
        newCount: updated.length,
        countChange: updated.length - prev.length,
        filteredCount: filtered.length,
        isDuplicate: filtered.length === prev.length ? false : true,
        lastSegmentText: updated[updated.length - 1]?.text?.substring(0, 50) + '...'
      })

      console.log(`✅ [useRecording] 逐字稿更新完成: ${prev.length} → ${updated.length} 個片段`)
      return updated
    })
  }, [])

  // 處理 ACK/Missing 訊息 - 支援重傳機制
  const handleAckMissing = useCallback((data: AckMissingMessage) => {
    console.log('📨 收到 ACK/Missing:', data)

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
    console.log(`🎵 收到音檔切片 #${chunk.sequence}, 大小: ${chunk.blob.size} bytes`)

    // 儲存切片供重傳使用
    chunksRef.current[chunk.sequence] = chunk

    // 如果 WebSocket 已連接，立即上傳
    if (audioUploadWsRef.current?.isConnected) {
      audioUploadWsRef.current.uploadAudioChunk(chunk.blob)
    }
  }, [])

  // 開始錄音 - 優化連線時序和穩定性
  const startRecording = useCallback(async (sessionId: string): Promise<void> => {
    try {
      setError(null)
      setTranscriptCompleted(false)
      currentSessionIdRef.current = sessionId

      console.log('🎤 [useRecording] 開始錄音流程:', { sessionId })

      // 確保在瀏覽器環境中執行
      if (typeof window === 'undefined') {
        throw new Error('此功能僅在瀏覽器環境中可用')
      }

      // 步驟 1: 建立音檔錄製器
      console.log('🎤 [useRecording] 步驟 1: 初始化音檔錄製器')
      const chunkInterval = getAudioChunkIntervalMs()
      const audioRecorder = new AudioRecorder({
        chunkInterval, // 使用環境變數配置的切片間隔
        mimeType: 'audio/webm;codecs=opus'
      })

      console.log(`🎤 [useRecording] 音訊配置: ${getAudioConfigInfo()}`)

      audioRecorderRef.current = audioRecorder
      chunksRef.current = []
      retryCountsRef.current.clear()

      // 設定音檔錄製器事件
      audioRecorder.onChunk(handleAudioChunk)
      audioRecorder.onError((err) => {
        console.error('❌ AudioRecorder 錯誤:', err)
        setError(err.message)
      })

      // 步驟 2: 初始化音訊權限
      console.log('🎤 [useRecording] 步驟 2: 初始化音訊權限')
      await audioRecorder.initialize()

      // 步驟 3: 建立 WebSocket 連線（並行建立，確保都就緒）
      console.log('🎤 [useRecording] 步驟 3: 建立 WebSocket 連線')

      // 3a. 建立音檔上傳 WebSocket
      console.log('🔌 [useRecording] 建立音檔上傳 WebSocket')
      const uploadWs = new AudioUploadWebSocket(sessionId)
      await uploadWs.connect()

      // 設定音檔上傳 WebSocket 事件處理
      uploadWs.onAckMissing(handleAckMissing)
      audioUploadWsRef.current = uploadWs

      // 3b. 建立逐字稿接收 WebSocket（透過 TranscriptManager）
      console.log('🔌 [useRecording] 建立逐字稿接收 WebSocket')
      await transcriptManager.connect(sessionId)
      transcriptManager.addListener(sessionId, handleTranscript)

      // 步驟 4: 驗證連線狀態
      console.log('🎤 [useRecording] 步驟 4: 驗證連線狀態')
      if (!uploadWs.isConnected) {
        throw new Error('音檔上傳 WebSocket 連線失敗')
      }

      if (!transcriptManager.isConnected(sessionId)) {
        throw new Error('逐字稿接收 WebSocket 連線失敗')
      }

      console.log('✅ [useRecording] 所有 WebSocket 連線已建立')

      // 步驟 5: 啟動心跳機制
      console.log('🎤 [useRecording] 步驟 5: 啟動心跳機制')
      startHeartbeat(uploadWs)

      // 步驟 6: 開始錄音
      console.log('🎤 [useRecording] 步驟 6: 開始錄音')

      // 先設置錄音狀態，確保狀態映射正確
      setIsRecording(true)
      console.log('🎤 [useRecording] 錄音狀態已設置為 true')

      await audioRecorder.startRecording()
      startTimer()

      console.log('✅ [useRecording] 錄音開始成功，Session ID:', sessionId)

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '開始錄音失敗'
      setError(errorMessage)
      console.error('❌ [useRecording] 開始錄音失敗:', err)

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
  }, [handleAudioChunk, handleAckMissing, handleTranscript, startTimer, startHeartbeat])

  // 停止錄音
  const stopRecording = useCallback(() => {
    try {
      // 停止音檔錄製器
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopRecording()
      }

      // 關閉音檔上傳 WebSocket
      if (audioUploadWsRef.current) {
        audioUploadWsRef.current.disconnect()
        audioUploadWsRef.current = null
      }

      setIsRecording(false)
      clearTimer()
      clearHeartbeat()

      console.log('✅ 錄音停止，等待轉錄完成')

      // 注意：不斷開 TranscriptManager 連接，繼續接收轉錄結果

    } catch (err) {
      console.error('❌ 停止錄音失敗:', err)
      setError('停止錄音時發生錯誤')
    }
  }, [clearTimer, clearHeartbeat])

  // 清空逐字稿
  const clearTranscripts = useCallback(() => {
    setTranscripts([])
    setTranscriptCompleted(false)
    console.log('🔄 逐字稿已清除')
  }, [])

  // 清理資源
  useEffect(() => {
    return () => {
      // 移除 TranscriptManager 監聽器
      if (currentSessionIdRef.current) {
        transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
      }

      // 清理計時器
      clearTimer()
      clearHeartbeat()

      // 關閉音檔上傳 WebSocket
      if (audioUploadWsRef.current) {
        audioUploadWsRef.current.disconnect()
      }

      // 停止錄音器
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stopRecording()
      }
    }
  }, [clearTimer, clearHeartbeat, handleTranscript])

  return {
    isRecording,
    recordingTime,
    transcripts,
    transcriptCompleted,
    error,
    startRecording,
    stopRecording,
    clearTranscripts,
  }
}
