"use client"

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
  chunkInterval: 12000, // 12 秒切片（與後端同步）
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 128000, // 128 kbps
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
  private mediaStream: MediaStream | null = null
  private config: AudioRecorderConfig
  private state: AudioRecorderState = 'idle'
  private sequence = 0
  private startTime = 0

  // 事件回調
  private onChunkCallback?: (chunk: AudioChunk) => void
  private onStateChangeCallback?: (state: AudioRecorderState) => void
  private onErrorCallback?: (error: Error) => void

  constructor(config: Partial<AudioRecorderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    // 檢查瀏覽器相容性
    if (!this.isSupported()) {
      throw new Error('您的瀏覽器不支援音訊錄製功能')
    }

    // 選擇支援的音訊格式
    this.config.mimeType = this.getSupportedMimeType()
  }

  // 檢查瀏覽器支援度
  isSupported(): boolean {
    return (
      'mediaDevices' in navigator &&
      'getUserMedia' in navigator.mediaDevices &&
      'MediaRecorder' in window
    )
  }

  // 獲取支援的音訊格式
  private getSupportedMimeType(): string {
    for (const mimeType of SUPPORTED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        console.log('🎤 使用音訊格式:', mimeType)
        return mimeType
      }
    }

    // 如果都不支援，使用預設格式
    console.warn('⚠️ 使用預設音訊格式:', DEFAULT_CONFIG.mimeType)
    return DEFAULT_CONFIG.mimeType
  }

  // 初始化音訊串流
  async initialize(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000, // 16kHz 適合語音辨識
        }
      })

      console.log('🎤 音訊權限已獲取')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '無法取得音訊權限'
      this.handleError(new Error(`音訊初始化失敗: ${errorMessage}`))
      throw error
    }
  }

  // 開始錄音
  async startRecording(): Promise<void> {
    if (this.state === 'recording') {
      return
    }

    if (!this.mediaStream) {
      await this.initialize()
    }

    if (!this.mediaStream) {
      throw new Error('音訊串流未初始化')
    }

    try {
      // 建立 MediaRecorder
      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: this.config.mimeType,
        audioBitsPerSecond: this.config.audioBitsPerSecond,
      })

      // 設定事件處理器
      this.setupMediaRecorderEvents()

      // 開始錄音，使用 MediaRecorder 的自動切片功能
      // 這比手動 requestData() 更可靠且簡潔
      this.mediaRecorder.start(this.config.chunkInterval)
      this.startTime = Date.now()
      this.sequence = 0

      this.setState('recording')
      console.log('🎤 開始錄音')

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '錄音啟動失敗'
      this.handleError(new Error(`錄音啟動失敗: ${errorMessage}`))
      throw error
    }
  }

  // 停止錄音
  stopRecording(): void {
    if (this.state !== 'recording') {
      return
    }

    if (this.mediaRecorder) {
      this.mediaRecorder.stop()
    }

    this.setState('idle')
    console.log('🛑 停止錄音')
  }

  // 暫停錄音
  pauseRecording(): void {
    if (this.state !== 'recording' || !this.mediaRecorder) {
      return
    }

    this.mediaRecorder.pause()
    this.setState('paused')
    console.log('⏸️ 暫停錄音')
  }

  // 恢復錄音
  resumeRecording(): void {
    if (this.state !== 'paused' || !this.mediaRecorder) {
      return
    }

    this.mediaRecorder.resume()
    this.setState('recording')
    console.log('▶️ 恢復錄音')
  }

  // 清理資源
  cleanup(): void {
    this.stopRecording()

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }

    this.mediaRecorder = null
    console.log('🧹 音訊錄製器已清理')
  }

  // 注意：已移除 WebM 格式驗證，信任 MediaRecorder 和後端 FFmpeg 處理

  // 設定 MediaRecorder 事件處理器
  private setupMediaRecorderEvents(): void {
    if (!this.mediaRecorder) return

    this.mediaRecorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        // 基本大小檢查 - 降低門檻值以接受更多有效切片
        if (event.data.size < 50) {
          console.warn(`⚠️ 音訊切片 #${this.sequence} 太小，跳過: ${event.data.size} bytes`)
          return
        }

        // 信任 MediaRecorder 產生的資料，不做格式驗證
        // 後端 FFmpeg 會用 -fflags +genpts 處理不完整的流式資料

        const chunk: AudioChunk = {
          blob: event.data,
          timestamp: Date.now(),
          duration: Date.now() - this.startTime,
          sequence: this.sequence++,
        }

        console.log(`🎵 產生有效音訊切片 #${chunk.sequence}, 大小: ${chunk.blob.size} bytes, 類型: ${chunk.blob.type}`)

        this.onChunkCallback?.(chunk)
      } else {
        console.warn(`⚠️ 收到空的音訊切片 #${this.sequence}`)
      }
    }

    this.mediaRecorder.onerror = (event) => {
      const error = event.error || new Error('MediaRecorder 錯誤')
      this.handleError(error)
    }

    this.mediaRecorder.onstart = () => {
      console.log('🎤 MediaRecorder 已啟動')
    }

    this.mediaRecorder.onstop = () => {
      console.log('🛑 MediaRecorder 已停止')
    }
  }

  // 注意：不再需要手動定時器，MediaRecorder.start(interval) 會自動處理切片

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

  get isRecording(): boolean {
    return this.state === 'recording'
  }

  get isPaused(): boolean {
    return this.state === 'paused'
  }

  get currentConfig(): AudioRecorderConfig {
    return { ...this.config }
  }
}

// 工廠函數
export const createAudioRecorder = (config?: Partial<AudioRecorderConfig>): AudioRecorder => {
  return new AudioRecorder(config)
}

// 瀏覽器相容性檢查函數
export const checkAudioRecordingSupport = (): {
  supported: boolean
  errors: string[]
} => {
  const errors: string[] = []

  if (!('mediaDevices' in navigator)) {
    errors.push('不支援 MediaDevices API')
  }

  if (!('getUserMedia' in navigator.mediaDevices)) {
    errors.push('不支援 getUserMedia API')
  }

  if (!('MediaRecorder' in window)) {
    errors.push('不支援 MediaRecorder API')
  }

  // 檢查 HTTPS
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    errors.push('需要 HTTPS 連接才能使用音訊功能')
  }

  return {
    supported: errors.length === 0,
    errors
  }
}
