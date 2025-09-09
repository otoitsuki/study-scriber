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
      // 添加連接超時機制（5秒）
      const timeout = setTimeout(() => {
        console.error('❌ WebSocket 連接超時:', this.url)
        if (this.ws) {
          this.ws.close()
        }
        reject(new Error(`WebSocket connection timeout after 5 seconds: ${this.url}`))
      }, 5000)

      try {
        this.ws = new WebSocket(this.url)
        this.isManualClose = false

        this.ws.onopen = () => {
          console.log('✅ WebSocket 連接成功:', this.url)
          clearTimeout(timeout)
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket 連接錯誤:', error)
          clearTimeout(timeout)
          reject(error)
        }

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket 連接關閉:', event.code, event.reason)
          clearTimeout(timeout)

          if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`🔄 嘗試重新連接 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

            setTimeout(() => {
              this.connect()
            }, this.reconnectDelay * this.reconnectAttempts)
          }
        }
      } catch (error) {
        clearTimeout(timeout)
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
      const dataInfo = data instanceof ArrayBuffer
        ? `Binary (${data.byteLength} bytes)`
        : `Text (${data.length} chars)`

      console.log('📡 [WebSocketManager] 發送資料', {
        type: dataInfo,
        url: this.url,
        readyState: this.ws.readyState,
        timestamp: new Date().toISOString()
      })

      this.ws.send(data)
    } else {
      console.warn('⚠️ WebSocket 未連接，無法發送資料', {
        url: this.url,
        readyState: this.ws?.readyState || 'null'
      })
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
    console.log('🔊 [AudioUploadWebSocket] uploadAudioChunk 被調用', {
      sequence: this.sequenceNumber,
      blobSize: audioBlob.size,
      wsState: this.readyState,
      isConnected: this.isConnected
    })

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

      console.log('🔄 [AudioUploadWebSocket] 準備發送 binary frame', {
        sequence: this.sequenceNumber,
        totalSize: combinedBuffer.byteLength,
        audioSize: audioBuffer.byteLength,
        sequenceSize: sequenceBuffer.byteLength
      })

      this.send(combinedBuffer)

      console.log(`✅ [AudioUploadWebSocket] Binary frame 已送出 #${this.sequenceNumber}`, {
        size: `${audioBlob.size} bytes`,
        totalSize: `${combinedBuffer.byteLength} bytes`,
        timestamp: new Date().toISOString()
      })

      this.sequenceNumber++
    }).catch(error => {
      console.error('❌ [AudioUploadWebSocket] 處理音頻資料失敗', {
        sequence: this.sequenceNumber,
        error: error.message || error
      })
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
      console.log('🔥 [TranscriptWebSocket] 原始 WebSocket 訊息:', {
        data: event.data,
        type: typeof event.data,
        length: event.data?.length,
        timestamp: new Date().toISOString()
      })

      try {
        const data = JSON.parse(event.data)
        console.log('✅ [TranscriptWebSocket] JSON 解析成功:', {
          parsedData: data,
          dataType: data.type,
          sessionId: data.session_id
        })

        console.log('🎯 [TranscriptWebSocket] 即將調用 callback')
        callback(data)
        console.log('✅ [TranscriptWebSocket] callback 調用完成')

      } catch (error) {
        console.error('❌ TranscriptWebSocket 解析訊息失敗:', {
          error: error instanceof Error ? error.message : String(error),
          rawData: event.data
        })
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
