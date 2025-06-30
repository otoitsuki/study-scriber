"use client"

/**
 * RestAudioUploader - REST API 音頻上傳器
 *
 * Phase 2 重構：替換 WebSocket 為 REST API 上傳
 *
 * 特點：
 * - 使用 fetch POST `/api/segment` 上傳完整 10s 檔案
 * - 實作上傳錯誤處理和重試機制
 * - 使用 IndexedDB 暫存失敗的檔案
 * - 簡化的錯誤處理流程
 */

import { appConfig } from './config'

export interface UploadSegmentResponse {
    ack: number
    size: number
    status: 'success' | 'error'
    error?: string
}

export interface FailedSegment {
    sessionId: string
    sequence: number
    blob: Blob
    timestamp: number
    retryCount: number
}

export class RestAudioUploader {
    private sessionId: string | null = null
    private uploadQueue: Map<number, Blob> = new Map()
    private retryCount: Map<number, number> = new Map()
    private maxRetries = 3

    // 事件回調
    private onUploadSuccessCallback?: (seq: number, response: UploadSegmentResponse) => void
    private onUploadErrorCallback?: (seq: number, error: string) => void
    private onCacheStoredCallback?: (seq: number) => void

    constructor() {
        if (typeof window !== 'undefined') {
            this.initIndexedDB()
        }
    }

    /**
     * 初始化 IndexedDB 存儲
     */
    private async initIndexedDB(): Promise<void> {
        if (typeof window === 'undefined' || !window.indexedDB) {
            console.warn('⚠️ [RestAudioUploader] IndexedDB 不可用（服務器端渲染）')
            return
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AudioSegmentCache', 1)

            request.onerror = () => {
                console.error('❌ [RestAudioUploader] IndexedDB 開啟失敗')
                reject(new Error('IndexedDB 初始化失敗'))
            }

            request.onsuccess = () => {
                console.log('✅ [RestAudioUploader] IndexedDB 初始化成功')
                resolve()
            }

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result

                if (!db.objectStoreNames.contains('failedSegments')) {
                    const store = db.createObjectStore('failedSegments', { keyPath: 'id' })
                    store.createIndex('sessionId', 'sessionId', { unique: false })
                    store.createIndex('timestamp', 'timestamp', { unique: false })
                }
            }
        })
    }

    /**
     * 設定 session ID
     */
    setSessionId(sessionId: string): void {
        this.sessionId = sessionId
        console.log('🎯 [RestAudioUploader] Session ID 設定:', sessionId)
    }

    /**
     * 上傳音頻段落
     */
    async uploadSegment(sequence: number, blob: Blob): Promise<UploadSegmentResponse> {
        if (!this.sessionId) {
            throw new Error('Session ID 未設定')
        }

        console.log(`📤 [RestAudioUploader] 準備上傳段落 #${sequence}`, {
            size: blob.size,
            mimeType: blob.type,
            sessionId: this.sessionId
        })

        try {
            const formData = new FormData()
            formData.append('file', blob, `seg${sequence}.webm`)

            const response = await fetch(`${appConfig.apiUrl}/api/segment?sid=${this.sessionId}&seq=${sequence}`, {
                method: 'POST',
                body: formData
            })

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }

            const result: UploadSegmentResponse = await response.json()

            console.log(`✅ [RestAudioUploader] 段落 #${sequence} 上傳成功`, result)

            // 重置重試計數
            this.retryCount.delete(sequence)

            // 觸發成功回調
            this.onUploadSuccessCallback?.(sequence, result)

            return result

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '上傳失敗'
            console.error(`❌ [RestAudioUploader] 段落 #${sequence} 上傳失敗:`, errorMessage)

            // 處理重試邏輯
            await this.handleUploadFailure(sequence, blob, errorMessage)

            throw new Error(errorMessage)
        }
    }

    /**
     * 處理上傳失敗 - 重試或暫存
     */
    private async handleUploadFailure(sequence: number, blob: Blob, error: string): Promise<void> {
        const currentRetries = this.retryCount.get(sequence) || 0

        if (currentRetries < this.maxRetries) {
            // 嘗試重試
            this.retryCount.set(sequence, currentRetries + 1)
            console.log(`🔄 [RestAudioUploader] 段落 #${sequence} 準備重試 (${currentRetries + 1}/${this.maxRetries})`)

            // 延遲重試（漸進式延遲）
            const delay = Math.pow(2, currentRetries) * 1000 // 1s, 2s, 4s
            setTimeout(() => {
                this.retryUpload(sequence, blob)
            }, delay)

        } else {
            // 達到最大重試次數，暫存到 IndexedDB
            console.warn(`⚠️ [RestAudioUploader] 段落 #${sequence} 達到最大重試次數，暫存到本地`)
            await this.cacheFailedSegment(sequence, blob)

            // 觸發錯誤回調
            this.onUploadErrorCallback?.(sequence, `達到最大重試次數: ${error}`)
        }
    }

    /**
     * 重試上傳
     */
    private async retryUpload(sequence: number, blob: Blob): Promise<void> {
        try {
            await this.uploadSegment(sequence, blob)
        } catch (error) {
            // 重試失敗會再次觸發 handleUploadFailure
            console.log(`⚠️ [RestAudioUploader] 段落 #${sequence} 重試失敗`)
        }
    }

    /**
     * 暫存失敗的段落到 IndexedDB
     */
    private async cacheFailedSegment(sequence: number, blob: Blob): Promise<void> {
        if (!this.sessionId || typeof window === 'undefined' || !window.indexedDB) return

        try {
            const request = indexedDB.open('AudioSegmentCache', 1)

            request.onsuccess = () => {
                const db = request.result
                const transaction = db.transaction(['failedSegments'], 'readwrite')
                const store = transaction.objectStore('failedSegments')

                const failedSegment: FailedSegment = {
                    sessionId: this.sessionId!,
                    sequence,
                    blob,
                    timestamp: Date.now(),
                    retryCount: this.retryCount.get(sequence) || 0
                }

                const addRequest = store.put({
                    id: `${this.sessionId}_${sequence}`,
                    ...failedSegment
                })

                addRequest.onsuccess = () => {
                    console.log(`💾 [RestAudioUploader] 段落 #${sequence} 已暫存到本地`)
                    this.onCacheStoredCallback?.(sequence)
                }

                addRequest.onerror = () => {
                    console.error(`❌ [RestAudioUploader] 段落 #${sequence} 暫存失敗`)
                }
            }

        } catch (error) {
            console.error('❌ [RestAudioUploader] IndexedDB 暫存錯誤:', error)
        }
    }

    /**
     * 重新上傳暫存的失敗段落
     */
    async retryFailedSegments(): Promise<void> {
        if (!this.sessionId || typeof window === 'undefined' || !window.indexedDB) return

        try {
            const request = indexedDB.open('AudioSegmentCache', 1)

            request.onsuccess = () => {
                const db = request.result
                const transaction = db.transaction(['failedSegments'], 'readonly')
                const store = transaction.objectStore('failedSegments')
                const index = store.index('sessionId')
                const getRequest = index.getAll(this.sessionId)

                getRequest.onsuccess = async () => {
                    const failedSegments = getRequest.result

                    if (failedSegments.length === 0) {
                        console.log('✅ [RestAudioUploader] 沒有暫存的失敗段落')
                        return
                    }

                    console.log(`🔄 [RestAudioUploader] 發現 ${failedSegments.length} 個暫存段落，開始重新上傳`)

                    for (const segment of failedSegments) {
                        try {
                            await this.uploadSegment(segment.sequence, segment.blob)

                            // 上傳成功，從 IndexedDB 中移除
                            await this.removeFailedSegment(`${segment.sessionId}_${segment.sequence}`)

                        } catch (error) {
                            console.warn(`⚠️ [RestAudioUploader] 暫存段落 #${segment.sequence} 重新上傳失敗`)
                        }
                    }
                }
            }

        } catch (error) {
            console.error('❌ [RestAudioUploader] 重新上傳暫存段落失敗:', error)
        }
    }

    /**
     * 從 IndexedDB 中移除成功上傳的段落
     */
    private async removeFailedSegment(id: string): Promise<void> {
        if (typeof window === 'undefined' || !window.indexedDB) return

        try {
            const request = indexedDB.open('AudioSegmentCache', 1)

            request.onsuccess = () => {
                const db = request.result
                const transaction = db.transaction(['failedSegments'], 'readwrite')
                const store = transaction.objectStore('failedSegments')

                const deleteRequest = store.delete(id)
                deleteRequest.onsuccess = () => {
                    console.log(`🗑️ [RestAudioUploader] 已移除暫存段落: ${id}`)
                }
            }

        } catch (error) {
            console.error('❌ [RestAudioUploader] 移除暫存段落失敗:', error)
        }
    }

    /**
     * 獲取暫存的失敗段落數量
     */
    async getCachedSegmentsCount(): Promise<number> {
        if (!this.sessionId || typeof window === 'undefined' || !window.indexedDB) return 0

        return new Promise((resolve) => {
            const request = indexedDB.open('AudioSegmentCache', 1)

            request.onsuccess = () => {
                const db = request.result
                const transaction = db.transaction(['failedSegments'], 'readonly')
                const store = transaction.objectStore('failedSegments')
                const index = store.index('sessionId')
                const countRequest = index.count(this.sessionId!)

                countRequest.onsuccess = () => {
                    resolve(countRequest.result)
                }

                countRequest.onerror = () => {
                    resolve(0)
                }
            }

            request.onerror = () => {
                resolve(0)
            }
        })
    }

    /**
     * 清理資源
     */
    cleanup(): void {
        this.sessionId = null
        this.uploadQueue.clear()
        this.retryCount.clear()
        console.log('🧹 [RestAudioUploader] 已清理')
    }

    // 事件回調設定
    onUploadSuccess(callback: (seq: number, response: UploadSegmentResponse) => void): void {
        this.onUploadSuccessCallback = callback
    }

    onUploadError(callback: (seq: number, error: string) => void): void {
        this.onUploadErrorCallback = callback
    }

    onCacheStored(callback: (seq: number) => void): void {
        this.onCacheStoredCallback = callback
    }
}

// 預設實例
export const restAudioUploader = new RestAudioUploader()
