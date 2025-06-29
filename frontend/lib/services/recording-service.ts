"use client"

import { BaseService } from './base-service'
import { IRecordingService, RecordingState } from './interfaces'
import { AudioRecorder, AudioChunk, checkAudioRecordingSupport } from '../audio-recorder'
import { AudioUploadWebSocket, AckMissingMessage } from '../websocket'
import { getAudioChunkIntervalMs, getAudioConfigInfo } from '../config'

/**
 * RecordingService - 錄音管理服務
 *
 * 整合現有的錄音相關邏輯，提供：
 * - 音頻錄製管理（重用 AudioRecorder）
 * - WebSocket 音頻上傳（重用 AudioUploadWebSocket）
 * - 錄音狀態管理
 * - 錯誤處理和重試機制
 * - 心跳監測
 */
export class RecordingService extends BaseService implements IRecordingService {
  protected readonly serviceName = 'RecordingService'

  // 錄音器和 WebSocket 引用
  private audioRecorder: AudioRecorder | null = null
  private audioUploadWs: AudioUploadWebSocket | null = null

  // 錄音狀態
  private recordingState: RecordingState = {
    isRecording: false,
    recordingTime: 0,
    currentSessionId: null,
    error: null
  }

  // 計時器和重試機制
  private recordingTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private audioChunks: AudioChunk[] = []
  private retryCounts = new Map<number, number>()

  /**
   * 服務初始化
   * 檢查音頻錄製支援度
   */
  async initialize(): Promise<void> {
    this.logInfo('服務初始化開始')

    // 檢查瀏覽器支援度
    const supportCheck = await checkAudioRecordingSupport()
    if (!supportCheck.isSupported) {
      const errorMessage = `音頻錄製不支援: ${supportCheck.error || '未知錯誤'}`
      this.logWarning('瀏覽器支援度檢查失敗', supportCheck.error)
      throw new Error(errorMessage)
    }

    this.logSuccess('瀏覽器支援度檢查通過')
    this.logSuccess('初始化完成')
  }

  /**
   * 服務清理
   */
  async cleanup(): Promise<void> {
    this.logInfo('服務清理開始')

    // 如果正在錄音，先停止
    if (this.recordingState.isRecording) {
      await this.stopRecording()
    }

    // 清理音頻錄製器
    if (this.audioRecorder) {
      this.audioRecorder.cleanup()
      this.audioRecorder = null
    }

    // 清理計時器
    this.clearTimers()

    // 重置狀態
    this.resetRecordingState()

    this.logSuccess('清理完成')
  }

  /**
   * 開始錄音
   * 重用現有的音頻錄製和 WebSocket 上傳邏輯
   */
  async startRecording(sessionId: string): Promise<void> {
    this.logInfo('開始錄音', { sessionId })

    try {
      // 檢查是否已在錄音
      if (this.recordingState.isRecording) {
        this.logWarning('已在錄音中，跳過重複啟動')
        return
      }

      // 重置狀態
      this.resetRecordingState()
      this.recordingState.currentSessionId = sessionId

      // 步驟 1: 初始化音頻錄製器
      this.logInfo('步驟 1: 初始化音頻錄製器')
      const chunkInterval = getAudioChunkIntervalMs()

      console.log('🎯 [RecordingService] 音頻配置', {
        chunkInterval: `${chunkInterval}ms (${chunkInterval / 1000}秒)`,
        mimeType: 'audio/webm;codecs=opus',
        configInfo: getAudioConfigInfo()
      })

      this.audioRecorder = new AudioRecorder({
        chunkInterval, // 使用環境變數配置的切片間隔
        mimeType: 'audio/webm;codecs=opus'
      })

      this.logInfo(`音訊配置: ${getAudioConfigInfo()}`)

      // 設定音頻錄製器事件處理
      this.setupAudioRecorderEvents()

      // 步驟 2: 開始音頻錄製（包含獲取權限）
      this.logInfo('步驟 2: 開始音頻錄製（包含獲取權限）')

      // 步驟 3: 建立音頻上傳 WebSocket
      this.logInfo('步驟 3: 建立音頻上傳 WebSocket')
      this.audioUploadWs = new AudioUploadWebSocket(sessionId)

      // 設定 WebSocket 事件處理
      this.setupWebSocketEvents()

      // 連接 WebSocket
      await this.audioUploadWs.connect()

      // 驗證 WebSocket 連接
      if (!this.audioUploadWs.isConnected) {
        throw new Error('音頻上傳 WebSocket 連接失敗')
      }

      // 步驟 4: 啟動心跳機制
      this.logInfo('步驟 4: 啟動心跳機制')
      this.startHeartbeat()

      // 步驟 5: 開始錄音
      this.logInfo('步驟 5: 開始音頻錄製')
      await this.audioRecorder.start((chunk: AudioChunk) => {
        this.handleAudioChunk(chunk)
      })

      // 步驟 6: 啟動錄音計時器
      this.logInfo('步驟 6: 啟動錄音計時器')
      this.startRecordingTimer()

      // 更新錄音狀態
      this.recordingState.isRecording = true
      this.recordingState.error = null

      this.logSuccess('錄音啟動成功', {
        sessionId,
        chunkConfig: getAudioConfigInfo(),
        mimeType: 'audio/webm;codecs=opus'
      })

    } catch (error) {
      // 錯誤時清理資源
      await this.cleanupRecordingResources()
      this.recordingState.error = error instanceof Error ? error.message : '開始錄音失敗'
      this.handleError('開始錄音', error)
    }
  }

  /**
   * 停止錄音
   * 保持 WebSocket 連接以接收剩餘的處理結果
   */
  async stopRecording(): Promise<void> {
    this.logInfo('停止錄音')

    try {
      // 更新狀態
      this.recordingState.isRecording = false

      // 停止音頻錄製器
      if (this.audioRecorder) {
        this.audioRecorder.stop()
        this.logInfo('音頻錄製器已停止')
      }

      // 停止計時器
      this.clearTimers()

      // 清理音頻錄製器（保留 WebSocket 連接）
      if (this.audioRecorder) {
        this.audioRecorder.cleanup()
        this.audioRecorder = null
      }

      // 斷開音頻上傳 WebSocket
      if (this.audioUploadWs) {
        this.audioUploadWs.disconnect()
        this.audioUploadWs = null
      }

      this.logSuccess('錄音停止成功', {
        sessionId: this.recordingState.currentSessionId,
        recordingTime: this.recordingState.recordingTime
      })

    } catch (error) {
      this.recordingState.error = error instanceof Error ? error.message : '停止錄音失敗'
      this.handleError('停止錄音', error)
    }
  }

  /**
   * 取得當前錄音狀態
   */
  getRecordingState(): RecordingState {
    return { ...this.recordingState }
  }

  /**
   * 檢查是否正在錄音
   */
  isRecording(): boolean {
    return this.recordingState.isRecording
  }

  /**
   * 取得錄音時間（秒）
   */
  getRecordingTime(): number {
    return this.recordingState.recordingTime
  }

  /**
 * 設定音頻錄製器事件處理
 */
  private setupAudioRecorderEvents(): void {
    if (!this.audioRecorder) return

    // 處理錄製錯誤
    this.audioRecorder.onError((error: Error) => {
      this.logWarning('音頻錄製器錯誤', error.message)
      this.recordingState.error = error.message
    })

    // 處理狀態變化
    this.audioRecorder.onStateChange((state) => {
      this.logInfo('音頻錄製器狀態變化', state)
    })
  }

  /**
   * 設定 WebSocket 事件處理
   */
  private setupWebSocketEvents(): void {
    if (!this.audioUploadWs) return

    // 處理 ACK/Missing 訊息
    this.audioUploadWs.onAckMissing((data: AckMissingMessage) => {
      this.handleAckMissing(data)
    })

    // 處理 WebSocket 關閉
    this.audioUploadWs.onClose((event) => {
      this.logWarning('音頻上傳 WebSocket 連接關閉', {
        code: event.code,
        reason: event.reason
      })
    })
  }

  /**
   * 處理音頻切片
   * 儲存切片並上傳
   */
  private handleAudioChunk(chunk: AudioChunk): void {
    console.log('🎤 [RecordingService] 收到音頻切片', {
      sequence: chunk.sequence,
      size: chunk.blob.size,
      duration: chunk.duration,
      timestamp: new Date().toISOString()
    })

    this.logInfo('收到音頻切片', {
      sequence: chunk.sequence,
      size: chunk.blob.size,
      duration: chunk.duration
    })

    // 儲存切片供重傳使用
    this.audioChunks[chunk.sequence] = chunk

    // 如果 WebSocket 已連接，立即上傳
    if (this.audioUploadWs?.isConnected) {
      console.log('📤 [RecordingService] 準備上傳音頻切片', {
        sequence: chunk.sequence,
        wsState: this.audioUploadWs.readyState,
        wsUrl: `/ws/upload_audio/${this.recordingState.currentSessionId}`
      })

      this.audioUploadWs.uploadAudioChunk(chunk.blob)

      console.log('✅ [RecordingService] 音頻切片已送出', {
        sequence: chunk.sequence,
        size: chunk.blob.size,
        time: new Date().toISOString()
      })

      this.logInfo('音頻切片已上傳', { sequence: chunk.sequence })
    } else {
      console.error('❌ [RecordingService] WebSocket 未連接，無法上傳音頻切片', {
        sequence: chunk.sequence,
        wsState: this.audioUploadWs?.readyState || 'null',
        isConnected: this.audioUploadWs?.isConnected || false
      })

      this.logWarning('WebSocket 未連接，無法上傳音頻切片', { sequence: chunk.sequence })
    }
  }

  /**
   * 處理 ACK/Missing 訊息
   * 實現音頻切片重傳機制
   */
  private handleAckMissing(data: AckMissingMessage): void {
    this.logInfo('收到 ACK/Missing 訊息', {
      ack: data.ack,
      missing: data.missing
    })

    if (data.missing.length > 0) {
      this.logWarning('檢測到遺失的音頻切片，準備重傳', data.missing)

      // 重傳遺失的切片
      data.missing.forEach(sequence => {
        const retryCount = this.retryCounts.get(sequence) ?? 0

        if (retryCount < 5) { // 最多重傳 5 次
          this.retryCounts.set(sequence, retryCount + 1)

          // 尋找對應的音頻切片進行重傳
          if (this.audioChunks[sequence]) {
            this.logInfo('重傳音頻切片', {
              sequence,
              retryCount: retryCount + 1,
              maxRetries: 5
            })
            this.audioUploadWs?.uploadAudioChunk(this.audioChunks[sequence].blob)
          } else {
            this.logWarning('找不到要重傳的音頻切片', { sequence })
          }
        } else {
          this.logWarning('音頻切片重傳次數已達上限', {
            sequence,
            maxRetries: 5
          })
        }
      })
    }
  }

  /**
   * 啟動錄音計時器
   */
  private startRecordingTimer(): void {
    this.clearRecordingTimer()
    this.recordingState.recordingTime = 0

    this.recordingTimer = setInterval(() => {
      this.recordingState.recordingTime += 1

      // 每 30 秒記錄一次錄音時間
      if (this.recordingState.recordingTime % 30 === 0) {
        this.logInfo('錄音進行中', {
          recordingTime: this.recordingState.recordingTime,
          minutes: Math.floor(this.recordingState.recordingTime / 60)
        })
      }
    }, 1000)
  }

  /**
   * 啟動心跳機制
   */
  private startHeartbeat(): void {
    this.clearHeartbeatTimer()

    this.heartbeatTimer = setInterval(() => {
      if (this.audioUploadWs?.isConnected) {
        this.audioUploadWs.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now()
        }))
        this.logInfo('發送心跳訊號')
      }
    }, 30000) // 每 30 秒發送一次心跳
  }

  /**
   * 清理所有計時器
   */
  private clearTimers(): void {
    this.clearRecordingTimer()
    this.clearHeartbeatTimer()
  }

  /**
   * 清理錄音計時器
   */
  private clearRecordingTimer(): void {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
      this.recordingTimer = null
    }
  }

  /**
   * 清理心跳計時器
   */
  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 重置錄音狀態
   */
  private resetRecordingState(): void {
    this.recordingState = {
      isRecording: false,
      recordingTime: 0,
      currentSessionId: null,
      error: null
    }
    this.audioChunks = []
    this.retryCounts.clear()
  }

  /**
   * 清理錄音相關資源
   * 錯誤處理時使用
   */
  private async cleanupRecordingResources(): Promise<void> {
    try {
      // 停止音頻錄製器
      if (this.audioRecorder) {
        this.audioRecorder.stop()
        this.audioRecorder.cleanup()
        this.audioRecorder = null
      }

      // 關閉 WebSocket 連接
      if (this.audioUploadWs) {
        this.audioUploadWs.disconnect()
        this.audioUploadWs = null
      }

      // 清理計時器
      this.clearTimers()

      // 重置狀態
      this.recordingState.isRecording = false

      this.logInfo('錄音資源清理完成')
    } catch (error) {
      this.logWarning('清理錄音資源時發生錯誤', error)
    }
  }

  /**
 * 獲取服務詳細狀態
 * 擴展基礎狀態，包含錄音特定信息
 */
  async getDetailedStatus(): Promise<RecordingServiceStatus> {
    const baseStatus = this.getStatus()
    const supportCheck = await checkAudioRecordingSupport()

    return {
      ...baseStatus,
      recordingState: this.getRecordingState(),
      audioSupport: {
        supported: supportCheck.isSupported,
        errors: supportCheck.error ? [supportCheck.error] : []
      },
      audioRecorderState: this.audioRecorder?.currentState ?? null,
      webSocketConnected: this.audioUploadWs?.isConnected ?? false,
      chunksCount: this.audioChunks.length,
      retryCount: Array.from(this.retryCounts.values()).reduce((sum, count) => sum + count, 0)
    }
  }
}

/**
 * RecordingService 詳細狀態介面
 */
export interface RecordingServiceStatus {
  serviceName: string
  isInitialized: boolean
  isRunning: boolean
  timestamp: string
  recordingState: RecordingState
  audioSupport: {
    supported: boolean
    errors: string[]
  }
  audioRecorderState: string | null
  webSocketConnected: boolean
  chunksCount: number
  retryCount: number
}
