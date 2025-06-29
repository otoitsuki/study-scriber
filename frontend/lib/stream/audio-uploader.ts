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

    /**
     * 連接音訊上傳 WebSocket
     */
    async connect(sessionId: string): Promise<void> {
        this.sessionId = sessionId
        this.sequenceNumber = 0  // 重置序號

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
                    sessionId: this.sessionId
                })
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
     * 發送音訊切片（包含序號）
     */
    send(blob: Blob): void {
        if (this.ws?.readyState !== WebSocket.OPEN) {
            console.warn('⚠️ [AudioUploader] WebSocket 未連接，無法發送音訊數據', {
                readyState: this.ws?.readyState,
                expectedState: WebSocket.OPEN,
                sessionId: this.sessionId
            })
            return
        }

        // 建立包含序號的資料包（與 AudioUploadWebSocket 相同格式）
        const sequenceBuffer = new ArrayBuffer(4)
        const sequenceView = new DataView(sequenceBuffer)
        sequenceView.setUint32(0, this.sequenceNumber, true) // little-endian

        // 合併序號和音訊資料
        blob.arrayBuffer().then(audioBuffer => {
            const combinedBuffer = new ArrayBuffer(sequenceBuffer.byteLength + audioBuffer.byteLength)
            const combinedView = new Uint8Array(combinedBuffer)

            combinedView.set(new Uint8Array(sequenceBuffer), 0)
            combinedView.set(new Uint8Array(audioBuffer), sequenceBuffer.byteLength)

            this.ws!.send(combinedBuffer)

            console.log(`📤 [AudioUploader] 發送音訊切片 #${this.sequenceNumber}: ${blob.size} bytes`)

            // DEV 模式診斷計數
            if (process.env.NODE_ENV === 'development') {
                if (!(window as any).__rec) {
                    (window as any).__rec = {
                        chunksSent: 0,
                        totalBytes: 0,
                        isRecording: false,
                        sessionId: null
                    }
                }

                const rec = (window as any).__rec
                rec.chunksSent++
                rec.totalBytes += blob.size
                rec.sessionId = this.sessionId
                rec.isRecording = true
                rec.lastSequence = this.sequenceNumber

                console.log(`🔍 [AudioUploader] DEV 診斷: 已發送 ${rec.chunksSent} 個切片，總計 ${rec.totalBytes} bytes，最後序號 ${this.sequenceNumber}`)
            }

            // 遞增序號
            this.sequenceNumber++
        }).catch(error => {
            console.error('❌ [AudioUploader] 音訊數據轉換失敗:', error)
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
