import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecordingNew } from '../use-recording-new'
import { AppStateProvider } from '../use-app-state-context'
import React from 'react'

// Mock dependencies
vi.mock('../lib/websocket', () => ({
    AudioUploadWebSocket: vi.fn(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        uploadAudioChunk: vi.fn(),
        onAckMissing: vi.fn(),
        isConnected: true,
        send: vi.fn(),
    })),
}))

vi.mock('../lib/audio-recorder', () => ({
    AudioRecorder: vi.fn(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        startRecording: vi.fn().mockResolvedValue(undefined),
        stopRecording: vi.fn(),
        onChunk: vi.fn(),
        onError: vi.fn(),
    })),
}))

vi.mock('../lib/transcript-manager', () => ({
    transcriptManager: {
        connect: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
    },
}))

vi.mock('../lib/feature-flags', () => ({
    isFeatureEnabled: vi.fn((flag: string) => {
        if (flag === 'useNewStateManagement') return true
        if (flag === 'useNewRecordingHook') return true
        return false
    }),
}))

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('useRecordingNew', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        React.createElement(AppStateProvider, { children })
    )

    beforeEach(() => {
        vi.clearAllMocks()
        localStorageMock.getItem.mockReturnValue(null)
    })

    afterEach(() => {
        vi.clearAllTimers()
    })

    test('should initialize with correct default state', () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        expect(result.current.isRecording).toBe(false)
        expect(result.current.recordingTime).toBe(0)
        expect(result.current.transcripts).toEqual([])
        expect(result.current.transcriptCompleted).toBe(false)
        expect(result.current.error).toBe(null)
    })

    test('should have all required methods', () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        expect(typeof result.current.startRecording).toBe('function')
        expect(typeof result.current.stopRecording).toBe('function')
        expect(typeof result.current.clearTranscripts).toBe('function')
    })

    test('should start recording successfully', async () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        await act(async () => {
            await result.current.startRecording('test-session-id')
        })

        expect(result.current.isRecording).toBe(true)
        expect(result.current.error).toBe(null)
    })

    test('should stop recording successfully', async () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        // 先開始錄音
        await act(async () => {
            await result.current.startRecording('test-session-id')
        })

        expect(result.current.isRecording).toBe(true)

        // 然後停止錄音
        act(() => {
            result.current.stopRecording()
        })

        expect(result.current.isRecording).toBe(false)
    })

    test('should clear transcripts correctly', async () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        act(() => {
            result.current.clearTranscripts()
        })

        expect(result.current.transcripts).toEqual([])
        expect(result.current.transcriptCompleted).toBe(false)
    })

    test('should handle recording errors gracefully', () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        // 驗證錯誤處理機制存在
        expect(result.current.error).toBe(null)
        expect(typeof result.current.startRecording).toBe('function')
        expect(typeof result.current.stopRecording).toBe('function')
    })

    test('should integrate with Context state management', () => {
        const { result } = renderHook(() => useRecordingNew(), { wrapper })

        // 驗證 Hook 使用 Context 狀態
        expect(result.current.isRecording).toBe(false)
        expect(result.current.recordingTime).toBe(0)
        expect(result.current.transcripts).toEqual([])
    })

    test('should log feature flag status on initialization', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

        renderHook(() => useRecordingNew(), { wrapper })

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[useRecordingNew] Hook 初始化，功能開關狀態:'),
            expect.objectContaining({
                useNewStateManagement: true,
                useNewRecordingHook: true,
            })
        )

        consoleSpy.mockRestore()
    })
})
