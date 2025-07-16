import { test, expect, Page } from '@playwright/test'
import JSZip from 'jszip'

// 測試用假 session id，請確保後端有對應 completed session 或手動設置
const TEST_SESSION_ID = 'test-session-completed-001'

// 下載並解壓 zip，驗證內容
async function fetchAndUnzipZip(page: Page, sid: string) {
    const response = await page.request.get(`/api/export/${sid}?type=zip`)
    expect(response.status()).toBe(200)
    const buffer = await response.body()
    const zip = await JSZip.loadAsync(buffer)
    const note = await zip.file('note.md')?.async('string')
    const transcript = await zip.file('transcript.txt')?.async('string')
    return { note, transcript }
}

test.describe('匯出 API Proxy 測試', () => {
    test('應該正確 proxy /api/export/<sid> 到 FastAPI', async ({ page }) => {
        // 直接發送 fetch 請求
        const response = await page.request.get(`/api/export/${TEST_SESSION_ID}?type=zip`)
        // 應該不是 404
        expect(response.status()).not.toBe(404)
        // 應該不是 Next.js 預設 404 頁面
        const text = await response.text()
        expect(text).not.toContain('This page could not be found')
        // 標頭應有 FastAPI 標記（如 server: uvicorn）
        const serverHeader = response.headers()['server'] || ''
        expect(serverHeader.toLowerCase()).toContain('uvicorn')
    })

    test('應該能下載並驗證 zip 內容', async ({ page }) => {
        const { note, transcript } = await fetchAndUnzipZip(page, TEST_SESSION_ID)
        expect(note).toBeDefined()
        expect(transcript).toBeDefined()
        expect(note?.length).toBeGreaterThan(0)
        expect(transcript?.length).toBeGreaterThan(0)
        // 可根據實際內容加強驗證
        expect(note).toMatch(/.+/) // 至少有內容
        expect(transcript).toMatch(/\[\d{2}:\d{2}:\d{2}\]/) // 有時間戳
    })
})
