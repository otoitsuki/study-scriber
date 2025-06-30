import { test, expect } from '@playwright/test'

/**
 * 服務層整合測試 - 完整驗證重構後的系統
 */

test.describe('服務層整合測試', () => {
    let consoleLogs: string[] = []
    let consoleErrors: string[] = []

    test.beforeEach(async ({ page }) => {
        consoleLogs = []
        consoleErrors = []

        // 監聽 console 輸出
        page.on('console', (msg) => {
            const text = `[${msg.type()}] ${msg.text()}`
            console.log(`🖥️  ${text}`)

            if (msg.type() === 'error') {
                consoleErrors.push(text)
            } else {
                consoleLogs.push(text)
            }
        })

        page.on('pageerror', (error) => {
            console.log(`❌ Page Error: ${error.message}`)
            consoleErrors.push(`PAGE_ERROR: ${error.message}`)
        })

        console.log('🚀 導航到應用...')
        await page.goto('/')
        await page.waitForLoadState('networkidle')
        console.log('✅ 頁面載入完成')
    })

    test('基礎架構驗證', async ({ page }) => {
        console.log('\n🔧 驗證服務層基礎架構...')

        await expect(page.locator('body')).toBeVisible()
        await page.waitForTimeout(3000)

        const result = await page.evaluate(() => ({
            hasWindow: typeof window !== 'undefined',
            windowKeys: Object.keys(window).length,
            appElements: document.querySelectorAll('[id*="root"], main, .app').length
        }))

        console.log('📊 基礎檢查:', result)
        console.log(`📊 Console Logs: ${consoleLogs.length}`)
        console.log(`❌ Errors: ${consoleErrors.length}`)
    })

    test('錄音功能完整測試', async ({ page }) => {
        console.log('\n🎤 測試錄音功能...')

        await page.context().grantPermissions(['microphone'])

        const buttons = await page.locator('button').all()
        console.log(`📊 找到 ${buttons.length} 個按鈕`)

        for (const button of buttons.slice(0, 3)) {
            const text = await button.textContent()
            const isVisible = await button.isVisible()
            const isEnabled = await button.isEnabled()

            console.log(`📋 按鈕: "${text}" - 可見:${isVisible}, 啟用:${isEnabled}`)

            if (isVisible && isEnabled && text?.trim()) {
                console.log(`🔄 點擊: "${text}"`)
                const logsBefore = consoleLogs.length

                await button.click()
                await page.waitForTimeout(2000)

                const newLogs = consoleLogs.slice(logsBefore)
                console.log(`📝 新增 ${newLogs.length} 條日誌`)
                newLogs.forEach(log => console.log(`   ${log}`))
            }
        }
    })

    test('服務層日誌分析', async ({ page }) => {
        console.log('\n🔍 分析服務層日誌...')

        await page.waitForTimeout(2000)

        // 觸發一些互動
        const elements = page.locator('button, input, [role="button"]')
        const count = await elements.count()

        for (let i = 0; i < Math.min(3, count); i++) {
            try {
                await elements.nth(i).click()
                await page.waitForTimeout(500)
            } catch { }
        }

        // 分析日誌
        const serviceLogs = consoleLogs.filter(log =>
            log.toLowerCase().includes('service') ||
            log.toLowerCase().includes('container')
        )

        const recordingLogs = consoleLogs.filter(log =>
            log.toLowerCase().includes('record') ||
            log.toLowerCase().includes('audio')
        )

        const stateLogs = consoleLogs.filter(log =>
            log.toLowerCase().includes('state') ||
            log.toLowerCase().includes('action')
        )

        console.log('\n📊 日誌分析:')
        console.log(`   服務層: ${serviceLogs.length}`)
        console.log(`   錄音: ${recordingLogs.length}`)
        console.log(`   狀態: ${stateLogs.length}`)
        console.log(`   總計: ${consoleLogs.length}`)
        console.log(`   錯誤: ${consoleErrors.length}`)

        if (serviceLogs.length > 0) {
            console.log('\n🔧 服務層日誌:')
            serviceLogs.forEach(log => console.log(`   ${log}`))
        }

        if (recordingLogs.length > 0) {
            console.log('\n🎤 錄音日誌:')
            recordingLogs.forEach(log => console.log(`   ${log}`))
        }
    })

    test.afterEach(async () => {
        console.log('\n📋 測試總結:')
        console.log(`📊 Console Logs: ${consoleLogs.length}`)
        console.log(`❌ Errors: ${consoleErrors.length}`)

        if (consoleErrors.length > 0) {
            console.log('\n❌ 錯誤詳情:')
            consoleErrors.forEach(error => console.log(`   ${error}`))
        }

        console.log('🏁 測試完成\n' + '='.repeat(50))
    })
})
