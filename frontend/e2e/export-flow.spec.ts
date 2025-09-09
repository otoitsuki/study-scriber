import { test, expect, request } from '@playwright/test'
import * as JSZip from 'jszip'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

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

test.describe('前端 Export Flow - 基本功能', () => {
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

    test('匯出檔案應包含完整的筆記和逐字稿資料', async ({ page }) => {
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        await page.goto(url)
        
        // 在編輯器中添加內容
        const editor = page.locator('.CodeMirror-code').first()
        if (await editor.count() > 0) {
            await page.evaluate(() => {
                const editorInstance = (window as any).theEditor
                if (editorInstance && editorInstance.codemirror) {
                    editorInstance.codemirror.setValue('# 增強測試內容\n\n這是一個詳細的測試筆記，包含多行內容和格式化文本。\n\n## 重點摘要\n- 測試項目 1\n- 測試項目 2\n- 測試項目 3')
                }
            })
            await page.waitForTimeout(1000)
        }
        
        // 點擊匯出按鈕
        const exportBtn = page.getByRole('button', { name: /Export/i })
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            exportBtn.click()
        ])
        
        // 驗證下載檔案
        const filePath = path.join(os.tmpdir(), `enhanced-test-${Date.now()}.zip`)
        await download.saveAs(filePath)
        const zipBuffer = await fs.readFile(filePath)
        const zip = await JSZip.loadAsync(zipBuffer)
        
        // 驗證 ZIP 檔案結構
        const files = Object.keys(zip.files)
        expect(files).toContain('note.md')
        expect(files).toContain('transcript.txt')
        
        // 驗證內容
        const note = await zip.file('note.md')?.async('string')
        const transcript = await zip.file('transcript.txt')?.async('string')
        
        expect(note).toContain('增強測試內容')
        expect(note).toContain('重點摘要')
        expect(transcript).toContain('E2E 測試逐字稿')
        
        // 清理檔案
        await fs.unlink(filePath)
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

    test('大檔案匯出應正常處理', async ({ page }) => {
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        await page.goto(url)
        
        // 創建大量文字內容
        const largeContent = '# 大檔案測試\n\n' + 'Lorem ipsum '.repeat(1000) + '\n\n## 結論\n測試完成。'
        
        await page.evaluate((content) => {
            const editorInstance = (window as any).theEditor
            if (editorInstance && editorInstance.codemirror) {
                editorInstance.codemirror.setValue(content)
            }
        }, largeContent)
        
        await page.waitForTimeout(1000)
        
        // 匯出大檔案
        const exportBtn = page.getByRole('button', { name: /Export/i })
        const downloadPromise = page.waitForEvent('download')
        await exportBtn.click()
        
        const download = await downloadPromise
        expect(download).toBeDefined()
        
        // 驗證檔案大小合理
        const filePath = path.join(os.tmpdir(), `large-test-${Date.now()}.zip`)
        await download.saveAs(filePath)
        const stats = await fs.stat(filePath)
        expect(stats.size).toBeGreaterThan(1000) // 應該大於 1KB
        expect(stats.size).toBeLessThan(10000000) // 應該小於 10MB
        
        await fs.unlink(filePath)
    })
})

test.describe('前端 Export Flow - 錯誤處理', () => {
    test('網路錯誤時應顯示適當錯誤訊息', async ({ page }) => {
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        await page.goto(url)
        
        // 模擬網路中斷
        await page.context().setOffline(true)
        
        const exportBtn = page.getByRole('button', { name: /Export/i })
        await exportBtn.click()
        
        // 檢查錯誤訊息
        const errorToast = page.getByText(/網路錯誤|無法連接|匯出失敗/i)
        await expect(errorToast).toBeVisible()
        
        // 恢復網路
        await page.context().setOffline(false)
    })

    test('伺服器錯誤時應正確處理', async ({ page }) => {
        // 攔截匯出 API 請求並返回錯誤
        await page.route('/api/notes/export', route => {
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Internal Server Error' })
            })
        })
        
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        await page.goto(url)
        
        const exportBtn = page.getByRole('button', { name: /Export/i })
        await exportBtn.click()
        
        // 檢查錯誤處理
        const errorToast = page.getByText(/匯出失敗|錯誤/i)
        await expect(errorToast).toBeVisible()
    })

    test('空內容匯出應正常處理', async ({ page }) => {
        const url = `http://localhost:3000/app?session=${TEST_SESSION_ID}&state=finished`
        await page.goto(url)
        
        // 清空編輯器內容
        await page.evaluate(() => {
            const editorInstance = (window as any).theEditor
            if (editorInstance && editorInstance.codemirror) {
                editorInstance.codemirror.setValue('')
            }
        })
        
        // 嘗試匯出空內容
        const exportBtn = page.getByRole('button', { name: /Export/i })
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            exportBtn.click()
        ])
        
        // 驗證仍然可以下載（應該包含空的 note.md 和 transcript）
        expect(download).toBeDefined()
        
        const filePath = path.join(os.tmpdir(), `empty-test-${Date.now()}.zip`)
        await download.saveAs(filePath)
        const zipBuffer = await fs.readFile(filePath)
        const zip = await JSZip.loadAsync(zipBuffer)
        
        const note = await zip.file('note.md')?.async('string')
        const transcript = await zip.file('transcript.txt')?.async('string')
        
        expect(note).toBeDefined()
        expect(transcript).toBeDefined()
        expect(transcript).toContain('E2E 測試逐字稿') // 應該仍有逐字稿資料
        
        await fs.unlink(filePath)
    })
})
