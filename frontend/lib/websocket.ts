"use client"

import { getWebSocketURL } from './api'

// WebSocket 連接狀態
export type WebSocketState = 'connecting' | 'connected' | 'disconnected' | 'error'

// 逐字稿接收介面 (與後端推送格式一致)
export interface TranscriptMessage {
  type: 'transcript_segment' | 'transcript_complete' | 'connection_established' | 'heartbeat_ack' | 'pong' | 'active' | 'error' | 'transcription_error'
  session_id?: string
  segment_id?: string
  text?: string
  message?: string  // 用於連接確認訊息或完成通知
  start_sequence?: number
  end_sequence?: number
  start_time?: number
  end_time?: number
  language?: string
  confidence?: number
  timestamp?: number
  phase?: 'waiting' | 'active'  // 新增 phase 欄位
  error_type?: string
  error_message?: string
  details?: any
}

// ACK/Missing 訊息介面
export interface AckMissingMessage {
  ack: number
  missing: number[]
}

// WebSocket 管理類別
export class WebSocketManager {
  private ws: WebSocket | null = null
  private url: string
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private isManualClose = false

  constructor(url: string) {
    this.url = url
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url)
        this.isManualClose = false

        this.ws.onopen = () => {
          console.log('✅ WebSocket 連接成功:', this.url)
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket 連接錯誤:', error)
          reject(error)
        }

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket 連接關閉:', event.code, event.reason)

          if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`🔄 嘗試重新連接 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

            setTimeout(() => {
              this.connect()
            }, this.reconnectDelay * this.reconnectAttempts)
          }
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  disconnect(): void {
    this.isManualClose = true
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(data: string | ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    } else {
      console.warn('⚠️ WebSocket 未連接，無法發送資料')
    }
  }

  onMessage(callback: (event: MessageEvent) => void): void {
    if (this.ws) {
      this.ws.onmessage = callback
    }
  }

  onClose(callback: (event: CloseEvent) => void): void {
    if (this.ws) {
      const originalOnClose = this.ws.onclose
      const ws = this.ws // 保存引用避免 null 問題
      this.ws.onclose = (event) => {
        // 先調用新的回調
        callback(event)
        // 再調用原始的處理器
        if (originalOnClose) {
          originalOnClose.call(ws, event)
        }
      }
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}

// 音檔上傳 WebSocket 管理
export class AudioUploadWebSocket extends WebSocketManager {
  private sequenceNumber = 0

  constructor(sessionId: string) {
    super(getWebSocketURL(`/ws/upload_audio/${sessionId}`))
  }

  uploadAudioChunk(audioBlob: Blob): void {
    if (!this.isConnected) {
      console.warn('⚠️ WebSocket 未連接，無法上傳音檔')
      return
    }

    // 建立包含序號的資料包
    const sequenceBuffer = new ArrayBuffer(4)
    const sequenceView = new DataView(sequenceBuffer)
    sequenceView.setUint32(0, this.sequenceNumber, true) // little-endian

    // 合併序號和音檔資料
    audioBlob.arrayBuffer().then(audioBuffer => {
      const combinedBuffer = new ArrayBuffer(sequenceBuffer.byteLength + audioBuffer.byteLength)
      const combinedView = new Uint8Array(combinedBuffer)

      combinedView.set(new Uint8Array(sequenceBuffer), 0)
      combinedView.set(new Uint8Array(audioBuffer), sequenceBuffer.byteLength)

      this.send(combinedBuffer)
      console.log(`📤 上傳音檔切片 #${this.sequenceNumber}, 大小: ${audioBlob.size} bytes`)

      this.sequenceNumber++
    })
  }

  onAckMissing(callback: (data: AckMissingMessage) => void): void {
    this.onMessage((event) => {
      try {
        const message = JSON.parse(event.data)

        // 根據消息類型進行分發
        switch (message.type) {
          case 'ack_missing':
            // 確認 data.missing 存在且是陣列
            if (message.missing && Array.isArray(message.missing)) {
              callback(message as AckMissingMessage)
            } else {
              console.error('❌ 收到的 ack_missing 訊息格式不正確:', message)
            }
            break
          case 'ack':
            // 處理音檔切片確認訊息
            console.log('✅ 音檔切片確認:', message.chunk_sequence || 'unknown')
            break
          case 'heartbeat_ack':
            // 處理音檔上傳心跳確認
            console.log('💓 音檔上傳心跳確認')
            break
          case 'connection_established':
            console.log('✅ 音檔上傳 WebSocket 連接已建立')
            break
          case 'error':
            console.error('❌ 音檔上傳服務端錯誤:', message.message)
            break
          default:
            console.warn('⚠️ 收到未知的音檔上傳訊息類型:', message.type)
        }
      } catch (error) {
        console.error('❌ 解析音檔上傳服務訊息失敗:', error)
      }
    })
  }

  resetSequence(): void {
    this.sequenceNumber = 0
  }
}

// 逐字稿接收 WebSocket 管理 - 簡化版，只負責基礎連接
export class TranscriptWebSocket extends WebSocketManager {
  constructor(sessionId: string) {
    super(getWebSocketURL(`/ws/transcript_feed/${sessionId}`))
  }

  // 設定訊息處理回調
  onMessage(callback: (data: any) => void): void {
    super.onMessage((event) => {
      try {
        const data = JSON.parse(event.data)
        callback(data)
      } catch (error) {
        console.error('❌ TranscriptWebSocket 解析訊息失敗:', error)
      }
    })
  }

  // 發送 JSON 訊息
  sendJson(message: any): void {
    if (this.isConnected) {
      this.send(JSON.stringify(message))
    }
  }
}

// WebSocket 工廠函數
export const createAudioUploadWebSocket = (sessionId: string): AudioUploadWebSocket => {
  return new AudioUploadWebSocket(sessionId)
}

export const createTranscriptWebSocket = (sessionId: string): TranscriptWebSocket => {
  return new TranscriptWebSocket(sessionId)
}
