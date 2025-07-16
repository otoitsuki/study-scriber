import { vi, describe, it, expect, beforeEach } from 'vitest'
import { downloadZip } from './export'

// 模擬 fetch
beforeEach(() => {
    global.fetch = vi.fn()
    vi.useFakeTimers()
})

describe('downloadZip', () => {
    it('應該用 POST 請求 /api/notes/export 並傳送正確資料', async () => {
        const fakeBlob = new Blob(['test'], { type: 'application/zip' })
        const mockCreateObjectURL = vi.fn(() => 'blob:url')
        const mockClick = vi.fn()
        const mockAppendChild = vi.fn()
        const mockRemoveChild = vi.fn()

        // 模擬 fetch 回傳
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200, // 修正：補上 status
            blob: () => Promise.resolve(fakeBlob),
        })
        // 模擬 DOM
        global.window.URL.createObjectURL = mockCreateObjectURL
        document.createElement = vi.fn(() => ({ click: mockClick })) as any
        document.body.appendChild = mockAppendChild
        document.body.removeChild = mockRemoveChild

        const sessionId = 'sid123'
        const noteContent = 'hello world'
        await downloadZip(sessionId, noteContent)
        vi.runAllTimers() // 讓 setTimeout 立即執行

        // 驗證 fetch 參數
        expect(global.fetch).toHaveBeenCalledWith(
            'http://localhost:8000/api/notes/export',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ session_id: sessionId, note_content: noteContent }),
            })
        )
        // 驗證有呼叫下載
        expect(mockCreateObjectURL).toHaveBeenCalledWith(fakeBlob)
        expect(mockClick).toHaveBeenCalled()
        expect(mockAppendChild).toHaveBeenCalled()
        expect(mockRemoveChild).toHaveBeenCalled()
    })
})
