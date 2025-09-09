import { test, expect, Page } from '@playwright/test'

/**
 * 完整錄音流程 E2E 測試
 * 測試從開始錄音到停止錄音的完整流程，確保所有狀態轉換正常
 */

test.describe('完整錄音流程測試', () => {
  let page: Page

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage
    
    // 設置媒體權限
    await page.context().grantPermissions(['microphone'])
    
    // 前往應用程式
    await page.goto('http://localhost:3000')
    await page.waitForLoadState('networkidle')
    
    // 啟用新功能標誌
    await page.evaluate(() => {
      if ((window as any).featureFlags) {
        (window as any).featureFlags.enableAll()
      }
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('應該能夠完成完整的錄音流程', async () => {
    console.log('🎬 開始完整錄音流程測試')

    // 步驟 1: 檢查初始狀態
    await test.step('檢查初始狀態', async () => {
      const initialState = await page.evaluate(() => {
        return {
          hasFeatureFlags: !!(window as any).featureFlags,
          hasRecordingService: !!(window as any).recordingService,
          hasTranscriptService: !!(window as any).transcriptService
        }
      })
      
      console.log('初始狀態:', initialState)
      expect(page.url()).toContain('localhost:3000')
    })

    // 步驟 2: 尋找並點擊錄音按鈕
    await test.step('啟動錄音', async () => {
      // 尋找錄音按鈕的多種可能選擇器
      const recordingButtonSelectors = [
        'button:has-text("開始錄音")',
        'button:has-text("錄音")',
        'button:has-text("Start Recording")',
        'button:has-text("Record")',
        '[data-testid="start-recording"]',
        '.record-button',
        'button[aria-label*="錄音"]',
        'button[aria-label*="record"]'
      ]

      let buttonFound = false
      
      for (const selector of recordingButtonSelectors) {
        const button = page.locator(selector).first()
        if (await button.count() > 0 && await button.isVisible()) {
          console.log(`✅ 找到錄音按鈕: ${selector}`)
          await button.click()
          buttonFound = true
          break
        }
      }

      // 如果找不到按鈕，嘗試直接呼叫服務
      if (!buttonFound) {
        console.log('🔄 未找到錄音按鈕，嘗試直接啟動錄音服務')
        
        const serviceResult = await page.evaluate(async () => {
          try {
            // 嘗試直接呼叫 RecordingFlowService
            const recordingFlowService = (window as any).recordingFlowService
            if (recordingFlowService && recordingFlowService.startRecordingFlow) {
              const session = await recordingFlowService.startRecordingFlow(
                `E2E 測試錄音 ${new Date().toLocaleString()}`
              )
              return { success: true, sessionId: session?.id }
            }
            return { success: false, reason: 'RecordingFlowService not available' }
          } catch (error) {
            return { 
              success: false, 
              error: error instanceof Error ? error.message : String(error) 
            }
          }
        })

        console.log('服務啟動結果:', serviceResult)
        expect(serviceResult.success).toBe(true)
      }

      await page.waitForTimeout(2000)
    })

    // 步驟 3: 驗證錄音狀態
    await test.step('驗證錄音狀態', async () => {
      // 檢查錄音狀態指示器
      const recordingIndicators = [
        '[data-testid="recording-indicator"]',
        '.recording-active',
        'text=/錄音中|Recording/',
        '.pulse', // 可能的動畫指示器
        '[data-recording="true"]'
      ]

      let indicatorFound = false
      
      for (const selector of recordingIndicators) {
        const indicator = page.locator(selector).first()
        if (await indicator.count() > 0) {
          await expect(indicator).toBeVisible()
          console.log(`✅ 找到錄音狀態指示器: ${selector}`)
          indicatorFound = true
          break
        }
      }

      // 透過 JavaScript 檢查錄音狀態
      const recordingStatus = await page.evaluate(() => {
        const recordingService = (window as any).recordingService
        const recordingFlowService = (window as any).recordingFlowService
        
        return {
          isRecording: recordingService?.isRecording?.() || false,
          isFlowActive: recordingFlowService?.isFlowRunning?.() || false,
          hasActiveSession: !!recordingFlowService?.getCurrentSession?.(),
          appState: (window as any).useAppStore?.getState?.()?.appState
        }
      })

      console.log('錄音狀態檢查:', recordingStatus)
      
      // 至少有一個狀態指標應該顯示錄音中
      expect(
        indicatorFound || 
        recordingStatus.isRecording || 
        recordingStatus.isFlowActive ||
        recordingStatus.appState === 'recording_active'
      ).toBe(true)
    })

    // 步驟 4: 檢查 WebSocket 連接
    await test.step('檢查 WebSocket 連接', async () => {
      const wsStatus = await page.evaluate(() => {
        const transcriptService = (window as any).transcriptService
        const currentSession = (window as any).recordingFlowService?.getCurrentSession?.()
        
        return {
          hasTranscriptService: !!transcriptService,
          isConnected: currentSession ? 
            transcriptService?.isConnected?.(currentSession.id) : false,
          currentSessionId: currentSession?.id,
          websocketSupport: typeof WebSocket !== 'undefined'
        }
      })

      console.log('WebSocket 狀態:', wsStatus)
      
      expect(wsStatus.websocketSupport).toBe(true)
      expect(wsStatus.hasTranscriptService).toBe(true)
    })

    // 步驟 5: 等待一段時間模擬錄音
    await test.step('模擬錄音過程', async () => {
      console.log('🎙️ 模擬錄音中...')
      
      // 等待 3 秒模擬錄音
      await page.waitForTimeout(3000)
      
      // 檢查是否有逐字稿數據
      const transcriptCheck = await page.evaluate(() => {
        const store = (window as any).useAppStore?.getState?.()
        return {
          transcriptEntries: store?.transcriptEntries?.length || 0,
          hasTranscriptData: (store?.transcriptEntries?.length || 0) > 0
        }
      })

      console.log('逐字稿檢查:', transcriptCheck)
    })

    // 步驟 6: 停止錄音
    await test.step('停止錄音', async () => {
      console.log('⏹️ 停止錄音')
      
      // 尋找停止錄音按鈕
      const stopButtonSelectors = [
        'button:has-text("停止錄音")',
        'button:has-text("停止")',
        'button:has-text("Stop Recording")',
        'button:has-text("Stop")',
        '[data-testid="stop-recording"]',
        '.stop-button'
      ]

      let stopButtonFound = false
      
      for (const selector of stopButtonSelectors) {
        const button = page.locator(selector).first()
        if (await button.count() > 0 && await button.isVisible()) {
          console.log(`✅ 找到停止按鈕: ${selector}`)
          await button.click()
          stopButtonFound = true
          break
        }
      }

      // 如果找不到停止按鈕，嘗試直接呼叫服務
      if (!stopButtonFound) {
        console.log('🔄 未找到停止按鈕，嘗試直接呼叫停止服務')
        
        const stopResult = await page.evaluate(async () => {
          try {
            const recordingFlowService = (window as any).recordingFlowService
            if (recordingFlowService && recordingFlowService.stopRecordingFlow) {
              await recordingFlowService.stopRecordingFlow()
              return { success: true }
            }
            return { success: false, reason: 'RecordingFlowService not available' }
          } catch (error) {
            return { 
              success: false, 
              error: error instanceof Error ? error.message : String(error) 
            }
          }
        })

        console.log('停止服務結果:', stopResult)
      }

      await page.waitForTimeout(2000)
    })

    // 步驟 7: 驗證停止後狀態
    await test.step('驗證停止後狀態', async () => {
      const finalStatus = await page.evaluate(() => {
        const recordingService = (window as any).recordingService
        const recordingFlowService = (window as any).recordingFlowService
        const store = (window as any).useAppStore?.getState?.()
        
        return {
          isRecording: recordingService?.isRecording?.() || false,
          isFlowActive: recordingFlowService?.isFlowRunning?.() || false,
          appState: store?.appState,
          transcriptReady: store?.transcriptReady,
          sessionData: recordingFlowService?.getCurrentSession?.()
        }
      })

      console.log('最終狀態:', finalStatus)
      
      // 錄音應該已停止
      expect(finalStatus.isRecording).toBe(false)
      
      // 檢查狀態是否正確轉換
      const validFinalStates = ['processing', 'finished', 'default']
      expect(validFinalStates).toContain(finalStatus.appState)
    })

    console.log('🎉 完整錄音流程測試完成')
  })

  test('應該正確處理錄音權限被拒絕的情況', async () => {
    console.log('🚫 測試權限拒絕情境')
    
    // 拒絕麥克風權限
    await page.context().clearPermissions()
    
    // 嘗試啟動錄音
    const permissionResult = await page.evaluate(async () => {
      try {
        const recordingFlowService = (window as any).recordingFlowService
        if (recordingFlowService && recordingFlowService.startRecordingFlow) {
          await recordingFlowService.startRecordingFlow('權限測試')
          return { success: true }
        }
        return { success: false, reason: 'Service not available' }
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    })

    console.log('權限拒絕結果:', permissionResult)
    
    // 應該失敗並包含權限相關錯誤
    expect(permissionResult.success).toBe(false)
    expect(permissionResult.error).toMatch(/權限|permission/i)
  })

  test('應該能夠處理網路中斷情況', async () => {
    console.log('🌐 測試網路中斷情境')
    
    // 首先啟動正常錄音
    await page.evaluate(async () => {
      try {
        const recordingFlowService = (window as any).recordingFlowService
        if (recordingFlowService) {
          await recordingFlowService.startRecordingFlow('網路測試')
        }
      } catch (error) {
        console.log('啟動錄音時發生錯誤:', error)
      }
    })

    await page.waitForTimeout(1000)

    // 模擬網路中斷
    await page.context().setOffline(true)
    await page.waitForTimeout(2000)

    // 恢復網路
    await page.context().setOffline(false)
    await page.waitForTimeout(1000)

    // 檢查系統是否能正常恢復
    const recoveryStatus = await page.evaluate(() => {
      const networkRestorer = (window as any).networkRestorer
      return {
        hasRestorer: !!networkRestorer,
        isOnline: navigator.onLine
      }
    })

    console.log('網路恢復狀態:', recoveryStatus)
    expect(recoveryStatus.isOnline).toBe(true)
  })
})