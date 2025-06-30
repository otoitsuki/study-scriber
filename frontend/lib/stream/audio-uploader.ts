"use client"

/**
 * AudioUploader - 音訊上傳 WebSocket 類別
 *
 * 負責建立 /ws/upload_audio/{sessionId} WebSocket 連接
 * 並發送音訊切片到後端進行語音辨識
 */
export class AudioUploader {
    private ws: WebSocket | null = null
    private sessionId: string | null = null
    private sequenceNumber = 0  // 音訊切片序號
    private reconnectAttempts = 0  // 重連嘗試次數
    private maxReconnectAttempts = 5  // 最大重連次數
    private reconnectDelay = 1000  // 重連延遲（毫秒）
    private pendingChunks: Map<number, Blob> = new Map()  // 待重發的音訊切片

    /**
     * 連接音訊上傳 WebSocket
     */
    async connect(sessionId: string): Promise<void> {
        this.sessionId = sessionId
        this.sequenceNumber = 0  // 重置序號
        this.reconnectAttempts = 0  // 重置重連計數
        this.pendingChunks.clear()  // 清空待處理切片

        const wsBaseUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
        const wsUrl = `${wsBaseUrl}/ws/upload_audio/${sessionId}`

        console.log('🔌 [AudioUploader] 正在連接:', wsUrl)

        this.ws = new WebSocket(wsUrl)

        return new Promise((resolve, reject) => {
            if (!this.ws) return reject(new Error('WebSocket 創建失敗'))

            this.ws.onopen = () => {
                console.log('✅ [AudioUploader] WebSocket 連接成功:', sessionId)
                resolve()
            }

            this.ws.onerror = (error) => {
                console.error('❌ [AudioUploader] WebSocket 錯誤:', error)
                reject(new Error('AudioUploader WebSocket 連接失敗'))
            }

            this.ws.onclose = (event) => {
                console.log('🔌 [AudioUploader] WebSocket 連接已關閉:', {
                    code: event.code,
                    reason: event.reason,
                    sessionId: this.sessionId,
                    wasClean: event.wasClean
                })

                // 如果不是手動關閉，嘗試重連
                if (!event.wasClean && this.sessionId && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.attemptReconnect()
                }
            }

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data)
                    this.handleServerMessage(message)
                } catch (error) {
                    console.log('📥 [AudioUploader] 收到非 JSON 消息:', event.data)
                }
            }
        })
    }

    /**
     * 處理伺服器消息
     */
    private handleServerMessage(message: any): void {
        console.log('📥 [AudioUploader] 收到伺服器消息:', message)

        switch (message.type) {
            case 'ack':
                console.log(`✅ [AudioUploader] 音訊切片 #${message.chunk_sequence} 確認收到`)
                break
            case 'upload_error':
                console.error(`❌ [AudioUploader] 上傳錯誤 #${message.chunk_sequence}:`, message.error)
                break
            case 'connection_established':
                console.log('✅ [AudioUploader] 連接已建立')
                break
            default:
                console.log('📥 [AudioUploader] 未知消息類型:', message.type)
        }
    }

    /**
     * 發送音訊切片（修正的 4-byte sequence + Blob 格式）
     * 合併序號和音檔數據為一個二進制消息，使用小端序與後端匹配
     */
    async send(blob: Blob, sequence?: number): Promise<void> {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ [AudioUploader] WebSocket 未連接，無法發送音訊數據', {
                readyState: this.ws?.readyState,
                expectedState: WebSocket.OPEN,
                sessionId: this.sessionId,
                sequence: sequence ?? this.sequenceNumber
            })
            return
        }

        // 使用傳入的序號或內部序號
        const currentSequence = sequence ?? this.sequenceNumber

        console.log(`📤 [AudioUploader] 準備發送音訊切片 #${currentSequence}`, {
            blobSize: blob.size,
            mimeType: blob.type,
            sessionId: this.sessionId,
            timestamp: new Date().toISOString()
        })

        try {
            // 修正：將序號和音檔數據合併為一個二進制消息
            // 4-byte sequence (小端序) + Blob 數據
            const sequenceBuffer = new ArrayBuffer(4)
            const sequenceView = new DataView(sequenceBuffer)
            sequenceView.setUint32(0, currentSequence, true) // true = 小端序，與後端匹配

            // 將序號和音檔數據合併
            const blobArrayBuffer = await blob.arrayBuffer()
            const combinedBuffer = new ArrayBuffer(4 + blobArrayBuffer.byteLength)
            const combinedView = new Uint8Array(combinedBuffer)

            // 複製序號到合併緩衝區
            combinedView.set(new Uint8Array(sequenceBuffer), 0)
            // 複製音檔數據到合併緩衝區
            combinedView.set(new Uint8Array(blobArrayBuffer), 4)

            // 一次性發送合併的二進制數據
            this.ws.send(combinedBuffer)

            console.log(`✅ [AudioUploader] 音訊切片 #${currentSequence} 發送成功: ${blob.size} bytes (總計: ${combinedBuffer.byteLength} bytes)`)

            // DEV 模式診斷計數
            if (process.env.NODE_ENV === 'development') {
                this.updateDevDiagnostics(currentSequence, blob.size)
            }

            // 只有使用內部序號時才遞增
            if (sequence === undefined) {
                this.sequenceNumber++
            }

        } catch (error) {
            console.error(`❌ [AudioUploader] 發送音訊切片 #${currentSequence} 失敗:`, error)
            this.handleSendError(currentSequence, error)
        }
    }

    /**
     * 處理發送錯誤的重試機制
     */
    private handleSendError(sequence: number, error: any): void {
        console.error(`❌ [AudioUploader] 序號 #${sequence} 發送錯誤:`, error)
        // 可以在這裡實作重試邏輯
        // 例如：將失敗的序號加入重試佇列
    }

    /**
     * 嘗試重新連接 WebSocket
     */
    private async attemptReconnect(): Promise<void> {
        this.reconnectAttempts++

        console.log(`🔄 [AudioUploader] 嘗試重連 (#${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

        // 漸進式延遲重連
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)

        setTimeout(async () => {
            try {
                if (this.sessionId) {
                    await this.connect(this.sessionId)
                    console.log('✅ [AudioUploader] 重連成功')
                    this.reconnectAttempts = 0 // 重置重連計數

                    // 重新發送待處理的音訊切片
                    this.resendPendingChunks()
                }
            } catch (error) {
                console.error(`❌ [AudioUploader] 重連失敗 (#${this.reconnectAttempts}):`, error)

                if (this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.attemptReconnect()
                } else {
                    console.error('❌ [AudioUploader] 已達重連最大次數，停止嘗試')
                }
            }
        }, delay)
    }

    /**
     * 重新發送待處理的音訊切片
     */
    private resendPendingChunks(): void {
        if (this.pendingChunks.size === 0) return

        console.log(`🔄 [AudioUploader] 重新發送 ${this.pendingChunks.size} 個待處理切片`)

        for (const [sequence, blob] of this.pendingChunks.entries()) {
            this.send(blob, sequence)
        }

        // 清空待處理切片
        this.pendingChunks.clear()
    }

    /**
     * 更新開發模式診斷信息
     */
    private updateDevDiagnostics(sequence: number, blobSize: number): void {
        if (!(window as any).__rec) {
            (window as any).__rec = {
                chunksSent: 0,
                totalBytes: 0,
                isRecording: false,
                sessionId: null,
                lastSequence: -1,
                errors: 0
            }
        }

        const rec = (window as any).__rec
        rec.chunksSent++
        rec.totalBytes += blobSize
        rec.sessionId = this.sessionId
        rec.isRecording = true
        rec.lastSequence = sequence

        console.log(`🔍 [AudioUploader] DEV 診斷:`, {
            chunksSent: rec.chunksSent,
            totalBytes: rec.totalBytes,
            lastSequence: sequence,
            sessionId: this.sessionId
        })
    }

    /**
     * 重置序號（重新開始錄音時使用）
     */
    resetSequence(): void {
        this.sequenceNumber = 0
        console.log('🔄 [AudioUploader] 序號已重置')
    }

    /**
     * 關閉 WebSocket 連接
     */
    close(): void {
        if (this.ws) {
            this.ws.close()
            this.ws = null
        }

        this.sessionId = null
        this.sequenceNumber = 0
        this.reconnectAttempts = 0
        this.pendingChunks.clear()

        // 更新 DEV 模式診斷狀態
        if (process.env.NODE_ENV === 'development' && (window as any).__rec) {
            (window as any).__rec.isRecording = false
        }

        console.log('🔌 [AudioUploader] WebSocket 已關閉')
    }

    /**
     * 檢查連接狀態
     */
    get isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN
    }

    /**
     * 獲取當前會話 ID
     */
    get currentSessionId(): string | null {
        return this.sessionId
    }

    /**
     * 獲取當前序號
     */
    get currentSequence(): number {
        return this.sequenceNumber
    }

    /**
     * 獲取 WebSocket 狀態
     */
    get connectionState(): string {
        if (!this.ws) return 'NOT_CREATED'

        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'CONNECTING'
            case WebSocket.OPEN: return 'OPEN'
            case WebSocket.CLOSING: return 'CLOSING'
            case WebSocket.CLOSED: return 'CLOSED'
            default: return 'UNKNOWN'
        }
    }
}

/**
 * 默認的音訊上傳器實例
 * 可在整個應用中共用
 */
export const audioUploader = new AudioUploader()
