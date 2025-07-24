import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RestAudioUploader } from '../rest-audio-uploader'

// Mock fetch
const mockFetch = vi.fn()
// @ts-ignore
global.fetch = mockFetch

describe('RestAudioUploader - 400 錯誤細節解析', () => {
    const sessionId = 'sid-123'
    const blob = new Blob(['dummy'], { type: 'audio/webm' })
    let uploader: RestAudioUploader

    beforeEach(() => {
        uploader = new RestAudioUploader()
        uploader.setSessionId(sessionId)
        mockFetch.mockClear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('遇到 400 並帶有 detail JSON 時，應解析為 code: message', async () => {
        const sequence = 10
        const errorDetail = {
            code: 'session_not_active',
            message: 'Session not found or not active'
        }
        const mockResponse = {
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            json: () => Promise.resolve(errorDetail)
        }
        mockFetch.mockResolvedValueOnce(mockResponse)

        await expect(uploader.uploadSegment(sequence, blob))
            .rejects.toThrow('session_not_active: Session not found or not active')
    })
})
