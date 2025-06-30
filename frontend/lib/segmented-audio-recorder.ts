"use client"

import { getAudioChunkIntervalMs } from './config'

// 音訊錄製狀態
export type SegmentedAudioRecorderState = 'idle' | 'recording' | 'paused' | 'error'

// 音訊錄製配置
export interface SegmentedAudioRecorderConfig {
    segmentDuration: number // 每個段落時長（毫秒）
    mimeType: string // 音訊格式
    audioBitsPerSecond?: number // 音訊位元率
}

// 音訊段落資料
export interface AudioSegment {
    blob: Blob
    timestamp: number
    duration: number
    sequence: number
}

// 預設配置
const DEFAULT_CONFIG: SegmentedAudioRecorderConfig = {
    segmentDuration: 10000, // 10 秒切片（統一配置）
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 64000, // 64 kbps for 10s chunks（降低位元率）
}

/**
 * SegmentedAudioRecorder - 分段式音訊錄製器
 *
 * 核心特點：
 * - 使用遞迴啟動/停止 MediaRecorder 模式
 * - 每個 segment 包含完整 WebM Header
 * - 支援可配置的切片時長（預設 5 秒）
 * - 解決 Azure OpenAI Whisper API 檔頭問題
 */
export class SegmentedAudioRecorder {
    private stream: MediaStream | null = null
    private config: SegmentedAudioRecorderConfig
    private state: SegmentedAudioRecorderState = 'idle'
    private sequence: number = 0
    private recording = false
    private segmentTimeout: NodeJS.Timeout | null = null

    // 事件回調
    private onSegmentCallback?: (segment: AudioSegment) => void
    private onStateChangeCallback?: (state: SegmentedAudioRecorderState) => void
    private onErrorCallback?: (error: Error) => void

    constructor(config: Partial<SegmentedAudioRecorderConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config }
    }

    /**
     * 初始化錄音器 - 獲取音訊權限
     */
    async initialize(): Promise<void> {
        if (this.stream) {
            return // 已初始化
        }

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            console.log('🎤 [SegmentedAudioRecorder] 音訊權限獲取成功')
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '獲取音訊權限失敗'
            this.handleError(new Error(errorMsg))
            throw error
        }
    }

    /**
     * 開始錄音 - 啟動遞迴分段錄音
     */
    async start(onSegmentAvailable: (segment: AudioSegment) => void): Promise<void> {
        if (this.recording) {
            throw new Error('錄製已在進行中')
        }

        if (!this.stream) {
            await this.initialize()
        }

        this.onSegmentCallback = onSegmentAvailable
        this.recording = true
        this.sequence = 0

        console.log('🎬 [SegmentedAudioRecorder] 開始分段錄音', {
            segmentDuration: this.config.segmentDuration,
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond
        })

        this.setState('recording')
        this.startSegment()
    }

    /**
     * 核心遞迴函式 - 啟動單個錄音段落
     */
    private startSegment(): void {
        if (!this.recording || !this.stream) {
            return
        }

        console.log(`🎵 [SegmentedAudioRecorder] 開始錄音段落 #${this.sequence}`)

        // 建立新的 MediaRecorder 實例
        const mediaRecorder = new MediaRecorder(this.stream, {
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond,
        })

        // 設定資料接收處理
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.log(`📦 [SegmentedAudioRecorder] 段落 #${this.sequence} 完成`, {
                    size: event.data.size,
                    mimeType: this.config.mimeType,
                    containsCompleteHeader: true // 每個段落都有完整檔頭
                })

                const segment: AudioSegment = {
                    blob: event.data,
                    timestamp: Date.now(),
                    duration: this.config.segmentDuration,
                    sequence: this.sequence++,
                }

                // 回調通知有新段落可用
                this.onSegmentCallback?.(segment)
            }
        }

        // 錯誤處理
        mediaRecorder.onerror = (event) => {
            console.error(`❌ [SegmentedAudioRecorder] 段落 #${this.sequence} 錯誤:`, event)
            this.handleError(new Error(`MediaRecorder 錯誤: ${event}`))
        }

        // 開始錄製此段落
        mediaRecorder.start()

        // 設定計時器，在指定時間後結束此段落並開始下一段
        this.segmentTimeout = setTimeout(() => {
            if (mediaRecorder.state === 'recording') {
                // 請求數據並停止 MediaRecorder
                mediaRecorder.requestData() // 觸發 ondataavailable
                mediaRecorder.stop()        // 結束此段

                // 如果仍在錄音狀態，遞迴開始下一段
                if (this.recording) {
                    // 短暫延遲確保前一段完全結束
                    setTimeout(() => {
                        this.startSegment()
                    }, 50)
                }
            }
        }, this.config.segmentDuration)
    }

    /**
     * 停止錄音
     */
    stop(): void {
        console.log('⏹️ [SegmentedAudioRecorder] 停止錄音')

        this.recording = false

        // 清除計時器
        if (this.segmentTimeout) {
            clearTimeout(this.segmentTimeout)
            this.segmentTimeout = null
        }

        this.setState('idle')
    }

    /**
     * 清理資源
     */
    cleanup(): void {
        this.stop()

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop())
            this.stream = null
        }

        this.sequence = 0
        console.log('🧹 SegmentedAudioRecorder 已清理')
    }

    /**
     * 檢查是否正在錄音
     */
    get isRecording(): boolean {
        return this.recording
    }

    /**
     * 獲取當前序號
     */
    get currentSequence(): number {
        return this.sequence
    }

    /**
     * 獲取當前狀態
     */
    get currentState(): SegmentedAudioRecorderState {
        return this.state
    }

    /**
     * 獲取當前配置
     */
    get currentConfig(): SegmentedAudioRecorderConfig {
        return { ...this.config }
    }

    // 設定狀態
    private setState(newState: SegmentedAudioRecorderState): void {
        this.state = newState
        this.onStateChangeCallback?.(newState)
    }

    // 錯誤處理
    private handleError(error: Error): void {
        console.error('❌ SegmentedAudioRecorder 錯誤:', error)
        this.setState('error')
        this.recording = false
        this.onErrorCallback?.(error)
    }

    // 事件回調設定
    onSegment(callback: (segment: AudioSegment) => void): void {
        this.onSegmentCallback = callback
    }

    onStateChange(callback: (state: SegmentedAudioRecorderState) => void): void {
        this.onStateChangeCallback = callback
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback
    }
}

// 工廠函數
export const createSegmentedAudioRecorder = (config?: Partial<SegmentedAudioRecorderConfig>): SegmentedAudioRecorder => {
    return new SegmentedAudioRecorder(config)
}

/**
 * 檢查瀏覽器分段式音訊錄製支援
 */
export async function checkSegmentedAudioRecordingSupport(): Promise<{ isSupported: boolean; error?: string }> {
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
