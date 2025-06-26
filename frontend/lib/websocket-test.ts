// WebSocket 測試工具
// 用於驗證逐字稿接收功能

import { TranscriptWebSocket } from './websocket'

export class WebSocketTester {
    private transcriptWs: TranscriptWebSocket | null = null
    private receivedMessages: any[] = []

    async testTranscriptConnection(sessionId: string): Promise<boolean> {
        console.log('🧪 開始測試逐字稿 WebSocket 連接...')

        try {
            // 建立連接
            this.transcriptWs = new TranscriptWebSocket(sessionId)

            // 設定訊息接收處理
            this.transcriptWs.onTranscript((data) => {
                this.receivedMessages.push(data)
                console.log('📝 測試收到逐字稿:', data)
            })

            // 連接
            await this.transcriptWs.connect()
            console.log('✅ WebSocket 連接成功')

            // 發送測試心跳
            setTimeout(() => {
                if (this.transcriptWs) {
                    this.transcriptWs.sendHeartbeat()
                    console.log('💓 發送測試心跳')
                }
            }, 1000)

            // 發送測試 ping
            setTimeout(() => {
                if (this.transcriptWs) {
                    this.transcriptWs.sendPing()
                    console.log('🏓 發送測試 ping')
                }
            }, 2000)

            return true

        } catch (error) {
            console.error('❌ WebSocket 連接測試失敗:', error)
            return false
        }
    }

    getReceivedMessages(): any[] {
        return [...this.receivedMessages]
    }

    disconnect(): void {
        if (this.transcriptWs) {
            this.transcriptWs.disconnect()
            this.transcriptWs = null
        }
        console.log('🔌 WebSocket 測試連接已斷開')
    }

    clearMessages(): void {
        this.receivedMessages = []
        console.log('🔄 已清除接收的訊息')
    }

    getConnectionStatus(): string {
        if (!this.transcriptWs) return 'not_initialized'

        switch (this.transcriptWs.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting'
            case WebSocket.OPEN:
                return 'connected'
            case WebSocket.CLOSING:
                return 'closing'
            case WebSocket.CLOSED:
                return 'closed'
            default:
                return 'unknown'
        }
    }
}

// 全域測試實例
let globalTester: WebSocketTester | null = null

export const getWebSocketTester = (): WebSocketTester => {
    if (!globalTester) {
        globalTester = new WebSocketTester()
    }
    return globalTester
}

// 清理測試資源
export const cleanupWebSocketTester = (): void => {
    if (globalTester) {
        globalTester.disconnect()
        globalTester = null
    }
}
