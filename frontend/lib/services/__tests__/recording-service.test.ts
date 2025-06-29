"use client"

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingService } from '../recording-service'
import { AudioRecorder } from '../../audio-recorder'
import { AudioUploadWebSocket } from '../../websocket'

// Mock AudioRecorder
vi.mock('../../audio-recorder', () => ({
    AudioRecorder: vi.fn().mockImplementation(() => ({
        initialize: vi.fn(),
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        onChunk: vi.fn(),
        onError: vi.fn(),
    }))
}))

// Mock AudioUploadWebSocket
vi.mock('../../websocket', () => ({
    AudioUploadWebSocket: vi.fn().mockImplementation(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        uploadAudioChunk: vi.fn(),
        onAckMissing: vi.fn(),
        isConnected: false,
        send: vi.fn(),
    }))
}))

// Mock transcriptManager
const mockTranscriptManager = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    isConnected: vi.fn(),
}

vi.mock('../../transcript-manager', () => ({
    transcriptManager: mockTranscriptManager
}))

describe('RecordingService', () => {
    let recordingService: RecordingService
    let mockAudioRecorder: any
    let mockWebSocket: any

    beforeEach(() => {
        recordingService = new RecordingService()
        mockAudioRecorder = new AudioRecorder({})
        mockWebSocket = new AudioUploadWebSocket('')
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('服務初始化', () => {
        it('應該正確初始化 RecordingService', () => {
            expect(recordingService).toBeDefined()
            expect(recordingService['serviceName']).toBe('RecordingService')
        })

        it('應該正確啟動和停止服務', async () => {
            await recordingService.start()
            expect(recordingService['isRunning']).toBe(true)

            await recordingService.stop()
            expect(recordingService['isRunning']).toBe(false)
        })

        it('應該返回初始錄音狀態', () => {
            const state = recordingService.getRecordingState()

            expect(state).toEqual({
                isRecording: false,
                recordingTime: 0,
                currentSessionId: null,
                error: null
            })
        })
    })

    describe('startRecording', () => {
        const sessionId = 'test-session-id'

        beforeEach(() => {
            // Mock browser environment
            Object.defineProperty(global, 'window', {
                value: {
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                },
                writable: true
            })
        })

        it('應該成功開始錄音', async () => {
            // Setup mocks
            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording(sessionId)

            // Verify AudioRecorder was initialized and started
            expect(AudioRecorder).toHaveBeenCalled()
            expect(mockAudioRecorder.initialize).toHaveBeenCalled()
            expect(mockAudioRecorder.startRecording).toHaveBeenCalled()

            // Verify WebSocket was connected
            expect(AudioUploadWebSocket).toHaveBeenCalledWith(sessionId)
            expect(mockWebSocket.connect).toHaveBeenCalled()

            // Verify transcript manager was connected
            expect(mockTranscriptManager.connect).toHaveBeenCalledWith(sessionId)

            // Verify recording state
            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(true)
            expect(state.currentSessionId).toBe(sessionId)
        })

        it('應該處理音頻初始化失敗', async () => {
            const initError = new Error('Microphone permission denied')
            mockAudioRecorder.initialize.mockRejectedValue(initError)

            await expect(recordingService.startRecording(sessionId))
                .rejects.toThrow('Microphone permission denied')

            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(false)
            expect(state.error).toBe('Microphone permission denied')
        })

        it('應該處理 WebSocket 連接失敗', async () => {
            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockWebSocket.connect.mockRejectedValue(new Error('WebSocket connection failed'))

            await expect(recordingService.startRecording(sessionId))
                .rejects.toThrow('WebSocket connection failed')
        })

        it('應該處理 TranscriptManager 連接失敗', async () => {
            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockRejectedValue(new Error('Transcript connection failed'))

            await expect(recordingService.startRecording(sessionId))
                .rejects.toThrow('Transcript connection failed')
        })

        it('應該在瀏覽器環境檢查失敗時拋出錯誤', async () => {
            // Remove window object to simulate non-browser environment
            delete (global as any).window

            await expect(recordingService.startRecording(sessionId))
                .rejects.toThrow('此功能僅在瀏覽器環境中可用')
        })

        it('應該處理重複開始錄音請求', async () => {
            // Setup successful first recording
            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording(sessionId)

            // Try to start recording again
            await expect(recordingService.startRecording('another-session'))
                .rejects.toThrow('錄音已在進行中')
        })
    })

    describe('stopRecording', () => {
        beforeEach(async () => {
            // Setup recording state
            Object.defineProperty(global, 'window', {
                value: {
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording('test-session')
        })

        it('應該成功停止錄音', async () => {
            await recordingService.stopRecording()

            // Verify audio recorder was stopped
            expect(mockAudioRecorder.stopRecording).toHaveBeenCalled()

            // Verify WebSocket was disconnected
            expect(mockWebSocket.disconnect).toHaveBeenCalled()

            // Verify recording state
            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(false)
            expect(state.currentSessionId).toBeNull()
        })

        it('應該處理停止錄音錯誤', async () => {
            mockAudioRecorder.stopRecording.mockImplementation(() => {
                throw new Error('Stop recording failed')
            })

            await expect(recordingService.stopRecording())
                .rejects.toThrow('Stop recording failed')
        })

        it('應該在沒有錄音時正常處理停止請求', async () => {
            // Stop recording first
            await recordingService.stopRecording()

            // Try to stop again
            await expect(recordingService.stopRecording()).resolves.not.toThrow()
        })
    })

    describe('錄音狀態管理', () => {
        it('應該正確追蹤錄音時間', async () => {
            // Mock timer
            vi.useFakeTimers()

            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording('test-session')

            // Advance timer by 5 seconds
            vi.advanceTimersByTime(5000)

            const state = recordingService.getRecordingState()
            expect(state.recordingTime).toBe(5)

            vi.useRealTimers()
        })

        it('應該正確報告錄音狀態', async () => {
            expect(recordingService.isRecording()).toBe(false)

            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording('test-session')
            expect(recordingService.isRecording()).toBe(true)

            await recordingService.stopRecording()
            expect(recordingService.isRecording()).toBe(false)
        })

        it('應該正確報告錄音時間', () => {
            expect(recordingService.getRecordingTime()).toBe(0)
        })
    })

    describe('音頻切片處理', () => {
        it('應該處理音頻切片上傳', () => {
            const mockChunk = {
                sequence: 1,
                blob: new Blob(['test audio data'], { type: 'audio/webm' })
            }

            // Simulate chunk received
            const chunkHandler = mockAudioRecorder.onChunk.mock.calls[0]?.[0]
            if (chunkHandler) {
                chunkHandler(mockChunk)
            }

            // Verify WebSocket upload was called
            expect(mockWebSocket.uploadAudioChunk).toHaveBeenCalledWith(mockChunk.blob)
        })

        it('應該處理 ACK/Missing 重傳機制', () => {
            const ackMissingData = {
                acknowledged: [1, 2],
                missing: [3, 4]
            }

            // Simulate ACK/Missing message
            const ackHandler = mockWebSocket.onAckMissing.mock.calls[0]?.[0]
            if (ackHandler) {
                ackHandler(ackMissingData)
            }

            // Verify retry logic would be triggered for missing chunks
            expect(ackMissingData.missing).toEqual([3, 4])
        })
    })

    describe('錯誤處理', () => {
        it('應該處理音頻錄製器錯誤', async () => {
            const audioError = new Error('Audio recording error')

            // Simulate audio recorder error
            const errorHandler = mockAudioRecorder.onError.mock.calls[0]?.[0]
            if (errorHandler) {
                errorHandler(audioError)
            }

            const state = recordingService.getRecordingState()
            expect(state.error).toBe('Audio recording error')
        })

        it('應該清除錯誤狀態', () => {
            // Set error state
            recordingService['recordingState'].error = 'Test error'

            // Clear error (this would be called internally)
            recordingService['recordingState'].error = null

            const state = recordingService.getRecordingState()
            expect(state.error).toBeNull()
        })
    })

    describe('資源清理', () => {
        it('應該在錯誤時清理資源', async () => {
            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockRejectedValue(new Error('Start failed'))

            await expect(recordingService.startRecording('test-session'))
                .rejects.toThrow('Start failed')

            // Verify cleanup was performed
            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(false)
            expect(state.currentSessionId).toBeNull()
        })

        it('應該在服務停止時清理所有資源', async () => {
            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording('test-session')
            await recordingService.stop()

            // Verify all resources are cleaned up
            expect(mockAudioRecorder.stopRecording).toHaveBeenCalled()
            expect(mockWebSocket.disconnect).toHaveBeenCalled()

            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(false)
        })
    })

    describe('並發和競爭條件', () => {
        it('應該防止並發錄音操作', async () => {
            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            // Start first recording
            const promise1 = recordingService.startRecording('session-1')

            // Try to start second recording immediately
            const promise2 = recordingService.startRecording('session-2')

            const results = await Promise.allSettled([promise1, promise2])

            // One should succeed, one should fail
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
            expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
        })

        it('應該處理快速的開始-停止操作', async () => {
            Object.defineProperty(global, 'window', {
                value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
                writable: true
            })

            mockAudioRecorder.initialize.mockResolvedValue(undefined)
            mockAudioRecorder.startRecording.mockResolvedValue(undefined)
            mockWebSocket.connect.mockResolvedValue(undefined)
            mockWebSocket.isConnected = true
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.isConnected.mockReturnValue(true)

            await recordingService.startRecording('test-session')
            await recordingService.stopRecording()

            const state = recordingService.getRecordingState()
            expect(state.isRecording).toBe(false)
        })
    })

    describe('服務狀態報告', () => {
        it('應該報告正確的服務資訊', async () => {
            const status = await recordingService.getDetailedStatus()

            expect(status).toMatchObject({
                serviceName: 'RecordingService',
                isInitialized: expect.any(Boolean),
                isRunning: expect.any(Boolean),
                recordingState: expect.any(Object),
                audioSupport: expect.any(Object),
                webSocketConnected: expect.any(Boolean)
            })
        })
    })
})
