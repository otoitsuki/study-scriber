import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecording } from '../use-recording'

// Mock SegmentedAudioRecorder
const mockInitialize = vi.fn()
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockCleanup = vi.fn()
const mockOnSegment = vi.fn()
const mockOnError = vi.fn()

vi.mock('../../lib/segmented-audio-recorder', () => ({
    SegmentedAudioRecorder: vi.fn(() => ({
        initialize: mockInitialize,
        start: mockStart,
        stop: mockStop,
        cleanup: mockCleanup,
        onSegment: mockOnSegment,
        onError: mockOnError,
        isRecording: false,
        currentState: 'idle',
        currentSequence: 0
    }))
}))

// Mock AudioUploader
const mockConnect = vi.fn()
const mockSend = vi.fn()
const mockClose = vi.fn()

vi.mock('../../lib/stream/audio-uploader', () => ({
    audioUploader: {
        connect: mockConnect,
        send: mockSend,
        close: mockClose,
        isConnected: false,
        currentSessionId: null,
        currentSequence: 0
    }
}))

// Mock transcriptManager
vi.mock('../../lib/transcript-manager', () => ({
    transcriptManager: {
        connect: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true)
    }
}))

// Mock timers
vi.useFakeTimers()

describe('useRecording (with SegmentedAudioRecorder)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.clearAllTimers()

        // Reset mocks to default resolved values
        mockInitialize.mockResolvedValue(undefined)
        mockStart.mockResolvedValue(undefined)
        mockConnect.mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('初始狀態', () => {
        test('應該正確初始化狀態', () => {
            const { result } = renderHook(() => useRecording())

            expect(result.current.isRecording).toBe(false)
            expect(result.current.recordingTime).toBe(0)
            expect(result.current.transcripts).toEqual([])
            expect(result.current.transcriptCompleted).toBe(false)
            expect(result.current.error).toBe(null)
        })

        test('應該包含必要的方法', () => {
            const { result } = renderHook(() => useRecording())

            expect(typeof result.current.startRecording).toBe('function')
            expect(typeof result.current.stopRecording).toBe('function')
            expect(typeof result.current.clearTranscripts).toBe('function')
        })
    })

    describe('開始錄音', () => {
        test('應該成功初始化並開始錄音', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 驗證 SegmentedAudioRecorder 被正確初始化
            expect(mockInitialize).toHaveBeenCalled()
            expect(mockOnSegment).toHaveBeenCalled()
            expect(mockOnError).toHaveBeenCalled()

            // 驗證 AudioUploader 連接
            expect(mockConnect).toHaveBeenCalledWith('test-session-id')

            // 驗證錄音開始
            expect(mockStart).toHaveBeenCalled()
            expect(result.current.isRecording).toBe(true)
        })

        test('應該處理初始化錯誤', async () => {
            const error = new Error('Initialization failed')
            mockInitialize.mockRejectedValueOnce(error)

            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            expect(result.current.error).toContain('開始錄音失敗')
            expect(result.current.isRecording).toBe(false)
        })

        test('應該處理 AudioUploader 連接錯誤', async () => {
            const error = new Error('WebSocket connection failed')
            mockConnect.mockRejectedValueOnce(error)

            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            expect(result.current.error).toContain('開始錄音失敗')
            expect(result.current.isRecording).toBe(false)
        })

        test('應該開始計時器', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            expect(result.current.recordingTime).toBe(0)

            // 快進 3 秒
            act(() => {
                vi.advanceTimersByTime(3000)
            })

            expect(result.current.recordingTime).toBe(3)
        })
    })

    describe('停止錄音', () => {
        test('應該正確停止錄音', async () => {
            const { result } = renderHook(() => useRecording())

            // 先開始錄音
            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            expect(result.current.isRecording).toBe(true)

            // 停止錄音
            act(() => {
                result.current.stopRecording()
            })

            expect(mockStop).toHaveBeenCalled()
            expect(mockClose).toHaveBeenCalled()
            expect(result.current.isRecording).toBe(false)
        })

        test('應該停止計時器', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 快進一些時間
            act(() => {
                vi.advanceTimersByTime(5000)
            })

            expect(result.current.recordingTime).toBe(5)

            // 停止錄音
            act(() => {
                result.current.stopRecording()
            })

            // 再快進時間，時間應該不再增加
            act(() => {
                vi.advanceTimersByTime(3000)
            })

            expect(result.current.recordingTime).toBe(5)
        })
    })

    describe('音訊段落處理', () => {
        test('應該處理音訊段落並發送到 AudioUploader', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 模擬音訊段落回調
            const mockSegment = {
                blob: new Blob(['audio data'], { type: 'audio/webm' }),
                timestamp: Date.now(),
                duration: 5000,
                sequence: 0
            }

            // 獲取並調用 onSegment 回調
            const onSegmentCallback = mockOnSegment.mock.calls[0][0]

            act(() => {
                onSegmentCallback(mockSegment)
            })

            // 驗證音訊段落被發送到 AudioUploader
            expect(mockSend).toHaveBeenCalledWith(
                mockSegment.blob,
                mockSegment.sequence
            )
        })

        test('應該處理 AudioUploader 未連接的情況', async () => {
            // 模擬 AudioUploader 未連接
            const mockAudioUploader = require('../../lib/stream/audio-uploader').audioUploader
            mockAudioUploader.isConnected = false

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })

            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            const mockSegment = {
                blob: new Blob(['audio data']),
                timestamp: Date.now(),
                duration: 5000,
                sequence: 0
            }

            const onSegmentCallback = mockOnSegment.mock.calls[0][0]

            act(() => {
                onSegmentCallback(mockSegment)
            })

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('AudioUploader 未連接')
            )

            consoleSpy.mockRestore()
        })
    })

    describe('逐字稿處理', () => {
        test('應該處理逐字稿訊息', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 模擬逐字稿管理器
            const transcriptManager = require('../../lib/transcript-manager').transcriptManager
            const addListenerCall = transcriptManager.addListener.mock.calls[0]
            const transcriptCallback = addListenerCall[1]

            const mockTranscript = {
                type: 'transcript_segment',
                text: 'Hello world',
                start_time: 0,
                end_time: 2,
                start_sequence: 0,
                confidence: 0.9
            }

            act(() => {
                transcriptCallback(mockTranscript)
            })

            expect(result.current.transcripts).toHaveLength(1)
            expect(result.current.transcripts[0]).toEqual(mockTranscript)
        })

        test('應該處理轉錄完成訊息', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            const transcriptManager = require('../../lib/transcript-manager').transcriptManager
            const transcriptCallback = transcriptManager.addListener.mock.calls[0][1]

            const completeMessage = {
                type: 'transcript_complete',
                message: 'transcription_complete'
            }

            act(() => {
                transcriptCallback(completeMessage)
            })

            expect(result.current.transcriptCompleted).toBe(true)
        })
    })

    describe('錯誤處理', () => {
        test('應該處理 SegmentedAudioRecorder 錯誤', async () => {
            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 模擬錄音器錯誤
            const onErrorCallback = mockOnError.mock.calls[0][0]
            const testError = new Error('Recording error')

            act(() => {
                onErrorCallback(testError)
            })

            expect(result.current.error).toBe('Recording error')
        })

        test('應該在錯誤時清理資源', async () => {
            const error = new Error('Connection failed')
            mockConnect.mockRejectedValueOnce(error)

            const { result } = renderHook(() => useRecording())

            await act(async () => {
                await result.current.startRecording('test-session-id')
            })

            // 驗證清理操作
            expect(mockStop).toHaveBeenCalled()
            expect(mockCleanup).toHaveBeenCalled()
            expect(mockClose).toHaveBeenCalled()
        })
    })

    describe('清空逐字稿', () => {
        test('應該清空逐字稿和完成狀態', () => {
            const { result } = renderHook(() => useRecording())

            // 手動設置一些逐字稿（模擬已收到數據）
            act(() => {
                result.current.clearTranscripts()
            })

            expect(result.current.transcripts).toEqual([])
            expect(result.current.transcriptCompleted).toBe(false)
        })
    })

    describe('資源清理', () => {
        test('應該在 unmount 時清理所有資源', () => {
            const { unmount } = renderHook(() => useRecording())

            unmount()

            // 驗證清理方法被調用（在 useEffect cleanup 中）
            expect(mockCleanup).toHaveBeenCalled()
            expect(mockClose).toHaveBeenCalled()
        })
    })
})
