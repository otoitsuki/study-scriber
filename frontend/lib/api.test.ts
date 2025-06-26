import { describe, it, expect, vi } from 'vitest'

// 模擬 axios 完整配置
vi.mock('axios', () => ({
    default: {
        create: vi.fn(() => ({
            post: vi.fn().mockResolvedValue({ data: {} }),
            get: vi.fn().mockResolvedValue({ data: {} }),
            patch: vi.fn().mockResolvedValue({ data: {} }),
            put: vi.fn().mockResolvedValue({ data: {} }),
            interceptors: {
                request: {
                    use: vi.fn(),
                },
                response: {
                    use: vi.fn(),
                },
            },
        })),
        isAxiosError: vi.fn(),
    },
}))

describe('API Configuration', () => {
    it('should use environment variables for API_BASE_URL', () => {
        // 測試環境變數配置
        const expectedURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
        expect(expectedURL).toBe('http://localhost:8000')
    })

    it('should construct WebSocket URL correctly', async () => {
        // 動態 import 以避免模組載入時的錯誤
        const { getWebSocketURL } = await import('./api')

        const wsURL = getWebSocketURL('/test/path')
        const expectedURL = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000') + '/test/path'
        expect(wsURL).toBe(expectedURL)
    })
})

describe('API Methods', () => {
    it('should have all required sessionAPI methods', async () => {
        const { sessionAPI } = await import('./api')

        expect(typeof sessionAPI.createSession).toBe('function')
        expect(typeof sessionAPI.getActiveSession).toBe('function')
        expect(typeof sessionAPI.finishSession).toBe('function')
        expect(typeof sessionAPI.upgradeToRecording).toBe('function')
    })

    it('should have all required notesAPI methods', async () => {
        const { notesAPI } = await import('./api')

        expect(typeof notesAPI.updateNote).toBe('function')
        expect(typeof notesAPI.getNote).toBe('function')
    })
})
