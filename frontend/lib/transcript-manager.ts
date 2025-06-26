"use client"

import { TranscriptWebSocket, TranscriptMessage } from './websocket'

/**
 * TranscriptManager - 統一管理 transcript WebSocket 連接的 Singleton
 *
 * 功能：
 * - 確保每個 session 只有一個 transcript 連接
 * - 統一管理連接狀態、心跳、重連
 * - 提供簡潔的 API 給其他組件使用
 */
class TranscriptManager {
  private static instance: TranscriptManager | null = null
  private connections: Map<string, TranscriptWebSocket> = new Map()
  private listeners: Map<string, Set<(message: TranscriptMessage) => void>> = new Map()
  private connectionStates: Map<string, boolean> = new Map()
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map()
  private reconnectAttempts: Map<string, number> = new Map()
  private maxReconnectAttempts = 5
  private heartbeatInterval = 10000 // 10秒，避免伺服器過早判定逾時
  private reconnectDelay = 2000 // 2秒

  private constructor() {
    // Singleton pattern - 私有建構子

    // 開發模式下將實例掛到全域以利除錯
    if (typeof window !== 'undefined') {
      // @ts-ignore
      ; (window as any).transcriptManager = this
    }
  }

  /**
   * 取得 TranscriptManager 實例
   */
  static getInstance(): TranscriptManager {
    if (!TranscriptManager.instance) {
      TranscriptManager.instance = new TranscriptManager()
    }
    return TranscriptManager.instance
  }

  /**
   * 連接到指定 session 的 transcript feed
   */
  async connect(sessionId: string): Promise<void> {
    // 如果已經有連接，直接返回
    if (this.connections.has(sessionId) && this.connectionStates.get(sessionId)) {
      console.log(`📱 TranscriptManager: Session ${sessionId} 已連接，跳過重複連接`)
      return
    }

    try {
      console.log(`📱 TranscriptManager: 開始連接 session ${sessionId}`)

      // 清理舊連接（如果存在）
      await this.disconnect(sessionId)

      // 重置重連計數
      this.reconnectAttempts.set(sessionId, 0)

      // 建立新連接
      await this.establishConnection(sessionId)

    } catch (error) {
      console.error(`❌ TranscriptManager: Session ${sessionId} 連接失敗:`, error)
      this.connectionStates.set(sessionId, false)

      // 嘗試重連
      this.scheduleReconnect(sessionId)
      throw error
    }
  }

  /**
   * 建立 WebSocket 連接
   */
  private async establishConnection(sessionId: string): Promise<void> {
    const ws = new TranscriptWebSocket(sessionId)

    // 設定訊息處理
    ws.onMessage((message) => {
      this.handleMessage(sessionId, message)
    })

    // 設定連接關閉處理
    this.setupConnectionHandlers(ws, sessionId)

    // 連接 WebSocket
    await ws.connect()

    // 儲存連接
    this.connections.set(sessionId, ws)
    this.connectionStates.set(sessionId, true)

    // 發送初始 ping 啟動後端處理循環
    this.sendPing(sessionId)

    // 啟動心跳
    this.startHeartbeat(sessionId)

    console.log(`✅ TranscriptManager: Session ${sessionId} 連接成功`)
  }

  /**
* 設定連接處理器
*/
  private setupConnectionHandlers(ws: TranscriptWebSocket, sessionId: string): void {
    // 監聽 WebSocket 關閉事件
    ws.onClose((event) => {
      console.log(`🔌 TranscriptManager: Session ${sessionId} 連接關閉:`, event.code, event.reason)

      // 更新狀態
      this.connectionStates.set(sessionId, false)
      this.stopHeartbeat(sessionId)

      // 如果不是手動關閉，嘗試重連
      if (event.code !== 1000) { // 1000 = 正常關閉
        this.scheduleReconnect(sessionId)
      }
    })
  }

  /**
   * 處理收到的訊息
   */
  private handleMessage(sessionId: string, message: any): void {
    // 處理不同類型的訊息
    if (message.type === 'transcript_segment') {
      console.log('📝 TranscriptManager 收到逐字稿片段:', message.text?.substring(0, 50) + '...')
      this.broadcastToListeners(sessionId, message)
    } else if (message.type === 'connection_established') {
      console.log('✅ TranscriptManager 連接已建立:', message.message)
    } else if (message.type === 'transcript_complete') {
      console.log('🎯 TranscriptManager 轉錄完成:', message.message)
      this.broadcastToListeners(sessionId, message)
    } else if (message.type === 'heartbeat_ack') {
      console.log('💓 TranscriptManager 收到心跳回應')
    } else if (message.type === 'pong') {
      console.log('🏓 TranscriptManager 收到 pong 回應')
    } else {
      console.log('📨 TranscriptManager 收到其他訊息:', message)
    }
  }

  /**
   * 廣播訊息給所有監聽器
   */
  private broadcastToListeners(sessionId: string, message: TranscriptMessage): void {
    const sessionListeners = this.listeners.get(sessionId)
    if (sessionListeners) {
      sessionListeners.forEach(callback => {
        try {
          callback(message)
        } catch (error) {
          console.error(`❌ TranscriptManager: 監聽器回調錯誤:`, error)
        }
      })
    }
  }

  /**
   * 發送 ping
   */
  private sendPing(sessionId: string): void {
    const ws = this.connections.get(sessionId)
    if (ws && ws.isConnected) {
      ws.sendJson({ type: 'ping' })
      console.log(`🏓 TranscriptManager: 向 session ${sessionId} 發送 ping`)
    }
  }

  /**
   * 發送心跳
   */
  private sendHeartbeat(sessionId: string): void {
    const ws = this.connections.get(sessionId)
    if (ws && ws.isConnected) {
      ws.sendJson({
        type: 'heartbeat',
        timestamp: Date.now()
      })
      console.log(`💓 TranscriptManager: 向 session ${sessionId} 發送心跳`)
    } else {
      // 連接已斷開，停止心跳並嘗試重連
      this.stopHeartbeat(sessionId)
      this.connectionStates.set(sessionId, false)
      this.scheduleReconnect(sessionId)
    }
  }

  /**
   * 啟動心跳機制
   */
  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat(sessionId)

    const interval = setInterval(() => {
      this.sendHeartbeat(sessionId)
    }, this.heartbeatInterval)

    this.heartbeatIntervals.set(sessionId, interval)
    console.log(`💓 TranscriptManager: 為 session ${sessionId} 啟動心跳`)
  }

  /**
   * 停止心跳機制
   */
  private stopHeartbeat(sessionId: string): void {
    const interval = this.heartbeatIntervals.get(sessionId)
    if (interval) {
      clearInterval(interval)
      this.heartbeatIntervals.delete(sessionId)
      console.log(`💓 TranscriptManager: 為 session ${sessionId} 停止心跳`)
    }
  }

  /**
   * 安排重連
   */
  private scheduleReconnect(sessionId: string): void {
    const attempts = this.reconnectAttempts.get(sessionId) ?? 0

    if (attempts >= this.maxReconnectAttempts) {
      console.error(`❌ TranscriptManager: Session ${sessionId} 重連次數已達上限`)
      return
    }

    this.reconnectAttempts.set(sessionId, attempts + 1)

    const delay = this.reconnectDelay * Math.pow(2, attempts) // 指數退避
    console.log(`🔄 TranscriptManager: Session ${sessionId} 將在 ${delay}ms 後重連 (第 ${attempts + 1} 次)`)

    setTimeout(async () => {
      try {
        await this.establishConnection(sessionId)
        this.reconnectAttempts.set(sessionId, 0) // 重連成功，重置計數
      } catch (error) {
        console.error(`❌ TranscriptManager: Session ${sessionId} 重連失敗:`, error)
      }
    }, delay)
  }

  /**
   * 斷開指定 session 的連接
   */
  async disconnect(sessionId: string): Promise<void> {
    console.log(`📱 TranscriptManager: 斷開 session ${sessionId}`)

    // 停止心跳
    this.stopHeartbeat(sessionId)

    // 斷開 WebSocket
    const ws = this.connections.get(sessionId)
    if (ws) {
      ws.disconnect()
      this.connections.delete(sessionId)
    }

    // 更新狀態
    this.connectionStates.set(sessionId, false)

    // 清理監聽器
    this.listeners.delete(sessionId)

    // 清理重連計數
    this.reconnectAttempts.delete(sessionId)
  }

  /**
   * 添加訊息監聽器
   */
  addListener(sessionId: string, callback: (message: TranscriptMessage) => void): void {
    if (!this.listeners.has(sessionId)) {
      this.listeners.set(sessionId, new Set())
    }
    this.listeners.get(sessionId)!.add(callback)
    console.log(`📱 TranscriptManager: 為 session ${sessionId} 添加監聽器`)
  }

  /**
   * 移除訊息監聽器
   */
  removeListener(sessionId: string, callback: (message: TranscriptMessage) => void): void {
    const sessionListeners = this.listeners.get(sessionId)
    if (sessionListeners) {
      sessionListeners.delete(callback)
      if (sessionListeners.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
    console.log(`📱 TranscriptManager: 為 session ${sessionId} 移除監聽器`)
  }

  /**
   * 檢查連接狀態
   */
  isConnected(sessionId: string): boolean {
    const ws = this.connections.get(sessionId)
    const stateConnected = this.connectionStates.get(sessionId) ?? false
    const wsConnected = ws?.isConnected ?? false

    // 雙重檢查確保狀態一致
    if (stateConnected !== wsConnected) {
      this.connectionStates.set(sessionId, wsConnected)
      return wsConnected
    }

    return stateConnected
  }

  /**
   * 取得連接數量
   */
  getConnectionCount(): number {
    return Array.from(this.connections.values()).filter(ws => ws.isConnected).length
  }

  /**
   * 清理所有連接
   */
  async disconnectAll(): Promise<void> {
    console.log('📱 TranscriptManager: 清理所有連接')

    const sessionIds = Array.from(this.connections.keys())
    await Promise.all(sessionIds.map(sessionId => this.disconnect(sessionId)))
  }
}

// 匯出 Singleton 實例
export const transcriptManager = TranscriptManager.getInstance()

// 匯出類型
export type { TranscriptMessage }
