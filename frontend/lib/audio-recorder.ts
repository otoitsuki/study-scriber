"use client"

import { getAudioChunkIntervalMs } from './config'

// 音訊錄製狀態
export type AudioRecorderState = 'idle' | 'recording' | 'paused' | 'error'

// 音訊錄製配置
export interface AudioRecorderConfig {
  chunkInterval: number // 切片間隔（毫秒）
  mimeType: string // 音訊格式
  audioBitsPerSecond?: number // 音訊位元率
}

// 音訊切片資料
export interface AudioChunk {
  blob: Blob
  timestamp: number
  duration: number
  sequence: number
}

// 預設配置
const DEFAULT_CONFIG: AudioRecorderConfig = {
  chunkInterval: 12000, // 12 秒
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 64000, // 64 kbps
}

// 支援的音訊格式列表（優先順序）
// MP4 格式在 FFmpeg 7.1.1 中有更好的兼容性，因此放在第一位
const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus', // 第一優先：WebM Opus 編解碼器，音質優秀且串流友好
  'audio/webm',             // 第二優先：WebM 通用格式
  'audio/mp4',              // 第三優先：MP4 作為備選方案
  'audio/ogg;codecs=opus',
  'audio/wav',
]

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private config: AudioRecorderConfig
  private state: AudioRecorderState = 'idle'
  private chunkSequence: number = 0 // 切片序號計數器

  // 事件回調
  private onChunkCallback?: (chunk: AudioChunk) => void
  private onStateChangeCallback?: (state: AudioRecorderState) => void
  private onErrorCallback?: (error: Error) => void

  constructor(config: Partial<AudioRecorderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 開始錄製
   */
  async start(onDataAvailable: (chunk: AudioChunk) => void): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      throw new Error('錄製已在進行中')
    }

    // 獲取麥克風權限
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

    // 創建 MediaRecorder
    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.config.mimeType,
      audioBitsPerSecond: this.config.audioBitsPerSecond,
    })

    // 重置序號計數器
    this.chunkSequence = 0

    // 監聽資料可用事件
    this.mediaRecorder.ondataavailable = (event) => {
      console.log('🎙️ [AudioRecorder] MediaRecorder.ondataavailable 觸發', {
        dataSize: event.data.size,
        sequence: this.chunkSequence,
        timestamp: new Date().toISOString()
      })

      if (event.data.size > 0) {
        const chunk: AudioChunk = {
          blob: event.data,
          timestamp: Date.now(),
          duration: this.config.chunkInterval,
          sequence: this.chunkSequence++, // 分配序號並遞增
        }

        console.log('📦 [AudioRecorder] 建立音頻切片', {
          sequence: chunk.sequence,
          size: chunk.blob.size,
          duration: chunk.duration,
          mimeType: this.config.mimeType
        })

        onDataAvailable(chunk)
      } else {
        console.warn('⚠️ [AudioRecorder] ondataavailable 但 data.size = 0')
      }
    }

    // 開始錄製，每隔指定時間產生一個切片
    console.log('🎬 [AudioRecorder] 開始錄製', {
      chunkInterval: this.config.chunkInterval,
      mimeType: this.config.mimeType,
      state: this.mediaRecorder.state
    })

    this.mediaRecorder.start(this.config.chunkInterval)

    console.log('✅ [AudioRecorder] MediaRecorder.start() 已調用', {
      state: this.mediaRecorder.state,
      stream: this.stream ? 'active' : 'null'
    })
  }

  /**
   * 停止錄製
   */
  stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop()
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }

    this.mediaRecorder = null
    this.chunkSequence = 0 // 重置序號
  }

  /**
   * 獲取錄製狀態
   */
  get isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording'
  }

  /**
   * 獲取當前序號
   */
  get currentSequence(): number {
    return this.chunkSequence
  }

  // 清理資源
  cleanup(): void {
    this.stop()

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }

    this.mediaRecorder = null
    console.log('🧹 音訊錄製器已清理')
  }

  // 設定狀態
  private setState(newState: AudioRecorderState): void {
    this.state = newState
    this.onStateChangeCallback?.(newState)
  }

  // 錯誤處理
  private handleError(error: Error): void {
    console.error('❌ AudioRecorder 錯誤:', error)
    this.setState('error')
    this.onErrorCallback?.(error)
  }

  // 事件回調設定
  onChunk(callback: (chunk: AudioChunk) => void): void {
    this.onChunkCallback = callback
  }

  onStateChange(callback: (state: AudioRecorderState) => void): void {
    this.onStateChangeCallback = callback
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback
  }

  // Getter
  get currentState(): AudioRecorderState {
    return this.state
  }

  get currentConfig(): AudioRecorderConfig {
    return { ...this.config }
  }
}

// 工廠函數
export const createAudioRecorder = (config?: Partial<AudioRecorderConfig>): AudioRecorder => {
  return new AudioRecorder(config)
}

/**
 * 檢查瀏覽器音訊錄製支援
 */
export async function checkAudioRecordingSupport(): Promise<{ isSupported: boolean; error?: string }> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { isSupported: false, error: '瀏覽器不支援 MediaDevices API' }
  }

  if (!window.MediaRecorder) {
    return { isSupported: false, error: '瀏覽器不支援 MediaRecorder API' }
  }

  // 檢查 MIME 類型支援
  if (!MediaRecorder.isTypeSupported(DEFAULT_CONFIG.mimeType)) {
    return { isSupported: false, error: `不支援音訊格式: ${DEFAULT_CONFIG.mimeType}` }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // 立即停止串流以釋放資源
    stream.getTracks().forEach(track => track.stop())
    return { isSupported: true }
  } catch (error) {
    return { isSupported: false, error: `無法獲取麥克風權限: ${error}` }
  }
}
