import { test, expect, request } from '@playwright/test'
import JSZip from 'jszip'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// 測試用假 session id，請確保後端有對應 completed session 或手動設置
const TEST_SESSION_ID = 'a72bacbc-39d7-48a3-afdc-5b288ef7f9fc'
const TEST_NOTE_ID = TEST_SESSION_ID // 假設 note.id = session.id

// 匯出流程 E2E 測試

test.beforeEach(async () => {
    // 1. 建立 session (status: completed)
    const api = await request.newContext({ baseURL: 'http://localhost:8000' })
    await api.post('/api/sessions', {
        data: {
            id: TEST_SESSION_ID,
            status: 'completed',
            type: 'recording',
            title: 'E2E 測試 Session',
            language: 'zh-TW',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
        },
    })
    // 2. 建立 note
    await api.post('/api/notes', {
        data: {
            id: TEST_NOTE_ID,
            session_id: TEST_SESSION_ID,
            title: 'E2E 測試 Note',
            content: '# E2E 測試內容',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        },
    })
    // 3. 建立至少一筆 transcription
    await api.post('/api/transcriptions', {
        data: {
            id: 'e2e-tx-1',
            note_id: TEST_NOTE_ID,
            text: '這是 E2E 測試逐字稿',
            timestamp_start: 0,
            timestamp_end: 1,
            chunk_id: 'e2e-chunk',
        },
    })
    await api.dispose()
})

test.describe('前端 Export Flow', () => {
    test('點擊 Header Export 按鈕可下載 zip 並驗證內容', async ({ page }) => {
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        console.log('E2E page.goto:', url)
        await page.goto(url)
        // 等待 Export 按鈕出現
        const exportBtn = page.getByRole('button', { name: /Export/i })
        await expect(exportBtn).toBeVisible()
        // 點擊匯出
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            exportBtn.click()
        ])
        // 取得下載 zip
        const filePath = path.join(os.tmpdir(), `exported-${Date.now()}.zip`)
        await download.saveAs(filePath)
        const zipBuffer = await fs.readFile(filePath)
        const zip = await JSZip.loadAsync(zipBuffer)
        const note = await zip.file('note.md')?.async('string')
        const transcript = await zip.file('transcript.txt')?.async('string')
        expect(note).toBeDefined()
        expect(transcript).toBeDefined()
        expect(note?.length).toBeGreaterThan(0)
        expect(transcript).toMatch(/E2E 測試逐字稿/)
    })

    test('session 不存在時顯示錯誤 toast', async ({ page }) => {
        const url = 'http://localhost:3000/app?session=not-exist-123&state=finished'
        console.log('E2E page.goto:', url)
        await page.goto(url)
        const exportBtn = page.getByRole('button', { name: /Export/i })
        await expect(exportBtn).toBeVisible()
        await exportBtn.click()
        // 檢查 toast 出現錯誤訊息
        const toast = page.getByText(/匯出失敗|not found|失敗/i)
        await expect(toast).toBeVisible()
    })
})
