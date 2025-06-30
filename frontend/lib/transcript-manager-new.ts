"use client"

import { TranscriptWebSocket } from './websocket'
import { useAppStore } from './app-store-zustand'
import type { TranscriptEntry } from '../types/app-state'
import {
    TranscriptSegmentMessage,
    TranscriptCompleteMessage,
    ErrorMessage,
    TranscriptionErrorMessage,
    ConnectionEstablishedMessage,
    HeartbeatAckMessage,
    PongMessage,
    PhaseMessage
} from '../types/websocket-messages'

/**
 * TranscriptManager - 型別安全的逐字稿管理器
 *
 * 重構特色：
 * ✅ 使用 TypeScript discriminated union
 * ✅ 事件驅動架構替代 handleMessage 巨型方法
 * ✅ 型別安全的事件處理器
 * ✅ 移除 WebSocketManager hack
 */
export class TranscriptManager {
    private static instance: TranscriptManager | null = null
    private connections: Map<string, TranscriptWebSocket> = new Map()
    private connectionStates: Map<string, boolean> = new Map()
    private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map()
    private reconnectAttempts: Map<string, number> = new Map()
    private maxReconnectAttempts = 5
    private heartbeatInterval = 10000 // 10秒
    private reconnectDelay = 2000 // 2秒

    private constructor() {
        // Singleton pattern
        if (typeof window !== 'undefined') {
            (window as any).transcriptManager = this
        }
    }

    static getInstance(): TranscriptManager {
        if (!TranscriptManager.instance) {
            TranscriptManager.instance = new TranscriptManager()
        }
        return TranscriptManager.instance
    }

    /* ============================================================
     * 核心連接管理
     * ============================================================ */

    async connect(sessionId: string): Promise<void> {
        console.log(`🔗 [TranscriptManager] 連接會話: ${sessionId}`)

        // 檢查是否已有連接
        if (this.connections.has(sessionId) && this.isConnected(sessionId)) {
            console.log(`✅ [TranscriptManager] 會話 ${sessionId} 已連接`)
            return
        }

        // 清理舊連接
        if (this.connections.has(sessionId)) {
            await this.disconnect(sessionId)
        }

        try {
            await this.establishConnection(sessionId)
            console.log(`✅ [TranscriptManager] 會話 ${sessionId} 連接成功`)
        } catch (error) {
            console.error(`❌ [TranscriptManager] 會話 ${sessionId} 連接失敗:`, error)
            throw error
        }
    }

    async disconnect(sessionId: string): Promise<void> {
        console.log(`📱 [TranscriptManager] 斷開會話: ${sessionId}`)

        // 停止心跳
        this.stopHeartbeat(sessionId)

        // 斷開 WebSocket
        const ws = this.connections.get(sessionId)
        if (ws) {
            ws.disconnect()
            this.connections.delete(sessionId)
        }

        // 清理狀態
        this.connectionStates.set(sessionId, false)
        this.reconnectAttempts.delete(sessionId)
    }

    /* ============================================================
     * 私有方法：連接建立和事件綁定
     * ============================================================ */

    private async establishConnection(sessionId: string): Promise<void> {
        const ws = new TranscriptWebSocket(sessionId)

        // ✅ 使用型別安全的事件綁定（移除 hack）
        this.bindWebSocketEvents(ws, sessionId)

        // 設定關閉處理
        ws.onClose((event) => {
            console.log(`🔌 [TranscriptManager] 會話 ${sessionId} 連接關閉:`, event.code, event.reason)
            this.connectionStates.set(sessionId, false)
            this.stopHeartbeat(sessionId)

            // 如果不是手動關閉，嘗試重連
            if (event.code !== 1000) {
                this.scheduleReconnect(sessionId)
            }
        })

        // 建立連接
        await ws.connect()

        // 保存連接
        this.connections.set(sessionId, ws)
        this.connectionStates.set(sessionId, true)

        // 啟動心跳和初始化
        this.sendPing(sessionId)
        this.startHeartbeat(sessionId)
    }

    private bindWebSocketEvents(ws: TranscriptWebSocket, sessionId: string): void {
        console.log(`🎯 [TranscriptManager] 綁定事件處理器: ${sessionId}`)

        // ✅ 型別安全的事件監聽器
        ws.on('transcript_segment', (msg) => this.handleTranscriptSegment(sessionId, msg))
        ws.on('connection_established', (msg) => this.handleConnectionEstablished(sessionId, msg))
        ws.on('transcript_complete', (msg) => this.handleTranscriptComplete(sessionId, msg))
        ws.on('heartbeat_ack', (msg) => this.handleHeartbeatAck(sessionId, msg))
        ws.on('pong', (msg) => this.handlePong(sessionId, msg))
        ws.on('error', (msg) => this.handleError(sessionId, msg))
        ws.on('transcription_error', (msg) => this.handleTranscriptionError(sessionId, msg))
        ws.on('phase', (msg) => this.handlePhase(sessionId, msg))
    }

    /* ============================================================
     * 型別安全的事件處理器（取代巨型 handleMessage）
     * ============================================================ */

    private handleTranscriptSegment(sessionId: string, msg: TranscriptSegmentMessage): void {
        console.log('📝 [TranscriptManager] 收到逐字稿片段:', {
            sessionId,
            text: msg.text.substring(0, 50) + '...',
            start_time: msg.start_time,
            end_time: msg.end_time,
            confidence: msg.confidence
        })

        // 轉換為 UI 格式並推送到 store
        // 使用 start_time 並轉換為 HH:MM:SS 格式
        const startTimeInSeconds = msg.start_time ?? 0
        const hours = Math.floor(startTimeInSeconds / 3600)
        const minutes = Math.floor((startTimeInSeconds % 3600) / 60)
        const seconds = Math.floor(startTimeInSeconds % 60)

        const entry: TranscriptEntry = {
            time: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`,
            text: msg.text
        }

        console.log('🎯 [TranscriptManager] 推送到 store:', entry)
        useAppStore.getState().addTranscriptEntry(entry)

        // 檢查狀態轉換
        const currentState = useAppStore.getState()
        console.log('📊 [TranscriptManager] Store 狀態:', {
            appState: currentState.appState,
            transcriptCount: currentState.transcriptEntries.length
        })
    }

    private handleConnectionEstablished(sessionId: string, msg: ConnectionEstablishedMessage): void {
        console.log('✅ [TranscriptManager] 連接已建立:', {
            sessionId,
            message: msg.message,
            timestamp: msg.timestamp
        })
    }

    private handleTranscriptComplete(sessionId: string, msg: TranscriptCompleteMessage): void {
        console.log('🎯 [TranscriptManager] 轉錄完成:', {
            sessionId,
            message: msg.message,
            timestamp: msg.timestamp
        })
        // 可以在這裡觸發完成狀態或通知
    }

    private handleHeartbeatAck(sessionId: string, msg: HeartbeatAckMessage): void {
        console.log('💓 [TranscriptManager] 心跳確認:', {
            sessionId,
            timestamp: msg.timestamp
        })
    }

    private handlePong(sessionId: string, msg: PongMessage): void {
        console.log('🏓 [TranscriptManager] Pong 回應:', {
            sessionId,
            timestamp: msg.timestamp
        })
    }

    private handleError(sessionId: string, msg: ErrorMessage): void {
        console.error('🚨 [TranscriptManager] 收到錯誤:', {
            sessionId,
            error_type: msg.error_type,
            error_message: msg.error_message,
            details: msg.details
        })
        // 可以在這裡觸發錯誤處理邏輯
    }

    private handleTranscriptionError(sessionId: string, msg: TranscriptionErrorMessage): void {
        console.error('🚨 [TranscriptManager] 轉錄錯誤:', {
            sessionId,
            error_type: msg.error_type,
            error_message: msg.error_message
        })
    }

    private handlePhase(sessionId: string, msg: PhaseMessage): void {
        console.log(`📍 [TranscriptManager] 相位變更: ${msg.phase}`, {
            sessionId,
            phase: msg.phase
        })

        // 🎯 根據 phase 更新應用狀態
        if (msg.phase === 'active') {
            console.log('✅ [TranscriptManager] 收到 active phase，切換到 recording_active')
            useAppStore.getState().setState('recording_active')
        } else if (msg.phase === 'waiting') {
            console.log('⏳ [TranscriptManager] 收到 waiting phase，保持 recording_waiting')
            useAppStore.getState().setState('recording_waiting')
        }
    }

    /* ============================================================
     * 心跳和重連機制
     * ============================================================ */

    private sendPing(sessionId: string): void {
        const ws = this.connections.get(sessionId)
        if (ws && ws.isConnected) {
            ws.sendJson({ type: 'ping' })
            console.log(`🏓 [TranscriptManager] 發送 ping: ${sessionId}`)
        }
    }

    private sendHeartbeat(sessionId: string): void {
        const ws = this.connections.get(sessionId)
        if (ws && ws.isConnected) {
            try {
                ws.sendJson({
                    type: 'heartbeat',
                    timestamp: Date.now()
                })
                console.log(`💓 [TranscriptManager] 發送心跳: ${sessionId}`)
            } catch (error) {
                console.error(`❌ [TranscriptManager] 心跳失敗 ${sessionId}:`, error)
                this.connectionStates.set(sessionId, false)
                this.scheduleReconnect(sessionId)
            }
        }
    }

    private startHeartbeat(sessionId: string): void {
        this.stopHeartbeat(sessionId)

        const interval = setInterval(() => {
            this.sendHeartbeat(sessionId)
        }, this.heartbeatInterval)

        this.heartbeatIntervals.set(sessionId, interval)
        console.log(`💓 [TranscriptManager] 啟動心跳: ${sessionId}`)
    }

    private stopHeartbeat(sessionId: string): void {
        const interval = this.heartbeatIntervals.get(sessionId)
        if (interval) {
            clearInterval(interval)
            this.heartbeatIntervals.delete(sessionId)
            console.log(`💓 [TranscriptManager] 停止心跳: ${sessionId}`)
        }
    }

    private scheduleReconnect(sessionId: string): void {
        const attempts = this.reconnectAttempts.get(sessionId) ?? 0

        if (attempts >= this.maxReconnectAttempts) {
            console.error(`❌ [TranscriptManager] 重連次數已達上限: ${sessionId}`)
            return
        }

        this.reconnectAttempts.set(sessionId, attempts + 1)
        const delay = this.reconnectDelay * Math.pow(2, attempts)

        console.log(`🔄 [TranscriptManager] 排程重連: ${sessionId} (${attempts + 1}/${this.maxReconnectAttempts}) ${delay}ms`)

        setTimeout(async () => {
            try {
                await this.establishConnection(sessionId)
                this.reconnectAttempts.set(sessionId, 0)
                console.log(`✅ [TranscriptManager] 重連成功: ${sessionId}`)
            } catch (error) {
                console.error(`❌ [TranscriptManager] 重連失敗: ${sessionId}`, error)
            }
        }, delay)
    }

    /* ============================================================
 * 向後兼容方法（支援舊的 API）
 * ============================================================ */

    /**
     * @deprecated 舊 API 兼容性 - 請使用事件驅動方式
     */
    addListener(sessionId: string, callback: (message: any) => void): void {
        console.warn('⚠️ [TranscriptManager] addListener 已棄用，請使用事件驅動方式')
        // 為了兼容性，暫時保留但不實作
    }

    /**
     * @deprecated 舊 API 兼容性 - 請使用事件驅動方式
     */
    removeListener(sessionId: string, callback: (message: any) => void): void {
        console.warn('⚠️ [TranscriptManager] removeListener 已棄用，請使用事件驅動方式')
        // 為了兼容性，暫時保留但不實作
    }

    /* ============================================================
     * 公共工具方法
     * ============================================================ */

    isConnected(sessionId: string): boolean {
        const ws = this.connections.get(sessionId)
        const actualConnected = ws?.isConnected ?? false

        // 同步狀態
        const stateConnected = this.connectionStates.get(sessionId) ?? false
        if (stateConnected !== actualConnected) {
            this.connectionStates.set(sessionId, actualConnected)
        }

        return actualConnected
    }

    getConnectionCount(): number {
        return Array.from(this.connections.values()).filter(ws => ws.isConnected).length
    }

    async disconnectAll(): Promise<void> {
        console.log('📱 [TranscriptManager] 清理所有連接')
        const sessionIds = Array.from(this.connections.keys())
        await Promise.all(sessionIds.map(sessionId => this.disconnect(sessionId)))
    }
}

// 匯出 Singleton 實例
export const transcriptManager = TranscriptManager.getInstance()
