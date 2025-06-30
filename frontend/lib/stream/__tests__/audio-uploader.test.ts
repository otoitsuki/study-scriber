import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { AudioUploader } from '../audio-uploader'

// Mock WebSocket
class MockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    readyState: number = MockWebSocket.CONNECTING
    onopen: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null

    send = vi.fn()
    close = vi.fn()

    constructor(public url: string) {
        // 模擬異步連接
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN
            this.onopen?.(new Event('open'))
        }, 10)
    }

    // 模擬連接關閉
    simulateClose(wasClean: boolean = true, code: number = 1000, reason: string = '') {
        this.readyState = MockWebSocket.CLOSED
        const closeEvent = new CloseEvent('close', { wasClean, code, reason })
        this.onclose?.(closeEvent)
    }

    // 模擬收到消息
    simulateMessage(data: any) {
        const messageEvent = new MessageEvent('message', { data: JSON.stringify(data) })
        this.onmessage?.(messageEvent)
    }

    // 模擬錯誤
    simulateError() {
        this.onerror?.(new Event('error'))
    }
}

// Mock 全局 WebSocket
Object.defineProperty(global, 'WebSocket', {
    writable: true,
    value: MockWebSocket,
})

// Mock 環境變數
const originalEnv = process.env
beforeEach(() => {
    process.env = { ...originalEnv }
    process.env.NEXT_PUBLIC_WS_URL = 'ws://localhost:8000'
})

afterEach(() => {
    process.env = originalEnv
})

describe('AudioUploader', () => {
    let uploader: AudioUploader
    let mockWebSocket: MockWebSocket

    beforeEach(() => {
        vi.clearAllMocks()
        uploader = new AudioUploader()

        // 攔截 WebSocket 創建
        const originalWebSocket = global.WebSocket
        global.WebSocket = vi.fn((url: string) => {
            mockWebSocket = new MockWebSocket(url)
            return mockWebSocket
        }) as any
    })

    afterEach(() => {
        uploader.close()
    })

    describe('連接管理', () => {
        test('應該成功建立 WebSocket 連接', async () => {
            const connectPromise = uploader.connect('test-session-id')

            // 等待連接完成
            await connectPromise

            expect(uploader.isConnected).toBe(true)
            expect(uploader.currentSessionId).toBe('test-session-id')
            expect(uploader.currentSequence).toBe(0)
        })

        test('應該使用正確的 WebSocket URL', async () => {
            await uploader.connect('test-session-id')

            expect(global.WebSocket).toHaveBeenCalledWith(
                'ws://localhost:8000/ws/upload_audio/test-session-id'
            )
        })

        test('應該在連接時重置狀態', async () => {
            // 先發送一些數據來改變序號
            await uploader.connect('session-1')
            uploader.send(new Blob(['test']))

            expect(uploader.currentSequence).toBe(1)

            // 重新連接應該重置
            await uploader.connect('session-2')

            expect(uploader.currentSequence).toBe(0)
            expect(uploader.currentSessionId).toBe('session-2')
        })

        test('應該正確關閉連接', () => {
            uploader.close()

            expect(uploader.isConnected).toBe(false)
            expect(uploader.currentSessionId).toBe(null)
            expect(uploader.currentSequence).toBe(0)
        })
    })

    describe('數據傳送', () => {
        beforeEach(async () => {
            await uploader.connect('test-session-id')
        })

        test('應該正確發送音訊數據', () => {
            const testBlob = new Blob(['test audio data'], { type: 'audio/webm' })

            uploader.send(testBlob)

            // 應該發送兩次：序號 + 數據
            expect(mockWebSocket.send).toHaveBeenCalledTimes(2)

            // 驗證序號發送（4 字節）
            const sequenceCall = mockWebSocket.send.mock.calls[0][0]
            expect(sequenceCall).toBeInstanceOf(ArrayBuffer)
            expect(sequenceCall.byteLength).toBe(4)

            // 驗證數據發送
            const blobCall = mockWebSocket.send.mock.calls[1][0]
            expect(blobCall).toBe(testBlob)
        })

        test('應該正確遞增序號', () => {
            const blob1 = new Blob(['audio 1'])
            const blob2 = new Blob(['audio 2'])

            uploader.send(blob1)
            uploader.send(blob2)

            expect(uploader.currentSequence).toBe(2)
            expect(mockWebSocket.send).toHaveBeenCalledTimes(4) // 2 序號 + 2 數據
        })

        test('應該支援自訂序號發送', () => {
            const testBlob = new Blob(['test'])

            uploader.send(testBlob, 42)

            // 內部序號不應該改變
            expect(uploader.currentSequence).toBe(0)

            // 但應該發送指定的序號
            const sequenceCall = mockWebSocket.send.mock.calls[0][0]
            const view = new DataView(sequenceCall)
            expect(view.getUint32(0, false)).toBe(42) // big-endian
        })

        test('應該處理 WebSocket 未連接的情況', () => {
            mockWebSocket.readyState = MockWebSocket.CLOSED

            const testBlob = new Blob(['test'])
            uploader.send(testBlob)

            // 不應該發送任何數據
            expect(mockWebSocket.send).not.toHaveBeenCalled()
        })
    })

    describe('重連機制', () => {
        beforeEach(async () => {
            await uploader.connect('test-session-id')
        })

        test('應該在非正常關閉時嘗試重連', async () => {
            // 模擬非正常關閉
            mockWebSocket.simulateClose(false, 1006, 'Connection lost')

            // 等待重連邏輯觸發
            await new Promise(resolve => setTimeout(resolve, 100))

            // 應該嘗試重新創建 WebSocket
            expect(global.WebSocket).toHaveBeenCalledTimes(2)
        })

        test('應該在正常關閉時不嘗試重連', () => {
            const originalCreateWebSocket = global.WebSocket

            // 模擬正常關閉
            mockWebSocket.simulateClose(true, 1000, 'Normal closure')

            // 不應該嘗試重連
            expect(global.WebSocket).toHaveBeenCalledTimes(1)
        })

        test('應該有重連次數限制', async () => {
            // 模擬連續失敗的重連
            const originalConnect = uploader.connect
            let connectCallCount = 0

            uploader.connect = vi.fn().mockImplementation(() => {
                connectCallCount++
                if (connectCallCount <= 5) {
                    throw new Error('Connection failed')
                }
                return originalConnect.call(uploader, 'test-session-id')
            })

            // 觸發重連
            mockWebSocket.simulateClose(false, 1006, 'Connection lost')

            // 等待重連嘗試
            await new Promise(resolve => setTimeout(resolve, 200))

            // 應該有重連次數限制
            expect(connectCallCount).toBeLessThanOrEqual(5)
        })
    })

    describe('伺服器消息處理', () => {
        beforeEach(async () => {
            await uploader.connect('test-session-id')
        })

        test('應該處理 ACK 消息', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            mockWebSocket.simulateMessage({
                type: 'ack',
                chunk_sequence: 5
            })

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('音訊切片 #5 確認收到')
            )

            consoleSpy.mockRestore()
        })

        test('應該處理上傳錯誤消息', () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

            mockWebSocket.simulateMessage({
                type: 'upload_error',
                chunk_sequence: 3,
                error: 'Upload failed'
            })

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('上傳錯誤 #3'),
                'Upload failed'
            )

            consoleSpy.mockRestore()
        })

        test('應該處理連接建立消息', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            mockWebSocket.simulateMessage({
                type: 'connection_established'
            })

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('連接已建立')
            )

            consoleSpy.mockRestore()
        })

        test('應該處理非 JSON 消息', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

            // 模擬非 JSON 數據
            const messageEvent = new MessageEvent('message', { data: 'plain text' })
            mockWebSocket.onmessage?.(messageEvent)

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('收到非 JSON 消息'),
                'plain text'
            )

            consoleSpy.mockRestore()
        })
    })

    describe('開發模式診斷', () => {
        const originalNodeEnv = process.env.NODE_ENV

        beforeEach(async () => {
            // 使用 vi.stubEnv 來模擬環境變數
            vi.stubEnv('NODE_ENV', 'development')
            await uploader.connect('test-session-id')

            // 清除 window.__rec
            delete (window as any).__rec
        })

        afterEach(() => {
            vi.unstubAllEnvs()
        })

        test('應該在開發模式下記錄診斷信息', () => {
            const testBlob = new Blob(['test'], { type: 'audio/webm' })

            uploader.send(testBlob)

            expect((window as any).__rec).toBeDefined()
            expect((window as any).__rec.chunksSent).toBe(1)
            expect((window as any).__rec.totalBytes).toBe(testBlob.size)
            expect((window as any).__rec.sessionId).toBe('test-session-id')
        })

        test('應該累積診斷統計', () => {
            const blob1 = new Blob(['data1'])
            const blob2 = new Blob(['data2'])

            uploader.send(blob1)
            uploader.send(blob2)

            const rec = (window as any).__rec
            expect(rec.chunksSent).toBe(2)
            expect(rec.totalBytes).toBe(blob1.size + blob2.size)
            expect(rec.lastSequence).toBe(1)
        })
    })

    describe('連接狀態', () => {
        test('應該正確報告連接狀態', async () => {
            expect(uploader.connectionState).toBe('NOT_CREATED')

            const connectPromise = uploader.connect('test-session-id')
            expect(uploader.connectionState).toBe('CONNECTING')

            await connectPromise
            expect(uploader.connectionState).toBe('OPEN')

            uploader.close()
            expect(uploader.connectionState).toBe('NOT_CREATED')
        })

        test('應該正確檢查連接狀態', async () => {
            expect(uploader.isConnected).toBe(false)

            await uploader.connect('test-session-id')
            expect(uploader.isConnected).toBe(true)

            uploader.close()
            expect(uploader.isConnected).toBe(false)
        })
    })
})
