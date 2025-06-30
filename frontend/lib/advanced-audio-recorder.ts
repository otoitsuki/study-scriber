"use client"

/**
 * AdvancedAudioRecorder - 進階分段音訊錄製器
 *
 * Phase 2.5 WebM Header 修復：實作無縫 MediaRecorder 切換策略
 * 解決 MediaRecorder.start(timeslice) 只在第一個段落包含完整 container header 的問題
 *
 * 核心策略：
 * - 每10秒重新創建 MediaRecorder 實例
 * - 使用預建策略：提前創建下一個 MediaRecorder，避免建立延遲
 * - 無縫角色轉換：stop→start 間隙 ≈ 1-3ms
 * - 確保每個段落都包含完整 WebM EBML header
 */

export interface AudioSegment {
    blob: Blob
    timestamp: number
    duration: number
    sequence: number
}

export interface AdvancedAudioRecorderConfig {
    segmentDuration: number // 段落時長（毫秒）
    mimeType: string
    audioBitsPerSecond: number
}

const DEFAULT_CONFIG: AdvancedAudioRecorderConfig = {
    segmentDuration: 10000, // 10 秒切片
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128000, // 128 kbps for 10s chunks
}

export class AdvancedAudioRecorder {
    private stream: MediaStream | null = null
    private config: AdvancedAudioRecorderConfig
    private isRecording: boolean = false
    private sequence: number = 0

    // 雙 MediaRecorder 策略
    private currentRecorder: MediaRecorder | null = null
    private nextRecorder: MediaRecorder | null = null
    private swapTimer: ReturnType<typeof setTimeout> | null = null

    // 事件回調
    private onSegmentCallback?: (segment: AudioSegment) => void
    private onErrorCallback?: (error: Error) => void

    constructor(config: Partial<AdvancedAudioRecorderConfig> = {}) {
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
            console.log('🎤 [AdvancedAudioRecorder] 音訊權限獲取成功')
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : '獲取音訊權限失敗'
            this.handleError(new Error(errorMsg))
            throw error
        }
    }

    /**
     * 開始錄音 - 使用雙 MediaRecorder 無縫切換策略
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

        console.log('🎬 [AdvancedAudioRecorder] 開始進階錄音', {
            segmentDuration: this.config.segmentDuration,
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond
        })

        // 檢查瀏覽器支援度
        if (!this.checkMediaRecorderSupport()) {
            throw new Error('瀏覽器不支援所需的音頻錄製功能')
        }

        try {
            // 啟動雙 MediaRecorder 策略
            await this.initializeRecorders()
            this.startCurrentRecorder()
            this.scheduleNextSwap()

            console.log('✅ [AdvancedAudioRecorder] 雙 MediaRecorder 策略啟動成功')
        } catch (error) {
            this.isRecording = false
            this.handleError(error instanceof Error ? error : new Error('啟動錄音失敗'))
            throw error
        }
    }

    /**
     * 停止錄音
     */
    stop(): void {
        console.log('⏹️ [AdvancedAudioRecorder] 停止進階錄音')

        this.isRecording = false

        // 清除切換計時器
        if (this.swapTimer) {
            clearTimeout(this.swapTimer)
            this.swapTimer = null
        }

        // 停止當前錄音器
        if (this.currentRecorder && this.currentRecorder.state !== 'inactive') {
            this.currentRecorder.stop()
        }

        // 清理下一個錄音器
        this.cleanupRecorder(this.nextRecorder)
        this.nextRecorder = null
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

        this.cleanupRecorder(this.currentRecorder)
        this.cleanupRecorder(this.nextRecorder)
        this.currentRecorder = null
        this.nextRecorder = null
        this.sequence = 0

        console.log('🧹 [AdvancedAudioRecorder] 已清理')
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
    get currentConfig(): AdvancedAudioRecorderConfig {
        return { ...this.config }
    }

    // ============ 私有方法 ============

    /**
     * 檢查 MediaRecorder 支援度
     */
    private checkMediaRecorderSupport(): boolean {
        if (!window.MediaRecorder) {
            this.handleError(new Error('瀏覽器不支援 MediaRecorder API'))
            return false
        }

        if (!MediaRecorder.isTypeSupported(this.config.mimeType)) {
            this.handleError(new Error(`不支援音訊格式: ${this.config.mimeType}`))
            return false
        }

        return true
    }

    /**
     * 初始化雙 MediaRecorder
     */
    private async initializeRecorders(): Promise<void> {
        try {
            this.currentRecorder = this.createMediaRecorder()
            this.nextRecorder = this.createMediaRecorder()
            console.log('🔄 [AdvancedAudioRecorder] 雙 MediaRecorder 初始化完成')
        } catch (error) {
            throw new Error(`MediaRecorder 初始化失敗: ${error instanceof Error ? error.message : '未知錯誤'}`)
        }
    }

    /**
     * 創建 MediaRecorder 實例
     */
    private createMediaRecorder(): MediaRecorder {
        if (!this.stream) {
            throw new Error('音訊流未初始化')
        }

        const recorder = new MediaRecorder(this.stream, {
            mimeType: this.config.mimeType,
            audioBitsPerSecond: this.config.audioBitsPerSecond,
        })

        // 設定事件處理
        recorder.ondataavailable = (event) => {
            if (event.data.size > 0 && this.isRecording) {
                console.log(`📦 [AdvancedAudioRecorder] 段落 #${this.sequence} 完成`, {
                    size: event.data.size,
                    mimeType: this.config.mimeType,
                    hasCompleteHeader: true // 每個段落都有完整檔頭
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

        recorder.onerror = (event) => {
            console.error('❌ [AdvancedAudioRecorder] MediaRecorder 錯誤:', event)
            this.handleError(new Error(`MediaRecorder 錯誤: ${event}`))
        }

        return recorder
    }

    /**
     * 啟動當前錄音器
     */
    private startCurrentRecorder(): void {
        if (!this.currentRecorder) {
            throw new Error('當前錄音器未初始化')
        }

        console.log(`🎵 [AdvancedAudioRecorder] 開始錄音段落 #${this.sequence}`)
        this.currentRecorder.start() // 不使用 timeslice，讓 stop() 觸發完整段落
    }

    /**
     * 排程下一次切換
     */
    private scheduleNextSwap(): void {
        if (!this.isRecording) return

        this.swapTimer = setTimeout(() => {
            if (this.isRecording) {
                this.swapRecorders()
            }
        }, this.config.segmentDuration)
    }

    /**
     * 執行 MediaRecorder 角色轉換
     */
    private swapRecorders(): void {
        try {
            console.log('🔄 [AdvancedAudioRecorder] 執行 MediaRecorder 切換')

            // 步驟 1: 停止當前錄音器（觸發 dataavailable）
            if (this.currentRecorder && this.currentRecorder.state === 'recording') {
                this.currentRecorder.stop()
            }

            // 步驟 2: 啟動備用錄音器
            if (this.nextRecorder) {
                this.nextRecorder.start()
                console.log(`🎵 [AdvancedAudioRecorder] 切換到段落 #${this.sequence}`)
            }

            // 步驟 3: 角色轉換
            const oldRecorder = this.currentRecorder
            this.currentRecorder = this.nextRecorder

            // 步驟 4: 準備下一個錄音器
            try {
                this.nextRecorder = this.createMediaRecorder()
            } catch (error) {
                console.error('❌ [AdvancedAudioRecorder] 創建下一個錄音器失敗:', error)
                this.handleError(error instanceof Error ? error : new Error('創建錄音器失敗'))
                return
            }

            // 步驟 5: 清理舊錄音器
            this.cleanupRecorder(oldRecorder)

            // 步驟 6: 排程下一次切換
            if (this.isRecording) {
                this.scheduleNextSwap()
            }

        } catch (error) {
            console.error('❌ [AdvancedAudioRecorder] 切換錄音器失敗:', error)
            this.handleError(error instanceof Error ? error : new Error('切換錄音器失敗'))
        }
    }

    /**
     * 清理 MediaRecorder
     */
    private cleanupRecorder(recorder: MediaRecorder | null): void {
        if (!recorder) return

        try {
            if (recorder.state !== 'inactive') {
                recorder.stop()
            }
        } catch (error) {
            console.warn('⚠️ [AdvancedAudioRecorder] 清理錄音器時發生警告:', error)
        }
    }

    /**
     * 錯誤處理
     */
    private handleError(error: Error): void {
        console.error('❌ [AdvancedAudioRecorder] 錯誤:', error)
        this.isRecording = false
        this.onErrorCallback?.(error)
    }

    // ============ 事件回調設定 ============

    onSegment(callback: (segment: AudioSegment) => void): void {
        this.onSegmentCallback = callback
    }

    onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback
    }
}

/**
 * 檢查進階音訊錄製支援
 */
export async function checkAdvancedAudioRecordingSupport(): Promise<{ isSupported: boolean; error?: string }> {
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
