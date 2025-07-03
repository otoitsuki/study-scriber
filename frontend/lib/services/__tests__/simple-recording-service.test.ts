import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimpleRecordingService } from '../simple-recording-service'

// Mock AdvancedAudioRecorder
vi.mock('../../advanced-audio-recorder', () => ({
    AdvancedAudioRecorder: vi.fn().mockImplementation(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        cleanup: vi.fn(),
        onSegment: vi.fn(),
        onError: vi.fn(),
    }))
}))

// Mock RestAudioUploader
vi.mock('../rest-audio-uploader', () => ({
    RestAudioUploader: vi.fn().mockImplementation(() => ({
        uploadSegment: vi.fn(),
        retryFailedSegments: vi.fn(),
        getCachedSegmentsCount: vi.fn(),
        cleanup: vi.fn(),
        onUploadSuccess: vi.fn(),
        onUploadError: vi.fn(),
        onCacheStored: vi.fn(),
    }))
}))

describe('SimpleRecordingService', () => {
    let service: SimpleRecordingService
    let mockStream: MediaStream
    let origGetUserMedia: any

    beforeEach(() => {
        service = new SimpleRecordingService()
        mockStream = { getTracks: vi.fn() } as any
        origGetUserMedia = navigator.mediaDevices.getUserMedia
        navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockStream)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        navigator.mediaDevices.getUserMedia = origGetUserMedia
    })

    it('應該正確初始化 audioRecorder 與 audioUploader 並開始錄音', async () => {
        await service.startRecording('test-session')
        // audioRecorder, audioUploader 應被建立
        expect(service['audioRecorder']).toBeDefined()
        expect(service['audioUploader']).toBeDefined()
        expect(service['recordingState'].isRecording).toBe(true)
    })

    it('應該處理麥克風權限不足', async () => {
        navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'))
        await expect(service.startRecording('fail-session')).rejects.toThrow('Permission denied')
        expect(service['audioRecorder']).toBeNull()
        expect(service['audioUploader']).toBeNull()
        expect(service['recordingState'].isRecording).toBe(false)
        expect(service['recordingState'].error).toMatch(/Permission denied/)
    })

    it('應該處理初始化失敗', async () => {
        // 模擬 stream 存在但 initMediaRecorder 失敗
        service['stream'] = mockStream
        service['sessionId'] = 'fail-session'
        // 強制讓 initMediaRecorder 拋出錯誤
        service['initMediaRecorder'] = vi.fn().mockImplementation(() => { throw new Error('Init failed') })
        await expect(service.startRecording('fail-session')).rejects.toThrow('Init failed')
        expect(service['audioRecorder']).toBeNull()
        expect(service['audioUploader']).toBeNull()
        expect(service['recordingState'].isRecording).toBe(false)
        expect(service['recordingState'].error).toMatch(/Init failed/)
    })

    it('應該處理重複啟動錄音', async () => {
        await service.startRecording('session-1')
        // 再次啟動錄音
        service['stopRecording'] = vi.fn().mockResolvedValue(undefined)
        await service.startRecording('session-2')
        expect(service['stopRecording']).toHaveBeenCalled()
        expect(service['audioRecorder']).toBeDefined()
        expect(service['audioUploader']).toBeDefined()
        expect(service['recordingState'].isRecording).toBe(true)
        expect(service['recordingState'].currentSessionId).toBe('session-2')
    })
})
