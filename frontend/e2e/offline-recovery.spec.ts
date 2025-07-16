import { test, expect } from '@playwright/test'

test('offline 30s then online resumes', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await page.waitForTimeout(30_000)        // 錄音 & 斷網
    await page.evaluate(() => window.dispatchEvent(new Event('online')))

    await expect(page.getByText('暫存段落已全部上傳完成')).toBeVisible()
})
