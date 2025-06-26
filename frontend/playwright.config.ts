import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
    testDir: '../tests/frontend',
    outputDir: '../tests/frontend/test-results',
    timeout: 60000,
    use: {
        headless: true,
        baseURL: 'http://localhost:3100',
    },
    webServer: {
        command: 'pnpm dev --port 3100',
        url: 'http://localhost:3100',
        timeout: 120000,
        reuseExistingServer: !process.env.CI,
        cwd: '.',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
})
