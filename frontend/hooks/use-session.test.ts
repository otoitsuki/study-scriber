// @ts-expect-error: jest types for test runner
import '@types/jest'
import '@testing-library/jest-dom'
import { renderHook, act } from '@testing-library/react'
import { useSession } from './use-session'

jest.mock('../lib/api', () => ({
    sessionAPI: {
        getSession: jest.fn(),
    },
}))

const { sessionAPI } = require('../lib/api')

describe('useSession - waitUntilCompleted', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('should resolve true immediately if session is completed', async () => {
        sessionAPI.getSession.mockResolvedValue({ status: 'completed' })
        const { result } = renderHook(() => useSession())
        await act(async () => {
            const ok = await result.current.waitUntilCompleted('sid', 1000)
            expect(ok).toBe(true)
        })
        expect(sessionAPI.getSession).toHaveBeenCalledTimes(1)
    })

    it('should poll until completed then resolve true', async () => {
        const states = [
            { status: 'processing' },
            { status: 'processing' },
            { status: 'completed' },
        ]
        let call = 0
        sessionAPI.getSession.mockImplementation(() => Promise.resolve(states[call++]))
        const { result } = renderHook(() => useSession())
        await act(async () => {
            const ok = await result.current.waitUntilCompleted('sid', 2000)
            expect(ok).toBe(true)
        })
        expect(sessionAPI.getSession).toHaveBeenCalledTimes(3)
    })

    it('should return false if timeout before completed', async () => {
        sessionAPI.getSession.mockResolvedValue({ status: 'processing' })
        const { result } = renderHook(() => useSession())
        await act(async () => {
            const ok = await result.current.waitUntilCompleted('sid', 1600)
            expect(ok).toBe(false)
        })
        // 1600ms / 1500ms = 2 次
        expect(sessionAPI.getSession).toHaveBeenCalledTimes(2)
    })

    it('should ignore 404 and retry until timeout', async () => {
        const error = { response: { status: 404 }, isAxiosError: true }
        sessionAPI.getSession.mockRejectedValue(error)
        const { result } = renderHook(() => useSession())
        await act(async () => {
            const ok = await result.current.waitUntilCompleted('sid', 1600)
            expect(ok).toBe(false)
        })
        expect(sessionAPI.getSession).toHaveBeenCalledTimes(2)
    })

    it('should throw on non-404 error', async () => {
        const error = { response: { status: 500 }, isAxiosError: true }
        sessionAPI.getSession.mockRejectedValue(error)
        const { result } = renderHook(() => useSession())
        await expect(result.current.waitUntilCompleted('sid', 1000)).rejects.toEqual(error)
    })
})
