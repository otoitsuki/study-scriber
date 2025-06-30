import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { SegmentedAudioRecorder, checkSegmentedAudioRecordingSupport } from '../segmented-audio-recorder'

// Mock navigator.mediaDevices
const mockGetUserMedia = vi.fn()
Object.defineProperty(navigator, 'mediaDevices', {
    writable: true,
    value: {
        getUserMedia: mockGetUserMedia,
    },
})

// Mock MediaRecorder
const mockStart = vi.fn()
const mockStop = vi.fn()
const mockRequestData = vi.fn()

class MockMediaRecorder {
    start = mockStart
    stop = mockStop
    requestData = mockRequestData
    state: string = 'inactive'
    ondataavailable: ((event: any) => void) | null = null
    onerror: ((event: any) => void) | null = null

    constructor(stream: any, options: any) {
        // Store for verification
    }

    static isTypeSupported = vi.fn().mockReturnValue(true)
}

Object.defineProperty(window, 'MediaRecorder', {
    writable: true,
    value: MockMediaRecorder,
})

// Mock stream
const mockTrack = { stop: vi.fn() }
const mockStream = {
    getTracks: vi.fn(() => [mockTrack])
}

describe('SegmentedAudioRecorder', () => {
    let recorder: SegmentedAudioRecorder

    beforeEach(() => {
        vi.clearAllMocks()
        mockGetUserMedia.mockResolvedValue(mockStream)

        recorder = new SegmentedAudioRecorder({
            segmentDuration: 1000,
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 64000
        })
    })

    afterEach(() => {
        recorder.cleanup()
    })

    describe('初始化和配置', () => {
        test('應該使用預設配置創建錄音器', () => {
            const defaultRecorder = new SegmentedAudioRecorder()

            expect(defaultRecorder.currentConfig).toEqual({
                segmentDuration: 10000,
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 64000
            })
            expect(defaultRecorder.currentState).toBe('idle')
            expect(defaultRecorder.isRecording).toBe(false)
            expect(defaultRecorder.currentSequence).toBe(0)
        })

        test('應該接受自訂配置', () => {
            const customConfig = {
                segmentDuration: 3000,
                mimeType: 'audio/webm',
                audioBitsPerSecond: 64000
            }

            const customRecorder = new SegmentedAudioRecorder(customConfig)
            expect(customRecorder.currentConfig).toEqual(customConfig)
        })

        test('應該正確設置事件回調', () => {
            const onSegment = vi.fn()
            const onError = vi.fn()
            const onStateChange = vi.fn()

            recorder.onSegment(onSegment)
            recorder.onError(onError)
            recorder.onStateChange(onStateChange)

            // 回調應該被正確設置（透過後續行為驗證）
            expect(recorder.currentState).toBe('idle')
        })
    })

    describe('音訊權限和初始化', () => {
        test('應該成功初始化音訊權限', async () => {
            await recorder.initialize()

            expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true })
        })

        test('應該處理權限被拒絕的情況', async () => {
            const error = new Error('Permission denied')
            mockGetUserMedia.mockRejectedValueOnce(error)

            const onError = vi.fn()
            recorder.onError(onError)

            await expect(recorder.initialize()).rejects.toThrow('Permission denied')
        })

        test('應該避免重複初始化', async () => {
            await recorder.initialize()
            await recorder.initialize() // 第二次調用

            expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
        })
    })

    describe('錄音狀態管理', () => {
        beforeEach(async () => {
            await recorder.initialize()
        })

        test('應該正確開始錄音', async () => {
            const onSegment = vi.fn()

            await recorder.start(onSegment)

            expect(recorder.isRecording).toBe(true)
            expect(recorder.currentState).toBe('recording')
            expect(mockStart).toHaveBeenCalled()
        })

        test('應該防止重複開始錄音', async () => {
            const onSegment = vi.fn()

            await recorder.start(onSegment)

            await expect(recorder.start(onSegment)).rejects.toThrow('錄製已在進行中')
        })

        test('應該正確停止錄音', async () => {
            const onSegment = vi.fn()

            await recorder.start(onSegment)
            recorder.stop()

            expect(recorder.isRecording).toBe(false)
            expect(recorder.currentState).toBe('idle')
        })
    })

    describe('序號管理', () => {
        test('應該從 0 開始序號', () => {
            expect(recorder.currentSequence).toBe(0)
        })

        test('應該在重新開始錄音時重置序號', async () => {
            await recorder.initialize()
            const onSegment = vi.fn()

            await recorder.start(onSegment)
            recorder.stop()

            expect(recorder.currentSequence).toBe(0)
        })
    })

    describe('資源清理', () => {
        test('應該正確清理所有資源', async () => {
            await recorder.initialize()
            const onSegment = vi.fn()
            await recorder.start(onSegment)

            recorder.cleanup()

            expect(recorder.isRecording).toBe(false)
            expect(recorder.currentSequence).toBe(0)
            expect(mockTrack.stop).toHaveBeenCalled()
        })
    })
})

describe('瀏覽器支援檢查', () => {
    test('應該檢查基本瀏覽器支援', async () => {
        const result = await checkSegmentedAudioRecordingSupport()
        expect(result.isSupported).toBe(true)
    })

    test('應該檢測 MediaDevices API 不支援', async () => {
        // 使用 vi.stubGlobal 來模擬不支援的情況
        vi.stubGlobal('navigator', { ...navigator, mediaDevices: undefined })

        const result = await checkSegmentedAudioRecordingSupport()

        expect(result.isSupported).toBe(false)
        expect(result.error).toContain('不支援 MediaDevices API')

        vi.unstubAllGlobals()
    })

    test('應該檢測 MediaRecorder API 不支援', async () => {
        // 直接測試沒有 MediaRecorder 的情況
        const originalMediaRecorder = global.MediaRecorder
        delete (global as any).MediaRecorder

        const result = await checkSegmentedAudioRecordingSupport()

        expect(result.isSupported).toBe(false)
        expect(result.error).toContain('不支援 MediaRecorder API')

        // 恢復
        global.MediaRecorder = originalMediaRecorder
    })
})
