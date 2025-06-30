"use client"

/**
 * SimpleAudioRecorder - 簡化音訊錄製器
 *
 * Phase 2 重構：移除複雜的 SegmentedAudioRecorder 邏輯
 * 改用標準 MediaRecorder + timeslice=10000 模式
 *
 * 特點：
 * - 使用 MediaRecorder.start(10000) 自動切片
 * - 每個段落包含完整 WebM Header
 * - 簡化錯誤處理
 * - 移除遞歸啟動/停止複雜性
 */

export interface AudioSegment {
    blob: Blob
    timestamp: number
    duration: number
    sequence: number
}

export interface SimpleAudioRecorderConfig {
    segmentDuration: number // 段落時長（毫秒）
    mimeType: string
    audioBitsPerSecond: number
}

const DEFAULT_CONFIG: SimpleAudioRecorderConfig = {
    segmentDuration: 10000, // 10 秒切片
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128000, // 128 kbps for 10s chunks
}

export class SimpleAudioRecorder {
    private stream: MediaStream | null = null
    private mediaRecorder: MediaRecorder | null = null
    private config: SimpleAudioRecorderConfig
    private sequence: number = 0
    private isRecording: boolean = false

    // 事件回調
    private onSegmentCallback?: (segment: AudioSegment) => void
    private onErrorCallback?: (error: Error) => void

    constructor(config: Partial<SimpleAudioRecorderConfig> = {}) {
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
            console.log('🎤 [SimpleAudioRecorder] 音訊權限獲取成功')
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '獲取音訊權限失敗'
            this.handleError(new Error(errorMsg))
            throw error
        }
    }

    /**
     * 開始錄音 - 使用標準 MediaRecorder + timeslice
     */
    async start(onSegmentAvailable: (segment: AudioSegment) => void): Promise<void> {
        if (this.isRecording) {
            throw new Error('錄製已在進行中')
        }

        if (!this.stream) {
            await this.initialize()
        }

        this.onSegmentCallback = onSegmentAvailable
        this.sequence = 0
        this.isRecording = true

        console.log('🎬 [SimpleAudioRecorder] 開始錄音', {
            segmentDuration: this.config.segmentDuration,
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond
        })

        // 建立 MediaRecorder 實例
        this.mediaRecorder = new MediaRecorder(this.stream!, {
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond,
        })

        // 設定資料接收處理
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && this.isRecording) {
                console.log(`📦 [SimpleAudioRecorder] 段落 #${this.sequence} 完成`, {
                    size: event.data.size,
                    mimeType: this.config.mimeType,
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
        this.mediaRecorder.onerror = (event) => {
            console.error('❌ [SimpleAudioRecorder] MediaRecorder 錯誤:', event)
            this.handleError(new Error(`MediaRecorder 錯誤: ${event}`))
        }

        // 開始錄製，使用 timeslice 自動切片
        this.mediaRecorder.start(this.config.segmentDuration)
        console.log('✅ [SimpleAudioRecorder] MediaRecorder 已啟動，自動 10 秒切片')
    }

    /**
     * 停止錄音
     */
    stop(): void {
        console.log('⏹️ [SimpleAudioRecorder] 停止錄音')

        this.isRecording = false

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop()
        }
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

        this.mediaRecorder = null
        this.sequence = 0
        console.log('🧹 [SimpleAudioRecorder] 已清理')
    }

    /**
     * 檢查是否正在錄音
     */
    get recording(): boolean {
        return this.isRecording
    }

    /**
     * 獲取當前序號
     */
    get currentSequence(): number {
        return this.sequence
    }

    /**
     * 獲取當前配置
     */
    get currentConfig(): SimpleAudioRecorderConfig {
        return { ...this.config }
    }

    // 錯誤處理
    private handleError(error: Error): void {
        console.error('❌ [SimpleAudioRecorder] 錯誤:', error)
        this.isRecording = false
        this.onErrorCallback?.(error)
    }

    // 事件回調設定
    onSegment(callback: (segment: AudioSegment) => void): void {
        this.onSegmentCallback = callback
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback
    }
}

// 工廠函數
export const createSimpleAudioRecorder = (config?: Partial<SimpleAudioRecorderConfig>): SimpleAudioRecorder => {
    return new SimpleAudioRecorder(config)
}

/**
 * 檢查瀏覽器音訊錄製支援
 */
export async function checkSimpleAudioRecordingSupport(): Promise<{ isSupported: boolean; error?: string }> {
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
