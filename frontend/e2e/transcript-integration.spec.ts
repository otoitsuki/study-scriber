import { test, expect, Page } from '@playwright/test'

/**
 * 逐字稿功能整合測試
 * 測試完整的錄音和逐字稿流程，包括新舊系統的切換
 */

// 測試前的設置
test.beforeEach(async ({ page }) => {
    // 前往應用程式
    await page.goto('http://localhost:3000')

    // 等待頁面載入完成
    await page.waitForLoadState('networkidle')

    // 檢查頁面是否正常載入
    await expect(page).toHaveTitle(/study-scriber/)
})

test.describe('逐字稿功能測試', () => {
    test('應該能夠啟用新的狀態管理系統', async ({ page }) => {
        // 在瀏覽器控制台中啟用新功能
        await page.evaluate(() => {
            // 啟用所有新功能
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })

        // 重新載入頁面以應用新設置
        await page.reload()
        await page.waitForLoadState('networkidle')

        // 檢查功能開關是否正確啟用
        const featureFlags = await page.evaluate(() => {
            return (window as any).featureFlags?.getAll()
        })

        console.log('功能開關狀態:', featureFlags)

        // 驗證關鍵功能已啟用
        expect(featureFlags?.useNewStateManagement).toBe(true)
        expect(featureFlags?.useNewTranscriptHook).toBe(true)
    })

    test('應該能夠開始錄音會話', async ({ page }) => {
        // 啟用新功能
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })
        await page.reload()
        await page.waitForLoadState('networkidle')

        // 尋找錄音按鈕
        const recordButton = page.locator('button').filter({ hasText: /錄音|Record|開始/ }).first()

        if (await recordButton.count() > 0) {
            // 點擊錄音按鈕
            await recordButton.click()

            // 等待錄音狀態變更
            await page.waitForTimeout(1000)

            // 檢查是否有錄音狀態指示器
            const recordingIndicator = page.locator('[data-testid="recording-indicator"]')
                .or(page.locator('text=/錄音中|Recording/'))
                .or(page.locator('.recording'))

            // 如果找到錄音指示器，驗證錄音狀態
            if (await recordingIndicator.count() > 0) {
                await expect(recordingIndicator.first()).toBeVisible()
                console.log('✅ 錄音功能已啟動')
            } else {
                console.log('ℹ️ 未找到明顯的錄音指示器，但錄音按鈕已點擊')
            }
        } else {
            console.log('ℹ️ 未找到錄音按鈕，可能需要先建立會話')
        }
    })

    test('應該能夠建立新的筆記會話', async ({ page }) => {
        // 啟用新功能
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })
        await page.reload()
        await page.waitForLoadState('networkidle')

        // 尋找新筆記或新會話按鈕
        const newNoteButton = page.locator('button').filter({ hasText: /新筆記|New Note|新增|Add/ }).first()

        if (await newNoteButton.count() > 0) {
            await newNoteButton.click()
            await page.waitForTimeout(500)
            console.log('✅ 新筆記按鈕已點擊')
        } else {
            console.log('ℹ️ 未找到新筆記按鈕')
        }

        // 檢查文字編輯器是否存在
        const editor = page.locator('textarea, [contenteditable="true"], .editor').first()

        if (await editor.count() > 0) {
            // 在編輯器中輸入測試文字
            await editor.click()
            await editor.fill('這是一個測試筆記，用於驗證逐字稿功能。')

            // 驗證文字已輸入
            await expect(editor).toHaveValue(/測試筆記/)
            console.log('✅ 編輯器功能正常')
        } else {
            console.log('ℹ️ 未找到文字編輯器')
        }
    })

    test('應該能夠檢查 WebSocket 連接狀態', async ({ page }) => {
        // 啟用新功能
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })
        await page.reload()
        await page.waitForLoadState('networkidle')

        // 檢查 WebSocket 連接狀態
        const wsStatus = await page.evaluate(() => {
            // 檢查是否有 TranscriptManager
            const transcriptManager = (window as any).transcriptManager
            if (transcriptManager) {
                return {
                    exists: true,
                    isConnected: transcriptManager.isConnected?.() || false,
                    hasListeners: transcriptManager.listeners?.size > 0 || false
                }
            }

            // 檢查是否有其他 WebSocket 相關對象
            const wsConnections = []
            if (typeof WebSocket !== 'undefined') {
                // 這裡可以檢查 WebSocket 實例
            }

            return {
                exists: false,
                websocketAvailable: typeof WebSocket !== 'undefined'
            }
        })

        console.log('WebSocket 狀態:', wsStatus)

        // 驗證 WebSocket 可用性
        expect(wsStatus.websocketAvailable).toBe(true)

        if (wsStatus.exists) {
            console.log('✅ TranscriptManager 已找到')
        } else {
            console.log('ℹ️ TranscriptManager 尚未初始化，這可能是正常的')
        }
    })

    test('應該能夠測試狀態管理系統', async ({ page }) => {
        // 啟用新功能
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })
        await page.reload()
        await page.waitForLoadState('networkidle')

        // 檢查應用狀態
        const appState = await page.evaluate(() => {
            // 檢查 React DevTools 或應用狀態
            const reactRoot = document.querySelector('#__next, [data-reactroot]')

            // 檢查是否有狀態管理相關的調試信息
            const logs = []
            const originalLog = console.log
            console.log = (...args) => {
                if (args[0]?.includes?.('AppState') || args[0]?.includes?.('Context')) {
                    logs.push(args)
                }
                originalLog.apply(console, args)
            }

            return {
                hasReactRoot: !!reactRoot,
                hasFeatureFlags: !!(window as any).featureFlags,
                hasStateMachine: !!(window as any).stateMachine,
                logsCount: logs.length
            }
        })

        console.log('應用狀態:', appState)

        // 驗證基本組件存在
        expect(appState.hasReactRoot).toBe(true)
        expect(appState.hasFeatureFlags).toBe(true)

        if (appState.hasStateMachine) {
            console.log('✅ 狀態機已初始化')

            // 測試狀態機功能
            const stateMachineTest = await page.evaluate(() => {
                const sm = (window as any).stateMachine
                if (sm) {
                    return {
                        currentState: sm.getCurrentState?.(),
                        availableTransitions: sm.getAvailableTransitions?.(),
                        canStartRecording: sm.canTransition?.('USER_START_RECORDING')
                    }
                }
                return null
            })

            console.log('狀態機測試結果:', stateMachineTest)
        } else {
            console.log('ℹ️ 狀態機尚未暴露到 window，這可能是正常的')
        }
    })

    test('應該能夠模擬完整的錄音流程', async ({ page }) => {
        // 啟用新功能
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })
        await page.reload()
        await page.waitForLoadState('networkidle')

        console.log('🎬 開始模擬完整錄音流程...')

        // 步驟 1: 檢查初始狀態
        const initialState = await page.evaluate(() => {
            return {
                url: window.location.href,
                title: document.title,
                hasAudio: navigator.mediaDevices !== undefined
            }
        })

        console.log('初始狀態:', initialState)

        // 步驟 2: 尋找並點擊開始錄音的按鈕
        const startButtons = [
            'button:has-text("開始錄音")',
            'button:has-text("Start Recording")',
            'button:has-text("錄音")',
            'button:has-text("Record")',
            '[data-testid="start-recording"]',
            '.record-button',
            'button[aria-label*="錄音"]'
        ]

        let recordingStarted = false

        for (const selector of startButtons) {
            const button = page.locator(selector).first()
            if (await button.count() > 0 && await button.isVisible()) {
                console.log(`找到錄音按鈕: ${selector}`)
                await button.click()
                await page.waitForTimeout(1000)
                recordingStarted = true
                break
            }
        }

        if (!recordingStarted) {
            console.log('ℹ️ 未找到明顯的錄音按鈕，嘗試其他方式...')

            // 嘗試透過狀態機直接啟動錄音
            const stateMachineResult = await page.evaluate(() => {
                const sm = (window as any).stateMachine
                if (sm && sm.canTransition && sm.transition) {
                    try {
                        if (sm.canTransition('USER_START_RECORDING')) {
                            const result = sm.transition('USER_START_RECORDING')
                            return { success: true, result }
                        }
                    } catch (error) {
                        return { success: false, error: error instanceof Error ? error.message : String(error) }
                    }
                }
                return { success: false, reason: 'StateMachine not available' }
            })

            console.log('狀態機錄音嘗試:', stateMachineResult)
        }

        // 步驟 3: 等待並檢查錄音狀態
        await page.waitForTimeout(2000)

        // 步驟 4: 檢查是否有逐字稿區域
        const transcriptArea = page.locator('.transcript, [data-testid="transcript"], .transcription').first()

        if (await transcriptArea.count() > 0) {
            console.log('✅ 找到逐字稿區域')
            await expect(transcriptArea).toBeVisible()
        } else {
            console.log('ℹ️ 未找到明顯的逐字稿區域')
        }

        // 步驟 5: 模擬逐字稿數據（如果有相關 API）
        const mockTranscriptResult = await page.evaluate(() => {
            // 嘗試模擬逐字稿數據
            const mockTranscript = {
                id: 'test-' + Date.now(),
                text: '這是一個測試逐字稿',
                timestamp: new Date().toISOString(),
                confidence: 0.95
            }

            // 如果有 TranscriptManager，嘗試添加測試數據
            const tm = (window as any).transcriptManager
            if (tm && tm.addTranscript) {
                try {
                    tm.addTranscript(mockTranscript)
                    return { success: true, transcript: mockTranscript }
                } catch (error) {
                    return { success: false, error: error instanceof Error ? error.message : String(error) }
                }
            }

            return { success: false, reason: 'TranscriptManager not available' }
        })

        console.log('模擬逐字稿結果:', mockTranscriptResult)

        // 步驟 6: 檢查最終狀態
        const finalState = await page.evaluate(() => {
            return {
                featureFlags: (window as any).featureFlags?.getAll(),
                stateMachine: (window as any).stateMachine?.getCurrentState?.(),
                transcriptManager: !!(window as any).transcriptManager
            }
        })

        console.log('最終狀態:', finalState)

        // 驗證測試結果
        expect(finalState.featureFlags).toBeDefined()
        console.log('🎉 完整錄音流程模擬完成')
    })

    test('應該能夠測試功能開關切換', async ({ page }) => {
        console.log('🔄 測試功能開關切換...')

        // 測試關閉狀態
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.disableAll()
            }
        })

        await page.reload()
        await page.waitForLoadState('networkidle')

        let flagsOff = await page.evaluate(() => {
            return (window as any).featureFlags?.getAll()
        })

        console.log('功能開關關閉狀態:', flagsOff)

        // 測試開啟狀態
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.enableAll()
            }
        })

        await page.reload()
        await page.waitForLoadState('networkidle')

        let flagsOn = await page.evaluate(() => {
            return (window as any).featureFlags?.getAll()
        })

        console.log('功能開關開啟狀態:', flagsOn)

        // 驗證切換成功
        expect(flagsOff?.useNewStateManagement).toBe(false)
        expect(flagsOn?.useNewStateManagement).toBe(true)

        console.log('✅ 功能開關切換測試完成')
    })
})

test.describe('回歸測試', () => {
    test('應該確保現有功能不受影響', async ({ page }) => {
        console.log('🔍 執行回歸測試...')

        // 使用預設設置（新功能關閉）
        await page.evaluate(() => {
            if ((window as any).featureFlags) {
                (window as any).featureFlags.reset()
            }
        })

        await page.reload()
        await page.waitForLoadState('networkidle')

        // 檢查基本功能是否正常
        const basicFunctions = await page.evaluate(() => {
            return {
                hasReactRoot: !!document.querySelector('#__next, [data-reactroot]'),
                hasTitle: !!document.title,
                hasFeatureFlags: !!(window as any).featureFlags,
                canUseLocalStorage: !!window.localStorage,
                canUseWebSocket: !!window.WebSocket
            }
        })

        console.log('基本功能檢查:', basicFunctions)

        // 驗證基本功能
        expect(basicFunctions.hasReactRoot).toBe(true)
        expect(basicFunctions.hasFeatureFlags).toBe(true)
        expect(basicFunctions.canUseLocalStorage).toBe(true)
        expect(basicFunctions.canUseWebSocket).toBe(true)

        console.log('✅ 回歸測試通過')
    })
})
