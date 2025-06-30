"use client"

import { BaseService } from './base-service'
import { ITranscriptService, TranscriptMessage } from './interfaces'
import { getTranscriptManager, type ITranscriptManager } from '../transcript-manager-adapter'

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
    implementationType: 'refactored' | 'legacy'
}

/**
 * TranscriptService - 適配器版本
 *
 * 使用 TranscriptManager 適配器，根據功能旗標自動選擇實現：
 * - 新的重構實現（transcript-manager-new.ts）
 * - 舊的實現（transcript-manager.ts）
 */
export class TranscriptServiceAdapted extends BaseService implements ITranscriptService {
    protected readonly serviceName = 'TranscriptServiceAdapted'

    private connectedSessions: Set<string> = new Set()
    private sessionListeners: Map<string, Set<(message: TranscriptMessage) => void>> = new Map()
    private transcriptManager: ITranscriptManager | null = null

    /**
     * 取得 TranscriptManager 實例（根據功能旗標動態選擇）
     */
    private async getManager(): Promise<ITranscriptManager> {
        if (!this.transcriptManager) {
            this.transcriptManager = await getTranscriptManager()
            this.logInfo(`已載入 TranscriptManager (${this.getCurrentImplementationType()})`)
        }
        return this.transcriptManager
    }

    /**
 * 取得當前實現類型
 */
    private getCurrentImplementationType(): 'refactored' | 'legacy' {
        try {
            const { getCurrentImplementation } = require('../transcript-manager-adapter')
            return getCurrentImplementation()
        } catch (error) {
            console.warn('⚠️ [TranscriptServiceAdapted] 無法取得實現類型，預設為 legacy')
            return 'legacy'
        }
    }

    /**
     * 初始化服務
     */
    async initialize(): Promise<void> {
        this.logInfo('初始化逐字稿服務 (適配器版本)')

        // 預先載入 TranscriptManager 實例
        await this.getManager()
        this.logSuccess(`TranscriptManager 已載入 (${this.getCurrentImplementationType()})`)
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
        this.transcriptManager = null // 重置實例
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

            // 使用適配器獲取 TranscriptManager 並建立連接
            const manager = await this.getManager()
            await manager.connect(sessionId)

            // 記錄連接狀態
            this.connectedSessions.add(sessionId)

            this.logSuccess(`逐字稿服務連接成功: ${sessionId} (${this.getCurrentImplementationType()})`)
        } catch (error) {
            this.handleError(`逐字稿服務連接失敗: ${sessionId}`, error)
            throw error
        }
    }

    /**
     * 斷開逐字稿服務
     */
    async disconnect(sessionId?: string): Promise<void> {
        try {
            const manager = await this.getManager()

            if (sessionId) {
                this.logInfo(`斷開逐字稿服務: ${sessionId}`)

                // 移除所有監聽器（僅適用於舊實現）
                const listeners = this.sessionListeners.get(sessionId)
                if (listeners && (manager as any).removeListener) {
                    listeners.forEach(callback => {
                        (manager as any).removeListener(sessionId, callback)
                    })
                    this.sessionListeners.delete(sessionId)
                }

                // 斷開連接
                await manager.disconnect(sessionId)
                this.connectedSessions.delete(sessionId)

                this.logSuccess(`逐字稿服務斷開成功: ${sessionId}`)
            } else {
                // 斷開所有連接
                this.logInfo('斷開所有逐字稿服務連接')
                await manager.disconnectAll()
                this.connectedSessions.clear()
                this.sessionListeners.clear()
            }
        } catch (error) {
            this.handleError(`斷開逐字稿服務失敗: ${sessionId || 'all'}`, error)
            throw error
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

        // 為兼容性，嘗試添加監聽器（舊實現）
        this.getManager().then(manager => {
            if ((manager as any).addListener && typeof (manager as any).addListener === 'function') {
                try {
                    (manager as any).addListener(sessionId, callback)
                    this.logInfo(`已添加監聽器 (legacy API): ${sessionId}`)
                } catch (error) {
                    this.logWarning('舊實現 addListener 調用失敗:', error)
                }
            } else {
                // 新實現使用事件驅動，不需要手動添加監聽器
                this.logInfo('新實現使用事件驅動方式，無需手動添加監聽器')
            }
        }).catch(error => {
            this.logWarning('添加監聽器時發生錯誤:', error)
        })
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

        // 只有舊實現才支援 removeListener 方法
        this.getManager().then(manager => {
            if ((manager as any).removeListener) {
                (manager as any).removeListener(sessionId, callback)
            }
        })
    }

    /**
     * 檢查連接狀態
     */
    isConnected(sessionId: string): boolean {
        if (!this.transcriptManager) return false
        return this.transcriptManager.isConnected(sessionId)
    }

    /**
     * 清除逐字稿
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
            transcriptManagerConnections: this.transcriptManager?.getConnectionCount() || 0,
            implementationType: this.getCurrentImplementationType()
        }
    }

    /**
     * 強制重新載入 TranscriptManager（用於功能旗標變更後）
     */
    async reloadManager(): Promise<void> {
        this.logInfo('重新載入 TranscriptManager')

        // 先斷開所有連接
        await this.cleanup()

        // 重新初始化
        await this.initialize()

        this.logSuccess(`TranscriptManager 已重新載入 (${this.getCurrentImplementationType()})`)
    }
}
