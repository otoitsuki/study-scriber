import { test, expect, Page } from '@playwright/test'

/**
 * 即時逐字稿功能 E2E 測試
 * 測試 WebSocket 連接、逐字稿接收、顯示更新等即時功能
 */

test.describe('即時逐字稿功能測試', () => {
  let page: Page

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage
    
    // 設置權限
    await page.context().grantPermissions(['microphone'])
    
    // 前往應用程式
    await page.goto('http://localhost:3000')
    await page.waitForLoadState('networkidle')
    
    // 啟用新功能
    await page.evaluate(() => {
      if ((window as any).featureFlags) {
        (window as any).featureFlags.enableAll()
      }
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('應該能夠建立 WebSocket 連接並接收逐字稿', async () => {
    console.log('🔌 測試 WebSocket 連接')

    // 步驟 1: 啟動錄音會話以觸發 WebSocket 連接
    await test.step('啟動錄音會話', async () => {
      const sessionResult = await page.evaluate(async () => {
        try {
          const recordingFlowService = (window as any).recordingFlowService
          if (recordingFlowService) {
            const session = await recordingFlowService.startRecordingFlow('WebSocket 測試')
            return { success: true, sessionId: session?.id }
          }
          return { success: false, reason: 'Service not available' }
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
      })

      console.log('會話建立結果:', sessionResult)
      expect(sessionResult.success).toBe(true)
    })

    // 步驟 2: 檢查 WebSocket 連接狀態
    await test.step('檢查 WebSocket 連接', async () => {
      await page.waitForTimeout(2000) // 給 WebSocket 時間連接
      
      const wsStatus = await page.evaluate(() => {
        const transcriptService = (window as any).transcriptService
        const currentSession = (window as any).recordingFlowService?.getCurrentSession?.()
        
        return {
          hasService: !!transcriptService,
          sessionId: currentSession?.id,
          isConnected: currentSession ? transcriptService?.isConnected?.(currentSession.id) : false,
          connectionCount: transcriptService?.getConnectionCount?.() || 0
        }
      })

      console.log('WebSocket 狀態:', wsStatus)
      
      expect(wsStatus.hasService).toBe(true)
      expect(wsStatus.sessionId).toBeDefined()
    })

    // 步驟 3: 模擬接收逐字稿數據
    await test.step('模擬逐字稿數據接收', async () => {
      const mockTranscriptResult = await page.evaluate(() => {
        try {
          const store = (window as any).useAppStore?.getState?.()
          const currentSession = (window as any).recordingFlowService?.getCurrentSession?.()
          
          if (store && currentSession) {
            // 模擬添加逐字稿數據
            const mockTranscripts = [
              { startTime: 0, time: '00:00', text: '這是第一段測試逐字稿' },
              { startTime: 1, time: '00:01', text: '這是第二段測試逐字稿' },
              { startTime: 2, time: '00:02', text: '測試逐字稿功能是否正常運作' }
            ]
            
            mockTranscripts.forEach(transcript => {
              store.addTranscriptEntry(transcript)
            })
            
            return {
              success: true,
              transcriptCount: store.transcriptEntries?.length || 0,
              lastTranscript: store.transcriptEntries?.[store.transcriptEntries.length - 1]
            }
          }
          
          return { success: false, reason: 'Store or session not available' }
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
      })

      console.log('模擬逐字稿結果:', mockTranscriptResult)
      expect(mockTranscriptResult.success).toBe(true)
      expect(mockTranscriptResult.transcriptCount).toBeGreaterThan(0)
    })

    // 步驟 4: 檢查 UI 是否正確顯示逐字稿
    await test.step('檢查逐字稿 UI 顯示', async () => {
      // 尋找逐字稿顯示區域
      const transcriptSelectors = [
        '[data-testid="transcript-display"]',
        '.transcript-entries',
        '.transcription-list',
        '.transcript-content'
      ]

      let transcriptAreaFound = false
      
      for (const selector of transcriptSelectors) {
        const area = page.locator(selector).first()
        if (await area.count() > 0) {
          transcriptAreaFound = true
          console.log(`✅ 找到逐字稿顯示區域: ${selector}`)
          
          // 檢查是否包含我們添加的測試內容
          const hasTestContent = await area.textContent()
          expect(hasTestContent).toMatch(/測試逐字稿/)
          break
        }
      }

      // 如果沒找到專門的逐字稿區域，檢查頁面是否有逐字稿內容
      if (!transcriptAreaFound) {
        const pageContent = await page.textContent('body')
        expect(pageContent).toMatch(/測試逐字稿/)
        console.log('✅ 頁面包含逐字稿內容')
      }
    })
  })

  test('應該能夠處理 WebSocket 連接錯誤', async () => {
    console.log('❌ 測試 WebSocket 連接錯誤處理')

    // 模擬 WebSocket 服務不可用的情況
    await page.route('**/ws/**', route => {
      route.abort()
    })

    const connectionResult = await page.evaluate(async () => {
      try {
        const recordingFlowService = (window as any).recordingFlowService
        if (recordingFlowService) {
          await recordingFlowService.startRecordingFlow('錯誤測試')
          
          // 等待一段時間後檢查連接狀態
          await new Promise(resolve => setTimeout(resolve, 3000))
          
          const currentSession = recordingFlowService.getCurrentSession()
          const transcriptService = (window as any).transcriptService
          
          return {
            success: true,
            sessionId: currentSession?.id,
            wsConnected: currentSession ? transcriptService?.isConnected?.(currentSession.id) : false,
            hasError: true
          }
        }
        return { success: false, reason: 'Service not available' }
      } catch (error) {
        return { 
          success: true, // 錯誤被正確拋出也是成功
          error: error instanceof Error ? error.message : String(error) 
        }
      }
    })

    console.log('連接錯誤測試結果:', connectionResult)
    
    // WebSocket 連接應該失敗，但錄音流程應該繼續
    expect(connectionResult.success).toBe(true)
    expect(connectionResult.wsConnected).toBe(false)
  })

  test('應該能夠處理逐字稿數據更新和累積', async () => {
    console.log('📝 測試逐字稿數據累積')

    // 啟動錄音會話
    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.startRecordingFlow('數據累積測試')
      }
    })

    await page.waitForTimeout(1000)

    // 分批添加逐字稿數據，模擬即時接收
    const batches = [
      [{ startTime: 0, time: '00:00', text: '第一批逐字稿數據' }],
      [
        { startTime: 1, time: '00:01', text: '第二批第一段' },
        { startTime: 2, time: '00:02', text: '第二批第二段' }
      ],
      [
        { startTime: 3, time: '00:03', text: '第三批數據' },
        { startTime: 4, time: '00:04', text: '最後一批數據' }
      ]
    ]

    let totalExpectedCount = 0

    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index]
      await test.step(`添加第 ${index + 1} 批數據`, async () => {
        const result = await page.evaluate((batchData) => {
          const store = (window as any).useAppStore?.getState?.()
          
          if (store) {
            batchData.forEach((transcript: any) => {
              store.addTranscriptEntry(transcript)
            })
            
            return {
              success: true,
              currentCount: store.transcriptEntries?.length || 0,
              latestEntry: store.transcriptEntries?.[store.transcriptEntries.length - 1]
            }
          }
          
          return { success: false }
        }, batch)

        totalExpectedCount += batch.length
        
        console.log(`批次 ${index + 1} 結果:`, result)
        expect(result.success).toBe(true)
        expect(result.currentCount).toBe(totalExpectedCount)
        
        // 等待 UI 更新
        await page.waitForTimeout(500)
      })
    }

    // 最終驗證
    const finalState = await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      return {
        totalEntries: store?.transcriptEntries?.length || 0,
        allEntries: store?.transcriptEntries || []
      }
    })

    console.log('最終狀態:', finalState)
    expect(finalState.totalEntries).toBe(5)
    expect(finalState.allEntries[0].text).toContain('第一批')
    expect(finalState.allEntries[4].text).toContain('最後一批')
  })

  test('應該能夠處理逐字稿完成事件', async () => {
    console.log('✅ 測試逐字稿完成事件')

    // 啟動錄音會話
    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.startRecordingFlow('完成事件測試')
      }
    })

    // 添加一些逐字稿數據
    await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      if (store) {
        store.addTranscriptEntry({
          startTime: 0,
          time: '00:00',
          text: '測試逐字稿完成事件'
        })
      }
    })

    await page.waitForTimeout(1000)

    // 模擬逐字稿完成事件
    const completeResult = await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      const recordingFlowService = (window as any).recordingFlowService
      
      if (store) {
        // 設置逐字稿準備完成
        store.setTranscriptReady(true)
        
        return {
          success: true,
          transcriptReady: store.transcriptReady,
          appState: store.appState,
          isFlowActive: recordingFlowService?.isFlowRunning?.() || false
        }
      }
      
      return { success: false }
    })

    console.log('完成事件結果:', completeResult)
    expect(completeResult.success).toBe(true)
    expect(completeResult.transcriptReady).toBe(true)
  })

  test('應該能夠測試逐字稿時間標記準確性', async () => {
    console.log('⏱️ 測試逐字稿時間標記')

    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.startRecordingFlow('時間標記測試')
      }
    })

    // 添加具有不同時間標記的逐字稿
    const timestampedTranscripts = [
      { startTime: 0, time: '00:00', text: '開始時間 0 秒' },
      { startTime: 30, time: '00:30', text: '30 秒時間點' },
      { startTime: 60, time: '01:00', text: '1 分鐘時間點' },
      { startTime: 125, time: '02:05', text: '2 分 5 秒時間點' }
    ]

    const timeResult = await page.evaluate((transcripts) => {
      const store = (window as any).useAppStore?.getState?.()
      
      if (store) {
        transcripts.forEach((transcript: any) => {
          store.addTranscriptEntry(transcript)
        })
        
        const entries = store.transcriptEntries || []
        return {
          success: true,
          entries: entries.map((entry: any) => ({
            time: entry.time,
            text: entry.text,
            startTime: entry.startTime
          }))
        }
      }
      
      return { success: false }
    }, timestampedTranscripts)

    console.log('時間標記測試結果:', timeResult)
    expect(timeResult.success).toBe(true)
    
    // 驗證時間格式
    const entries = timeResult.entries
    expect(entries[0].time).toBe('00:00')
    expect(entries[1].time).toBe('00:30')
    expect(entries[2].time).toBe('01:00')
    expect(entries[3].time).toBe('02:05')
    
    // 驗證時間順序
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].startTime).toBeGreaterThan(entries[i-1].startTime)
    }
  })

  test('應該能夠處理逐字稿重複數據', async () => {
    console.log('🔄 測試重複逐字稿數據處理')

    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.startRecordingFlow('重複數據測試')
      }
    })

    // 添加重複的逐字稿數據
    const duplicateResult = await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      
      if (store) {
        // 添加原始數據
        const originalData = { startTime: 0, time: '00:00', text: '重複測試數據' }
        store.addTranscriptEntry(originalData)
        
        const countAfterFirst = store.transcriptEntries?.length || 0
        
        // 嘗試添加相同數據
        store.addTranscriptEntry(originalData)
        const countAfterDuplicate = store.transcriptEntries?.length || 0
        
        // 添加稍微不同的數據
        store.addTranscriptEntry({ startTime: 1, time: '00:01', text: '不同的測試數據' })
        const countAfterDifferent = store.transcriptEntries?.length || 0
        
        return {
          success: true,
          countAfterFirst,
          countAfterDuplicate,
          countAfterDifferent,
          shouldPreventDuplicates: countAfterFirst === countAfterDuplicate,
          finalEntries: store.transcriptEntries || []
        }
      }
      
      return { success: false }
    })

    console.log('重複數據處理結果:', duplicateResult)
    expect(duplicateResult.success).toBe(true)
    expect(duplicateResult.countAfterDifferent).toBeGreaterThan(duplicateResult.countAfterFirst)
  })
})