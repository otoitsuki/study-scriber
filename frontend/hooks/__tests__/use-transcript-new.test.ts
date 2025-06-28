import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTranscriptNew } from '../use-transcript-new'
import { AppStateProvider } from '../use-app-state-context'
import React from 'react'

// Mock dependencies
vi.mock('../../lib/transcript-manager', () => ({
    transcriptManager: {
        connect: vi.fn().mockResolvedValue(undefined),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
        disconnect: vi.fn(),
    },
    TranscriptMessage: {},
}))

vi.mock('../lib/feature-flags', () => ({
    isFeatureEnabled: vi.fn((flag: string) => {
        if (flag === 'useNewStateManagement') return true
        if (flag === 'useNewTranscriptHook') return true
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

describe('useTranscriptNew', () => {
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
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        expect(result.current.transcripts).toEqual([])
        expect(result.current.isConnected).toBe(false)
        expect(result.current.isCompleted).toBe(false)
        expect(result.current.error).toBe(null)
        expect(result.current.autoScrollEnabled).toBe(true)
    })

    test('should have all required methods', () => {
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        expect(typeof result.current.connect).toBe('function')
        expect(typeof result.current.disconnect).toBe('function')
        expect(typeof result.current.clearTranscripts).toBe('function')
        expect(typeof result.current.enableAutoScroll).toBe('function')
        expect(typeof result.current.disableAutoScroll).toBe('function')
        expect(typeof result.current.scrollToLatest).toBe('function')
        expect(typeof result.current.setScrollContainer).toBe('function')
    })

    test('should connect to transcript manager successfully', async () => {
        const { transcriptManager } = await import('../../lib/transcript-manager')
        vi.mocked(transcriptManager.isConnected).mockReturnValue(true)

        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        await act(async () => {
            await result.current.connect('test-session-id')
        })

        expect(transcriptManager.connect).toHaveBeenCalledWith('test-session-id')
        expect(transcriptManager.addListener).toHaveBeenCalled()
        expect(result.current.isConnected).toBe(true)
        expect(result.current.error).toBe(null)
    })

    test('should disconnect from transcript manager', () => {
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        act(() => {
            result.current.disconnect()
        })

        expect(result.current.isConnected).toBe(false)
    })

    test('should clear transcripts correctly', () => {
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        act(() => {
            result.current.clearTranscripts()
        })

        expect(result.current.transcripts).toEqual([])
        expect(result.current.isCompleted).toBe(false)
    })

    test('should handle auto scroll controls', () => {
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        expect(result.current.autoScrollEnabled).toBe(true)

        act(() => {
            result.current.disableAutoScroll()
        })

        expect(result.current.autoScrollEnabled).toBe(false)

        act(() => {
            result.current.enableAutoScroll()
        })

        expect(result.current.autoScrollEnabled).toBe(true)
    })

    test('should integrate with Context state management', () => {
        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        // 驗證 Hook 使用 Context 狀態
        expect(result.current.transcripts).toEqual([])
        expect(result.current.error).toBe(null)
    })

    test('should log feature flag status on initialization', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { })

        renderHook(() => useTranscriptNew(), { wrapper })

        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[useTranscriptNew] Hook 初始化'),
            expect.objectContaining({
                useNewStateManagement: true,
                useNewTranscriptHook: true,
            })
        )

        consoleSpy.mockRestore()
    })

    test('should handle connection errors gracefully', async () => {
        const { transcriptManager } = await import('../../lib/transcript-manager')
        vi.mocked(transcriptManager.connect).mockRejectedValue(new Error('Connection failed'))

        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        await act(async () => {
            await result.current.connect('test-session-id')
        })

        expect(result.current.error).toContain('Connection failed')
        expect(result.current.isConnected).toBe(false)
    })

    test('should preserve TranscriptManager singleton behavior', async () => {
        const { transcriptManager } = await import('../../lib/transcript-manager')

        const { result } = renderHook(() => useTranscriptNew(), { wrapper })

        await act(async () => {
            await result.current.connect('test-session-id')
        })

        // 驗證 TranscriptManager 的方法被正確調用
        expect(transcriptManager.connect).toHaveBeenCalledWith('test-session-id')
        expect(transcriptManager.addListener).toHaveBeenCalled()
        expect(transcriptManager.isConnected).toHaveBeenCalledWith('test-session-id')
    })
})
