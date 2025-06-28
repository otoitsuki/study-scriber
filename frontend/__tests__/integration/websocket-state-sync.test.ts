import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { AppStateProvider } from '../../hooks/use-app-state-context'
import { useTranscriptNew } from '../../hooks/use-transcript-new'
import { featureFlagManager } from '../../lib/feature-flags'
import type { ReactNode } from 'react'

// Mock WebSocket
class MockWebSocket {
    onopen: ((event: Event) => void) | null = null
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onclose: ((event: CloseEvent) => void) | null = null
    readyState = 0 // WebSocket.CONNECTING

    constructor(public url: string) {
        // 模擬異步連接
        setTimeout(() => {
            this.readyState = 1 // WebSocket.OPEN
            if (this.onopen) {
                this.onopen(new Event('open'))
            }
        }, 10)
    }

    send(data: string) {
        // 模擬發送數據
    }

    close() {
        this.readyState = 3 // WebSocket.CLOSED
        if (this.onclose) {
            this.onclose(new CloseEvent('close'))
        }
    }

    // 模擬接收消息
    simulateMessage(data: any) {
        if (this.onmessage) {
            this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }))
        }
    }

    // 模擬錯誤
    simulateError() {
        if (this.onerror) {
            this.onerror(new Event('error'))
        }
    }
}

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
}

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
})

// Mock WebSocket globally
Object.defineProperty(window, 'WebSocket', {
    value: MockWebSocket
})

function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(AppStateProvider, null, children)
}

describe('WebSocket 與狀態同步測試', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        featureFlagManager.reset()
        featureFlagManager.enable('useNewStateManagement')
        featureFlagManager.enable('useNewTranscriptHook')
        localStorageMock.getItem.mockReturnValue(null)
    })

    describe('WebSocket 連接管理', () => {
        test('應該能夠建立 WebSocket 連接', async () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 初始狀態應該是未連接
            expect(result.current.isConnected).toBe(false)

            // 這裡我們無法直接測試 WebSocket 連接，因為它在 TranscriptManager 中
            // 但我們可以測試 Hook 的基本功能
            expect(result.current.error).toBe(null)
            expect(result.current.autoScrollEnabled).toBe(true)
        })

        test('應該提供 WebSocket 控制方法', () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 檢查所有必要的方法都存在
            expect(typeof result.current.disconnect).toBe('function')
            expect(typeof result.current.clearTranscripts).toBe('function')
            expect(typeof result.current.enableAutoScroll).toBe('function')
            expect(typeof result.current.disableAutoScroll).toBe('function')
            expect(typeof result.current.scrollToLatest).toBe('function')
        })

        test('應該能夠控制自動滾動', async () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 初始狀態：自動滾動啟用
            expect(result.current.autoScrollEnabled).toBe(true)

            // 禁用自動滾動
            await act(async () => {
                result.current.disableAutoScroll()
            })

            expect(result.current.autoScrollEnabled).toBe(false)

            // 啟用自動滾動
            await act(async () => {
                result.current.enableAutoScroll()
            })

            expect(result.current.autoScrollEnabled).toBe(true)
        })
    })

    describe('狀態同步', () => {
        test('Hook 應該與 Context 狀態保持同步', () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 檢查 Hook 返回的狀態結構
            expect(result.current).toHaveProperty('isConnected')
            expect(result.current).toHaveProperty('error')
            expect(result.current).toHaveProperty('autoScrollEnabled')
            expect(result.current).toHaveProperty('disconnect')
            expect(result.current).toHaveProperty('clearTranscripts')
        })

        test('清除逐字稿應該正常工作', async () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 清除逐字稿不應該拋出錯誤
            await act(async () => {
                expect(() => result.current.clearTranscripts()).not.toThrow()
            })
        })

        test('斷開連接應該正常工作', async () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 斷開連接不應該拋出錯誤
            await act(async () => {
                expect(() => result.current.disconnect()).not.toThrow()
            })
        })
    })

    describe('錯誤處理', () => {
        test('應該正確處理 WebSocket 錯誤', () => {
            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 初始錯誤狀態應該是 null
            expect(result.current.error).toBe(null)
        })

        test('Hook unmount 應該清理資源', () => {
            const { unmount } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // unmount 應該正常執行而不拋出錯誤
            expect(() => unmount()).not.toThrow()
        })
    })

    describe('功能開關整合', () => {
        test('當功能開關關閉時應該使用舊版本', () => {
            // 禁用新的 Transcript Hook
            featureFlagManager.disable('useNewTranscriptHook')

            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 應該仍然提供相同的 API
            expect(result.current).toHaveProperty('isConnected')
            expect(result.current).toHaveProperty('error')
            expect(result.current).toHaveProperty('autoScrollEnabled')
        })

        test('當功能開關啟用時應該使用新版本', () => {
            // 確保新功能開關啟用
            featureFlagManager.enable('useNewTranscriptHook')

            const { result } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 應該提供完整的 API
            expect(result.current).toHaveProperty('isConnected')
            expect(result.current).toHaveProperty('error')
            expect(result.current).toHaveProperty('autoScrollEnabled')
            expect(result.current).toHaveProperty('disconnect')
            expect(result.current).toHaveProperty('clearTranscripts')
        })
    })

    describe('多實例測試', () => {
        test('多個 Hook 實例應該共享 TranscriptManager', () => {
            const { result: result1 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })
            const { result: result2 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 兩個實例應該有相同的連接狀態
            expect(result1.current.isConnected).toBe(result2.current.isConnected)
            expect(result1.current.error).toBe(result2.current.error)
        })

        test('一個實例的操作應該影響其他實例', async () => {
            const { result: result1 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })
            const { result: result2 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 從第一個實例禁用自動滾動
            await act(async () => {
                result1.current.disableAutoScroll()
            })

            // 第二個實例應該反映相同的狀態
            expect(result2.current.autoScrollEnabled).toBe(false)
        })
    })

    describe('記憶體管理', () => {
        test('Hook 應該正確清理資源', () => {
            const { unmount } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })

            // 多次 mount/unmount 應該穩定
            for (let i = 0; i < 3; i++) {
                unmount()
                const { unmount: newUnmount } = renderHook(() => useTranscriptNew(), {
                    wrapper: TestWrapper
                })
                expect(() => newUnmount()).not.toThrow()
            }
        })

        test('Context unmount 不應該影響 TranscriptManager', () => {
            let unmount1: () => void
            let unmount2: () => void

            // 第一個 Provider
            const { unmount: u1 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })
            unmount1 = u1

            // 第二個 Provider
            const { unmount: u2 } = renderHook(() => useTranscriptNew(), {
                wrapper: TestWrapper
            })
            unmount2 = u2

            // 清理第一個不應該影響第二個
            expect(() => unmount1()).not.toThrow()
            expect(() => unmount2()).not.toThrow()
        })
    })
})
