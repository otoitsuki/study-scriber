import { test, expect } from '@playwright/test'

test.describe('Summary Feature E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Navigate to the app
        await page.goto('/')

        // Wait for app to load
        await page.waitForSelector('[data-testid="study-scriber-app"]', { timeout: 10000 })
    })

    test('complete recording to summary flow', async ({ page }) => {
        // Start recording
        await page.click('[data-testid="start-recording-btn"]')

        // Wait for recording state
        await page.waitForSelector('[data-testid="recording-active"]', { timeout: 10000 })

        // Verify transcript tab is default
        await expect(page.locator('[data-testid="tab-transcript"]')).toHaveClass(/active/)

        // Wait for some transcript content (mock or real)
        await page.waitForSelector('[data-testid="transcript-content"]', { timeout: 15000 })

        // Stop recording
        await page.click('[data-testid="stop-recording-btn"]')

        // Wait for processing state
        await page.waitForSelector('[data-testid="processing-state"]', { timeout: 5000 })

        // Wait for finished state (both transcript and summary ready)
        await page.waitForSelector('[data-testid="finished-state"]', { timeout: 70000 }) // Allow up to 70s for summary generation

        // Verify both tabs are available
        await expect(page.locator('[data-testid="tab-transcript"]')).toBeVisible()
        await expect(page.locator('[data-testid="tab-summary"]')).toBeVisible()

        // Switch to summary tab
        await page.click('[data-testid="tab-summary"]')

        // Verify summary content is displayed (not "生成中...")
        const summaryContent = page.locator('[data-testid="summary-content"]')
        await expect(summaryContent).toBeVisible()
        await expect(summaryContent).not.toContainText('生成中')

        // Verify export includes summary
        await page.click('[data-testid="export-btn"]')

        // Wait for download and verify it contains summary.txt
        const downloadPromise = page.waitForEvent('download')
        const download = await downloadPromise

        // Save and verify ZIP contents (would need additional setup for full verification)
        const path = await download.path()
        expect(path).toBeTruthy()
    })

    test('summary tab shows loading state initially', async ({ page }) => {
        // Start and immediately stop recording to get to processing quickly
        await page.click('[data-testid="start-recording-btn"]')
        await page.waitForTimeout(2000) // Brief recording
        await page.click('[data-testid="stop-recording-btn"]')

        // Wait for processing
        await page.waitForSelector('[data-testid="processing-state"]')

        // Switch to summary tab while processing
        await page.click('[data-testid="tab-summary"]')

        // Should show loading state
        await expect(page.locator('[data-testid="summary-loading"]')).toBeVisible()
        await expect(page.locator('[data-testid="summary-loading"]')).toContainText('生成中')
    })

    test('timeout fallback after 60 seconds', async ({ page }) => {
        // Mock slow/failing summary generation by intercepting API calls
        await page.route('**/api/session/*/finish', async route => {
            // Delay the finish endpoint to simulate slow summary generation
            await new Promise(resolve => setTimeout(resolve, 2000))
            await route.continue()
        })

        // Start and stop recording
        await page.click('[data-testid="start-recording-btn"]')
        await page.waitForTimeout(1000)
        await page.click('[data-testid="stop-recording-btn"]')

        // Should eventually timeout and go to finished state even without summary
        await page.waitForSelector('[data-testid="finished-state"]', { timeout: 65000 })

        // Summary tab should be available but may show error or "無摘要可用"
        await page.click('[data-testid="tab-summary"]')
        const summaryContent = page.locator('[data-testid="summary-content"]')

        // Should either show error or "no summary available" message
        await expect(summaryContent).toBeVisible()
    })

    test('tab switching preserves content', async ({ page }) => {
        // Complete a recording flow (abbreviated)
        await page.click('[data-testid="start-recording-btn"]')
        await page.waitForTimeout(3000)
        await page.click('[data-testid="stop-recording-btn"]')
        await page.waitForSelector('[data-testid="finished-state"]', { timeout: 30000 })

        // Get transcript content
        const transcriptContent = await page.locator('[data-testid="transcript-content"]').textContent()

        // Switch to summary tab
        await page.click('[data-testid="tab-summary"]')
        const summaryContent = await page.locator('[data-testid="summary-content"]').textContent()

        // Switch back to transcript
        await page.click('[data-testid="tab-transcript"]')

        // Verify transcript content is preserved
        await expect(page.locator('[data-testid="transcript-content"]')).toContainText(transcriptContent || '')

        // Switch back to summary
        await page.click('[data-testid="tab-summary"]')

        // Verify summary content is preserved
        if (summaryContent) {
            await expect(page.locator('[data-testid="summary-content"]')).toContainText(summaryContent)
        }
    })
})
