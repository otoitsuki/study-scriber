import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AdvancedAudioRecorder, checkAdvancedAudioRecordingSupport } from '../advanced-audio-recorder'

// Track created instances
let mockInstances: any[] = []

const MockMediaRecorder = vi.fn().mockImplementation((stream: any, options: any) => {
    // Create individual mock functions for each instance
    const instanceStart = vi.fn()
    const instanceStop = vi.fn()
    const instanceRequestData = vi.fn()

    const instance = {
        start: instanceStart,
        stop: instanceStop,
        requestData: instanceRequestData,
        state: 'inactive',
        ondataavailable: null,
        onerror: null,
        mimeType: options.mimeType,
        audioBitsPerSecond: options.audioBitsPerSecond,
        stream,
        options
    }
    mockInstances.push(instance)
    return instance
}) as any

MockMediaRecorder.isTypeSupported = vi.fn().mockReturnValue(true)

// Mock getUserMedia
const mockGetUserMedia = vi.fn()

describe('AdvancedAudioRecorder', () => {
    let recorder: AdvancedAudioRecorder
    let mockStream: any

    beforeEach(() => {
        // Reset mocks
        vi.clearAllMocks()
        mockInstances = [] // Reset instances array

        // Setup global mocks
        global.MediaRecorder = MockMediaRecorder as any

        // Reset and setup isTypeSupported mock
        MockMediaRecorder.isTypeSupported.mockClear()
        MockMediaRecorder.isTypeSupported.mockReturnValue(true)

        global.navigator = {
            mediaDevices: {
                getUserMedia: mockGetUserMedia
            }
        } as any

        // Mock stream
        mockStream = {
            getTracks: vi.fn().mockReturnValue([
                { stop: vi.fn() }
            ])
        }
        mockGetUserMedia.mockResolvedValue(mockStream)

        // Create recorder instance
        recorder = new AdvancedAudioRecorder({
            segmentDuration: 10000,
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000
        })
    })

    afterEach(() => {
        recorder.cleanup()
    })

    describe('checkAdvancedAudioRecordingSupport', () => {
        it('should return supported when all APIs are available', async () => {
            const result = await checkAdvancedAudioRecordingSupport()
            expect(result.isSupported).toBe(true)
        })

        it('should return unsupported when MediaDevices is not available', async () => {
            global.navigator = {} as any
            const result = await checkAdvancedAudioRecordingSupport()
            expect(result.isSupported).toBe(false)
            expect(result.error).toContain('MediaDevices API')
        })

        it('should return unsupported when MediaRecorder is not available', async () => {
            delete (global as any).MediaRecorder
            const result = await checkAdvancedAudioRecordingSupport()
            expect(result.isSupported).toBe(false)
            expect(result.error).toContain('MediaRecorder API')
        })

        it('should return unsupported when mime type is not supported', async () => {
            MockMediaRecorder.isTypeSupported.mockReturnValue(false)
            const result = await checkAdvancedAudioRecordingSupport()
            expect(result.isSupported).toBe(false)
            expect(result.error).toContain('音訊格式')
        })
    })

    describe('AdvancedAudioRecorder', () => {
        it('should initialize with default config', () => {
            expect(recorder.currentConfig).toEqual({
                segmentDuration: 10000,
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: 128000
            })
        })

        it('should accept custom config', () => {
            const customRecorder = new AdvancedAudioRecorder({
                segmentDuration: 5000,
                audioBitsPerSecond: 64000
            })
            expect(customRecorder.currentConfig.segmentDuration).toBe(5000)
            expect(customRecorder.currentConfig.audioBitsPerSecond).toBe(64000)
        })

        it('should initialize media stream', async () => {
            await recorder.initialize()
            expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true })
        })

        it('should not reinitialize if already initialized', async () => {
            await recorder.initialize()
            await recorder.initialize()
            expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
        })

        it('should start recording with dual MediaRecorder strategy', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            expect(recorder.recording).toBe(true)
            expect(mockInstances[0].start).toHaveBeenCalledTimes(1) // Current recorder started
        })

        it('should create MediaRecorder with correct options', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            // Check if MediaRecorder was created with correct options
            expect(MockMediaRecorder).toHaveBeenCalledWith(
                mockStream,
                {
                    mimeType: 'audio/webm;codecs=opus',
                    audioBitsPerSecond: 128000
                }
            )
        })

        it('should handle segment data available', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            // Get the first MediaRecorder instance created
            const mockRecorderInstance = mockInstances[0]

            // Simulate data available event
            const mockBlob = new Blob(['test data'], { type: 'audio/webm' })
            const mockEvent = { data: mockBlob }

            if (mockRecorderInstance.ondataavailable) {
                mockRecorderInstance.ondataavailable(mockEvent)
            }

            expect(onSegmentCallback).toHaveBeenCalledWith({
                blob: mockBlob,
                timestamp: expect.any(Number),
                duration: 10000,
                sequence: 0
            })
        })

        it('should increment sequence number for each segment', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            const mockRecorderInstance = mockInstances[0]
            const mockBlob = new Blob(['test data'], { type: 'audio/webm' })
            const mockEvent = { data: mockBlob }

            // First segment
            if (mockRecorderInstance.ondataavailable) {
                mockRecorderInstance.ondataavailable(mockEvent)
            }
            expect(onSegmentCallback).toHaveBeenLastCalledWith(
                expect.objectContaining({ sequence: 0 })
            )

            // Second segment
            if (mockRecorderInstance.ondataavailable) {
                mockRecorderInstance.ondataavailable(mockEvent)
            }
            expect(onSegmentCallback).toHaveBeenLastCalledWith(
                expect.objectContaining({ sequence: 1 })
            )
        })

        it('should stop recording and cleanup', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            expect(recorder.recording).toBe(true)

            recorder.stop()

            expect(recorder.recording).toBe(false)
            // Verify that at least 2 MediaRecorder instances were created (dual strategy)
            expect(mockInstances.length).toBeGreaterThanOrEqual(2)
        })

        it('should prevent starting when already recording', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            await expect(recorder.start(onSegmentCallback)).rejects.toThrow('錄製已在進行中')
        })

        it('should handle MediaRecorder errors', async () => {
            const onSegmentCallback = vi.fn()
            const onErrorCallback = vi.fn()
            recorder.onError(onErrorCallback)

            await recorder.start(onSegmentCallback)

            const mockRecorderInstance = mockInstances[0]
            const mockError = new Error('MediaRecorder error')

            if (mockRecorderInstance.onerror) {
                mockRecorderInstance.onerror(mockError)
            }

            expect(onErrorCallback).toHaveBeenCalledWith(expect.any(Error))
            expect(recorder.recording).toBe(false)
        })

        it('should cleanup resources properly', async () => {
            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            recorder.cleanup()

            expect(recorder.recording).toBe(false)
            expect(mockStream.getTracks()[0].stop).toHaveBeenCalled()
        })

        it('should schedule recorder swap after segment duration', async () => {
            vi.useFakeTimers()

            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            // Initially should have 2 recorders (current + next)
            expect(mockInstances.length).toBe(2)

            // Fast-forward time to trigger swap
            vi.advanceTimersByTime(10000)

            // After swap, should have created additional recorders
            expect(mockInstances.length).toBeGreaterThan(2)

            // Verify recorder is still recording
            expect(recorder.recording).toBe(true)

            vi.useRealTimers()
        })

        it('should not swap recorders after stop is called', async () => {
            vi.useFakeTimers()

            const onSegmentCallback = vi.fn()
            await recorder.start(onSegmentCallback)

            recorder.stop()

            // Fast-forward time
            vi.advanceTimersByTime(10000)

            // Should not start additional recorders after stop
            expect(mockInstances[0].start).toHaveBeenCalledTimes(1)

            vi.useRealTimers()
        })
    })
})
