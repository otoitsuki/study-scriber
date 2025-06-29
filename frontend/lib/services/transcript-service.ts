"use client"

import { BaseService } from './base-service'
import { ITranscriptService, TranscriptMessage } from './interfaces'
import { transcriptManager } from '../transcript-manager'

/**
 * 逐字稿服務資訊介面
 */
interface TranscriptServiceInfo {
    serviceName: string
    isInitialized: boolean
    isRunning: boolean
    connectedSessions: string[]
    activeListeners: Record<string, number>
    totalConnections: number
    transcriptManagerConnections: number
}

/**
 * TranscriptService - 逐字稿服務
 *
 * 職責：
 * - 封裝 TranscriptManager 的 API 為服務層接口
 * - 提供統一的逐字稿連接和消息處理
 * - 保持 TranscriptManager 的獨立性和 WebSocket 重連機制
 * - 支持多會話的逐字稿管理
 */
export class TranscriptService extends BaseService implements ITranscriptService {
    protected readonly serviceName = 'TranscriptService'

    private connectedSessions: Set<string> = new Set()
    private sessionListeners: Map<string, Set<(message: TranscriptMessage) => void>> = new Map()

    /**
     * 初始化服務
     */
    async initialize(): Promise<void> {
        this.logInfo('初始化逐字稿服務')
        // TranscriptManager 是 Singleton，無需特別初始化
    }

    /**
     * 清理服務資源
     */
    async cleanup(): Promise<void> {
        this.logInfo('清理逐字稿服務資源')

        // 斷開所有連接
        const sessionIds = Array.from(this.connectedSessions)
        for (const sessionId of sessionIds) {
            await this.disconnect(sessionId)
        }

        this.connectedSessions.clear()
        this.sessionListeners.clear()
    }

    /**
     * 連接逐字稿服務
     */
    async connect(sessionId: string): Promise<void> {
        if (!this.isRunning) {
            throw new Error('TranscriptService 尚未啟動，請先調用 start()')
        }

        try {
            this.logInfo(`連接逐字稿服務: ${sessionId}`)

            // 使用 TranscriptManager 建立連接
            await transcriptManager.connect(sessionId)

            // 記錄連接狀態
            this.connectedSessions.add(sessionId)

            this.logSuccess(`逐字稿服務連接成功: ${sessionId}`)
        } catch (error) {
            this.handleError(`逐字稿服務連接失敗: ${sessionId}`, error)
        }
    }

    /**
     * 斷開逐字稿服務
     */
    async disconnect(sessionId?: string): Promise<void> {
        try {
            if (sessionId) {
                this.logInfo(`斷開逐字稿服務: ${sessionId}`)

                // 移除所有監聽器
                const listeners = this.sessionListeners.get(sessionId)
                if (listeners) {
                    listeners.forEach(callback => {
                        transcriptManager.removeListener(sessionId, callback)
                    })
                    this.sessionListeners.delete(sessionId)
                }

                // 斷開連接
                await transcriptManager.disconnect(sessionId)
                this.connectedSessions.delete(sessionId)

                this.logSuccess(`逐字稿服務斷開成功: ${sessionId}`)
            } else {
                // 斷開所有連接
                this.logInfo('斷開所有逐字稿服務連接')
                const sessionIds = Array.from(this.connectedSessions)
                for (const id of sessionIds) {
                    await this.disconnect(id)
                }
            }
        } catch (error) {
            this.handleError(`斷開逐字稿服務失敗: ${sessionId || 'all'}`, error)
        }
    }

    /**
     * 添加逐字稿監聽器
     */
    addTranscriptListener(sessionId: string, callback: (message: TranscriptMessage) => void): void {
        if (!this.isRunning) {
            throw new Error('TranscriptService 尚未啟動，請先調用 start()')
        }

        this.logInfo(`添加逐字稿監聽器: ${sessionId}`)

        // 記錄監聽器
        if (!this.sessionListeners.has(sessionId)) {
            this.sessionListeners.set(sessionId, new Set())
        }
        this.sessionListeners.get(sessionId)!.add(callback)

        // 添加到 TranscriptManager
        transcriptManager.addListener(sessionId, callback)
    }

    /**
     * 移除逐字稿監聽器
     */
    removeTranscriptListener(sessionId: string, callback: (message: TranscriptMessage) => void): void {
        this.logInfo(`移除逐字稿監聽器: ${sessionId}`)

        // 從記錄中移除
        const listeners = this.sessionListeners.get(sessionId)
        if (listeners) {
            listeners.delete(callback)
            if (listeners.size === 0) {
                this.sessionListeners.delete(sessionId)
            }
        }

        // 從 TranscriptManager 移除
        transcriptManager.removeListener(sessionId, callback)
    }

    /**
     * 檢查連接狀態
     */
    isConnected(sessionId: string): boolean {
        return transcriptManager.isConnected(sessionId)
    }

    /**
     * 清除逐字稿
     *
     * 注意：此方法不會清除 TranscriptManager 中的數據，
     * 因為 TranscriptManager 是無狀態的，只負責 WebSocket 連接。
     * 實際的逐字稿數據應該由狀態管理層處理。
     */
    clearTranscripts(sessionId: string): void {
        this.logInfo(`清除逐字稿: ${sessionId}`)
        // TranscriptManager 不儲存逐字稿數據，這個方法主要用於觸發狀態清除
        // 實際的清除邏輯應該在狀態管理層實現
    }

    /**
     * 取得服務狀態資訊
     */
    getServiceInfo(): TranscriptServiceInfo {
        return {
            serviceName: this.serviceName,
            isInitialized: this.isInitialized,
            isRunning: this.isRunning,
            connectedSessions: Array.from(this.connectedSessions),
            activeListeners: Object.fromEntries(
                Array.from(this.sessionListeners.entries()).map(([sessionId, listeners]) => [
                    sessionId,
                    listeners.size
                ])
            ),
            totalConnections: this.connectedSessions.size,
            transcriptManagerConnections: transcriptManager.getConnectionCount()
        }
    }
}
