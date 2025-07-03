"use client"

import { BaseService } from './base-service'
import { IRecordingService, RecordingState } from './interfaces'
import { AdvancedAudioRecorder, AudioSegment, checkAdvancedAudioRecordingSupport } from '../advanced-audio-recorder'
import { RestAudioUploader, UploadSegmentResponse } from '../rest-audio-uploader'
import { getAudioChunkIntervalMs } from '../config'
import { toast } from '@/hooks/use-toast'

/**
 * SimpleRecordingService - 簡化錄音管理服務
 *
 * Phase 2.5 重構：使用 AdvancedAudioRecorder 修復 WebM Header 問題
 * 整合 AdvancedAudioRecorder + RestAudioUploader
 *
 * 特點：
 * - 使用 AdvancedAudioRecorder（雙 MediaRecorder 無縫切換策略）
 * - 使用 RestAudioUploader（REST API 上傳）
 * - 移除 ack/missing 重傳機制
 * - 簡化錯誤處理和狀態管理
 * - 支援失敗檔案暫存到 IndexedDB
 */
export class SimpleRecordingService extends BaseService implements IRecordingService {
    protected readonly serviceName = 'SimpleRecordingService'

    // 錄音器和上傳器引用
    private audioRecorder: AdvancedAudioRecorder | null = null
    private audioUploader: RestAudioUploader | null = null

    // 錄音狀態
    private recordingState: RecordingState = {
        isRecording: false,
        recordingTime: 0,
        currentSessionId: null,
        error: null
    }

    // 計時器
    private recordingTimer: ReturnType<typeof setInterval> | null = null
    private uploadedSegments = new Set<number>()
    private failedSegments = new Set<number>()

    // 在 class SimpleRecordingService 內部加上：
    public stream: MediaStream | null = null
    private sessionId: string | null = null
    private timerStart: number | null = null

    /**
     * 服務初始化
     */
    async initialize(): Promise<void> {
        this.logInfo('服務初始化開始')

        // 檢查瀏覽器支援度
        const supportCheck = await checkAdvancedAudioRecordingSupport()
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

        // 清理上傳器
        if (this.audioUploader) {
            this.audioUploader.cleanup()
            this.audioUploader = null
        }

        // 清理計時器
        this.clearRecordingTimer()

        // 重置狀態
        this.resetRecordingState()

        this.logSuccess('清理完成')
    }

    /**
     * 開始錄音
     */
    async startRecording(sessionId: string): Promise<void> {
        try {
            this.logInfo(`開始錄音 - sessionId: ${sessionId}`)

            // 如果已經在錄音，先停止
            if (this.recordingState.isRecording) {
                this.logWarning('已在錄音中，先停止現有錄音')
                await this.stopRecording()
            }

            this.sessionId = sessionId
            this.recordingState.currentSessionId = sessionId

            // 請求麥克風權限
            await this.ensureStarted()

            // 初始化錄音器和上傳器
            await this.initMediaRecorder()

            // 更新狀態
            this.recordingState.isRecording = true
            this.recordingState.error = null

            // 啟動計時器
            this.timerStart = Date.now()
            this.startRecordingTimer()

            this.logSuccess(`錄音已開始 - sessionId: ${sessionId}`)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '開始錄音失敗'
            this.recordingState.error = errorMessage
            this.handleError('開始錄音', error)
            throw error
        }
    }

    /**
     * 停止錄音
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
            this.clearRecordingTimer()

            // 清理音頻錄製器
            if (this.audioRecorder) {
                this.audioRecorder.cleanup()
                this.audioRecorder = null
            }

            this.logSuccess('錄音停止成功', {
                sessionId: this.recordingState.currentSessionId,
                recordingTime: this.recordingState.recordingTime,
                uploadedSegments: this.uploadedSegments.size,
                failedSegments: this.failedSegments.size
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
        return this.timerStart ? (Date.now() - this.timerStart) / 1000 | 0 : 0
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
    }

    /**
     * 設定上傳器事件處理
     */
    private setupUploaderEvents(): void {
        if (!this.audioUploader) return

        // 處理上傳成功
        this.audioUploader.onUploadSuccess((seq: number, response: UploadSegmentResponse) => {
            this.uploadedSegments.add(seq)
            this.logInfo('音頻段落上傳成功', {
                sequence: seq,
                size: response.size,
                totalUploaded: this.uploadedSegments.size
            })
        })

        // 處理上傳錯誤
        this.audioUploader.onUploadError((seq: number, error: string) => {
            this.failedSegments.add(seq)
            this.logWarning('音頻段落上傳失敗', {
                sequence: seq,
                error,
                totalFailed: this.failedSegments.size
            })
        })

        // 處理暫存到本地
        this.audioUploader.onCacheStored((seq: number) => {
            this.logInfo('音頻段落已暫存到本地', {
                sequence: seq,
                message: '可稍後重新上傳'
            })
        })
    }

    /**
     * 處理音頻段落
     */
    private async handleAudioSegment(segment: any): Promise<void> {
        console.log('🎤 [SimpleRecordingService] 收到音頻段落', {
            sequence: segment.sequence,
            size: segment.blob.size,
            duration: segment.duration,
            timestamp: new Date().toISOString()
        })

        this.logInfo(`收到音頻段落 - sequence: ${segment.sequence}, size: ${segment.blob.size}, duration: ${segment.duration}`)

        // 使用 REST API 上傳
        if (this.audioUploader) {
            try {
                await this.audioUploader.uploadSegment(segment.sequence, segment.blob)
            } catch (error) {
                // 錯誤已由 audioUploader 處理（重試或暫存）
                console.log(`⚠️ [SimpleRecordingService] 段落 #${segment.sequence} 上傳處理中`)
            }
        } else {
            this.logWarning(`音頻上傳器未初始化 - sequence: ${segment.sequence}`)
        }
    }

    /**
     * 重新上傳暫存的失敗段落
     */
    async retryFailedUploads(): Promise<void> {
        this.logInfo('開始重新上傳暫存的失敗段落')

        if (this.audioUploader) {
            try {
                await this.audioUploader.retryFailedSegments()
                this.logSuccess('暫存段落重新上傳完成')
            } catch (error) {
                this.logWarning('重新上傳暫存段落失敗', error)
            }
        }
    }

    /**
     * 取得暫存的失敗段落數量
     */
    async getCachedSegmentsCount(): Promise<number> {
        if (this.audioUploader) {
            return await this.audioUploader.getCachedSegmentsCount()
        }
        return 0
    }

    /**
     * 啟動錄音計時器
     */
    private startRecordingTimer(): void {
        this.clearRecordingTimer()
        this.recordingState.recordingTime = 0

        console.log('⏱️ [SimpleRecordingService] 計時器啟動')
        this.recordingTimer = setInterval(() => {
            this.recordingState.recordingTime += 1

            // 每 30 秒記錄一次錄音時間
            if (this.recordingState.recordingTime % 30 === 0) {
                this.logInfo('錄音進行中', {
                    recordingTime: this.recordingState.recordingTime,
                    minutes: Math.floor(this.recordingState.recordingTime / 60),
                    uploadedSegments: this.uploadedSegments.size,
                    failedSegments: this.failedSegments.size
                })
            }
        }, 1000)
    }

    /**
     * 清理錄音計時器
     */
    private clearRecordingTimer(): void {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer)
            this.recordingTimer = null
            console.log('⏹️ [SimpleRecordingService] 計時器清除')
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
        this.uploadedSegments.clear()
        this.failedSegments.clear()
    }

    /**
     * 清理錄音相關資源
     */
    private async cleanupRecordingResources(): Promise<void> {
        try {
            // 停止音頻錄製器
            if (this.audioRecorder) {
                this.audioRecorder.stop()
                this.audioRecorder.cleanup()
                this.audioRecorder = null
            }

            // 清理上傳器
            if (this.audioUploader) {
                this.audioUploader.cleanup()
                this.audioUploader = null
            }

            // 清理計時器
            this.clearRecordingTimer()

            // 重置狀態
            this.recordingState.isRecording = false

            this.logInfo('錄音資源清理完成')
        } catch (error) {
            this.logWarning('清理錄音資源時發生錯誤', error)
        }
    }

    /**
     * 獲取服務詳細狀態
     */
    async getDetailedStatus(): Promise<SimpleRecordingServiceStatus> {
        const baseStatus = this.getStatus()
        const supportCheck = await checkAdvancedAudioRecordingSupport()
        const cachedCount = await this.getCachedSegmentsCount()

        return {
            ...baseStatus,
            recordingState: this.getRecordingState(),
            audioSupport: {
                supported: supportCheck.isSupported,
                errors: supportCheck.error ? [supportCheck.error] : []
            },
            audioRecorderState: this.audioRecorder?.recording ? 'recording' : 'idle',
            uploadStats: {
                uploaded: this.uploadedSegments.size,
                failed: this.failedSegments.size,
                cached: cachedCount
            }
        }
    }

    async requestPermission(): Promise<boolean> {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            return true
        } catch (e) {
            toast({ title: '需要麥克風權限才能錄音', variant: 'destructive' })
            return false
        }
    }

    private async ensureStarted() {
        if (!this.stream) await this.start()
    }

    /**
     * 初始化 MediaRecorder 和相關元件
     */
    private async initMediaRecorder(): Promise<void> {
        try {
            this.logInfo('初始化 MediaRecorder')

            if (!this.stream) {
                throw new Error('音訊串流未初始化')
            }

            if (!this.sessionId) {
                throw new Error('Session ID 未設定')
            }

            // 創建音頻錄製器
            const chunkInterval = (await import('../config')).getAudioChunkIntervalMs()
            const { AdvancedAudioRecorder } = await import('../advanced-audio-recorder')
            this.audioRecorder = new AdvancedAudioRecorder({
                segmentDuration: chunkInterval,
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            })

            // 設定錄製器事件（錯誤處理）
            this.setupAudioRecorderEvents()

            // 創建上傳器
            const { RestAudioUploader } = await import('../rest-audio-uploader')
            this.audioUploader = new RestAudioUploader()
            this.audioUploader.setSessionId(this.sessionId)

            // 設定上傳器事件
            this.setupUploaderEvents()

            // 開始錄音並傳入段落處理 callback
            await this.audioRecorder.start(async (segment) => {
                await this.handleAudioSegment(segment)
            })

            this.logSuccess(`MediaRecorder 初始化完成並開始錄音 - sessionId: ${this.sessionId}, chunkInterval: ${chunkInterval}ms`)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知錯誤'
            this.logWarning(`初始化 MediaRecorder 失敗: ${errorMessage}`)
            throw error
        }
    }

    // 若有 sessionId 變動需求，可加上：
    private updateSessionId(newSessionId: string): void {
        this.sessionId = newSessionId
        this.recordingState.currentSessionId = newSessionId
        if (this.audioUploader) {
            this.audioUploader.setSessionId(newSessionId)
        }
    }
}

/**
 * SimpleRecordingService 詳細狀態介面
 */
export interface SimpleRecordingServiceStatus {
    serviceName: string
    isInitialized: boolean
    isRunning: boolean
    timestamp: string
    recordingState: RecordingState
    audioSupport: {
        supported: boolean
        errors: string[]
    }
    audioRecorderState: string
    uploadStats: {
        uploaded: number
        failed: number
        cached: number
    }
}
