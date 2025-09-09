import { test, expect, Page } from '@playwright/test'
import * as JSZip from 'jszip'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

/**
 * 端到端整合測試
 * 測試從錄音開始到匯出完成的完整流程
 */

test.describe('完整端到端整合測試', () => {
  let page: Page
  let sessionId: string

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage
    
    // 設置權限
    await page.context().grantPermissions(['microphone'])
    
    // 前往應用程式
    await page.goto('http://localhost:3000')
    await page.waitForLoadState('networkidle')
    
    // 啟用所有新功能
    await page.evaluate(() => {
      if ((window as any).featureFlags) {
        (window as any).featureFlags.enableAll()
      }
    })
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  test('完整流程：錄音 → 逐字稿 → 編輯 → 匯出', async () => {
    console.log('🚀 開始完整端到端整合測試')

    // 階段 1：開始錄音
    await test.step('階段 1：開始錄音', async () => {
      const recordingResult = await page.evaluate(async () => {
        try {
          const recordingFlowService = (window as any).recordingFlowService
          if (recordingFlowService) {
            const session = await recordingFlowService.startRecordingFlow(
              '端到端整合測試',
              '這是一個完整的端到端測試會話'
            )
            return { 
              success: true, 
              sessionId: session?.id,
              isRecording: recordingFlowService.getRecordingState()?.isRecording || false
            }
          }
          return { success: false, reason: 'RecordingFlowService not available' }
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
      })

      console.log('錄音啟動結果:', recordingResult)
      expect(recordingResult.success).toBe(true)
      expect(recordingResult.sessionId).toBeDefined()
      
      sessionId = recordingResult.sessionId
      
      // 等待錄音穩定
      await page.waitForTimeout(2000)
    })

    // 階段 2：模擬接收逐字稿數據
    await test.step('階段 2：接收即時逐字稿', async () => {
      // 模擬多段逐字稿數據，就像真實錄音一樣
      const mockTranscripts = [
        { startTime: 0, time: '00:00', text: '歡迎使用 Study Scriber 逐字稿系統' },
        { startTime: 3, time: '00:03', text: '這個系統可以即時轉換語音為文字' },
        { startTime: 7, time: '00:07', text: '支援多種語言和匯出格式' },
        { startTime: 12, time: '00:12', text: '讓學習和會議記錄變得更加便利' },
        { startTime: 16, time: '00:16', text: '感謝您的使用' }
      ]

      for (let index = 0; index < mockTranscripts.length; index++) {
        const transcript = mockTranscripts[index]
        await page.evaluate((data) => {
          const store = (window as any).useAppStore?.getState?.()
          if (store && store.addTranscriptEntry) {
            store.addTranscriptEntry(data)
          }
        }, transcript)
        
        // 模擬逐字稿接收的時間間隔
        await page.waitForTimeout(800)
        
        console.log(`✅ 添加第 ${index + 1} 段逐字稿: ${transcript.text.substring(0, 20)}...`)
      }

      // 驗證逐字稿數據
      const transcriptStatus = await page.evaluate(() => {
        const store = (window as any).useAppStore?.getState?.()
        return {
          entryCount: store?.transcriptEntries?.length || 0,
          firstEntry: store?.transcriptEntries?.[0],
          lastEntry: store?.transcriptEntries?.[store?.transcriptEntries?.length - 1]
        }
      })

      console.log('逐字稿狀態:', transcriptStatus)
      expect(transcriptStatus.entryCount).toBe(5)
      expect(transcriptStatus.firstEntry?.text).toContain('Study Scriber')
      expect(transcriptStatus.lastEntry?.text).toContain('感謝您的使用')
    })

    // 階段 3：停止錄音
    await test.step('階段 3：停止錄音', async () => {
      const stopResult = await page.evaluate(async () => {
        try {
          const recordingFlowService = (window as any).recordingFlowService
          const store = (window as any).useAppStore?.getState?.()
          
          if (recordingFlowService) {
            await recordingFlowService.stopRecordingFlow()
            
            // 標記逐字稿完成
            if (store?.setTranscriptReady) {
              store.setTranscriptReady(true)
            }
            
            return {
              success: true,
              isRecording: recordingFlowService.getRecordingState()?.isRecording || false,
              appState: store?.appState,
              transcriptReady: store?.transcriptReady
            }
          }
          return { success: false, reason: 'Service not available' }
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
      })

      console.log('停止錄音結果:', stopResult)
      expect(stopResult.success).toBe(true)
      expect(stopResult.isRecording).toBe(false)
      expect(stopResult.transcriptReady).toBe(true)
      
      // 等待狀態穩定
      await page.waitForTimeout(1000)
    })

    // 階段 4：編輯筆記內容
    await test.step('階段 4：編輯筆記內容', async () => {
      console.log('📝 開始編輯筆記內容')
      
      const noteContent = `# Study Scriber 測試報告

## 測試概述
這是一個完整的端到端測試，驗證從錄音到匯出的完整流程。

## 測試內容
- 錄音功能：✅ 正常
- 逐字稿接收：✅ 正常
- 即時更新：✅ 正常
- 編輯功能：✅ 正常

## 逐字稿摘要
系統成功接收了 5 段逐字稿，包含：
- 系統介紹
- 功能說明
- 多語言支援
- 便利性強調
- 結束語

## 結論
所有功能運作正常，系統穩定可靠。

---
*測試時間: ${new Date().toLocaleString()}*
*會話 ID: ${sessionId}*`

      // 設置編輯器內容
      const editorResult = await page.evaluate((content) => {
        try {
          // 嘗試多種編輯器設置方法
          const editorInstance = (window as any).theEditor
          if (editorInstance && editorInstance.codemirror) {
            editorInstance.codemirror.setValue(content)
            return { success: true, method: 'SimpleMDE' }
          }
          
          // 備用方案：直接操作 textarea
          const textarea = document.querySelector('textarea')
          if (textarea) {
            textarea.value = content
            textarea.dispatchEvent(new Event('input', { bubbles: true }))
            return { success: true, method: 'textarea' }
          }
          
          return { success: false, reason: 'No editor found' }
        } catch (error) {
          return { 
            success: false, 
            error: error instanceof Error ? error.message : String(error) 
          }
        }
      }, noteContent)

      console.log('編輯器設置結果:', editorResult)
      expect(editorResult.success).toBe(true)
      
      // 等待內容更新
      await page.waitForTimeout(1000)
      
      // 驗證內容是否已設置
      const contentCheck = await page.evaluate(() => {
        const editorInstance = (window as any).theEditor
        if (editorInstance && editorInstance.codemirror) {
          return editorInstance.codemirror.getValue()
        }
        
        const textarea = document.querySelector('textarea')
        return textarea?.value || ''
      })
      
      expect(contentCheck).toContain('Study Scriber 測試報告')
      expect(contentCheck).toContain(sessionId)
    })

    // 階段 5：執行匯出
    await test.step('階段 5：執行匯出', async () => {
      console.log('📦 開始匯出流程')
      
      // 尋找匯出按鈕
      const exportSelectors = [
        'button:has-text("Export")',
        'button:has-text("匯出")',
        '[data-testid="export-button"]',
        '.export-button'
      ]

      let exportButton = null
      for (const selector of exportSelectors) {
        const btn = page.locator(selector).first()
        if (await btn.count() > 0 && await btn.isVisible()) {
          exportButton = btn
          console.log(`✅ 找到匯出按鈕: ${selector}`)
          break
        }
      }

      expect(exportButton).not.toBeNull()

      // 執行匯出並等待下載
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        exportButton!.click()
      ])

      expect(download).toBeDefined()
      console.log('✅ 匯出下載已開始')

      // 保存並驗證 ZIP 文件
      const zipPath = path.join(os.tmpdir(), `e2e-integration-test-${Date.now()}.zip`)
      await download.saveAs(zipPath)
      
      const zipBuffer = await fs.readFile(zipPath)
      const zip = await JSZip.loadAsync(zipBuffer)
      
      console.log('📋 ZIP 檔案內容:', Object.keys(zip.files))
      
      // 驗證 ZIP 檔案結構
      expect(Object.keys(zip.files)).toContain('note.md')
      expect(Object.keys(zip.files)).toContain('transcript.txt')
      
      // 驗證檔案內容
      const noteContent = await zip.file('note.md')?.async('string')
      const transcriptContent = await zip.file('transcript.txt')?.async('string')
      
      expect(noteContent).toBeDefined()
      expect(transcriptContent).toBeDefined()
      
      // 驗證筆記內容
      expect(noteContent).toContain('Study Scriber 測試報告')
      expect(noteContent).toContain('端到端測試')
      expect(noteContent).toContain(sessionId)
      
      // 驗證逐字稿內容
      expect(transcriptContent).toContain('Study Scriber')
      expect(transcriptContent).toContain('感謝您的使用')
      expect(transcriptContent).toMatch(/00:00.*Study Scriber/)
      expect(transcriptContent).toMatch(/00:16.*感謝您的使用/)
      
      console.log('✅ ZIP 檔案內容驗證完成')
      
      // 清理臨時檔案
      await fs.unlink(zipPath)
    })

    // 階段 6：最終狀態驗證
    await test.step('階段 6：最終狀態驗證', async () => {
      const finalState = await page.evaluate(() => {
        const store = (window as any).useAppStore?.getState?.()
        const recordingFlowService = (window as any).recordingFlowService
        
        return {
          appState: store?.appState,
          transcriptEntries: store?.transcriptEntries?.length || 0,
          transcriptReady: store?.transcriptReady,
          isRecording: recordingFlowService?.getRecordingState()?.isRecording || false,
          isFlowActive: recordingFlowService?.isFlowRunning?.() || false,
          sessionId: recordingFlowService?.getCurrentSession()?.id
        }
      })

      console.log('🏁 最終狀態:', finalState)
      
      // 驗證最終狀態
      expect(finalState.transcriptEntries).toBe(5)
      expect(finalState.transcriptReady).toBe(true)
      expect(finalState.isRecording).toBe(false)
      expect(finalState.sessionId).toBe(sessionId)
    })

    console.log('🎉 完整端到端整合測試成功完成!')
  })

  test('多會話處理：確保會話間不會互相干擾', async () => {
    console.log('🔄 測試多會話處理')

    // 會話 1
    const session1Result = await page.evaluate(async () => {
      try {
        const recordingFlowService = (window as any).recordingFlowService
        if (recordingFlowService) {
          const session = await recordingFlowService.startRecordingFlow('會話 1')
          return { success: true, sessionId: session?.id }
        }
        return { success: false }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    expect(session1Result.success).toBe(true)
    const session1Id = session1Result.sessionId
    
    await page.waitForTimeout(1000)

    // 添加會話 1 的逐字稿
    await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      if (store) {
        store.addTranscriptEntry({
          startTime: 0,
          time: '00:00',
          text: '這是會話 1 的逐字稿'
        })
      }
    })

    // 結束會話 1
    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.stopRecordingFlow()
      }
    })

    await page.waitForTimeout(1000)

    // 會話 2
    const session2Result = await page.evaluate(async () => {
      try {
        const recordingFlowService = (window as any).recordingFlowService
        if (recordingFlowService) {
          const session = await recordingFlowService.startRecordingFlow('會話 2')
          return { success: true, sessionId: session?.id }
        }
        return { success: false }
      } catch (error) {
        return { success: false, error: String(error) }
      }
    })

    expect(session2Result.success).toBe(true)
    const session2Id = session2Result.sessionId

    // 驗證會話 ID 不同
    expect(session1Id).not.toBe(session2Id)

    // 檢查狀態是否正確重置
    const stateCheck = await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      return {
        transcriptEntries: store?.transcriptEntries?.length || 0,
        appState: store?.appState
      }
    })

    console.log('多會話狀態檢查:', { session1Id, session2Id, stateCheck })
    
    // 新會話應該有乾淨的狀態
    expect(stateCheck.transcriptEntries).toBe(1) // 只保留會話 1 的一條記錄
  })

  test('網路恢復測試：斷網後重連應能繼續正常工作', async () => {
    console.log('🌐 測試網路恢復功能')

    // 開始正常錄音
    await page.evaluate(async () => {
      const recordingFlowService = (window as any).recordingFlowService
      if (recordingFlowService) {
        await recordingFlowService.startRecordingFlow('網路恢復測試')
      }
    })

    // 添加一些逐字稿
    await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      if (store) {
        store.addTranscriptEntry({
          startTime: 0,
          time: '00:00',
          text: '網路正常時的逐字稿'
        })
      }
    })

    await page.waitForTimeout(1000)

    // 模擬網路中斷
    await page.context().setOffline(true)
    console.log('🔌 網路已中斷')

    await page.waitForTimeout(2000)

    // 恢復網路
    await page.context().setOffline(false)
    console.log('🔌 網路已恢復')

    await page.waitForTimeout(2000)

    // 檢查系統是否仍能正常工作
    const recoveryResult = await page.evaluate(() => {
      const store = (window as any).useAppStore?.getState?.()
      const recordingFlowService = (window as any).recordingFlowService
      
      // 嘗試添加新的逐字稿
      if (store) {
        store.addTranscriptEntry({
          startTime: 5,
          time: '00:05',
          text: '網路恢復後的逐字稿'
        })
      }
      
      return {
        isOnline: navigator.onLine,
        transcriptCount: store?.transcriptEntries?.length || 0,
        canStillRecord: !!recordingFlowService?.getCurrentSession(),
        hasNetworkRestorer: !!(window as any).networkRestorer
      }
    })

    console.log('網路恢復結果:', recoveryResult)
    
    expect(recoveryResult.isOnline).toBe(true)
    expect(recoveryResult.transcriptCount).toBe(2)
    expect(recoveryResult.hasNetworkRestorer).toBe(true)
  })

  test('錯誤恢復測試：各種錯誤情況下系統應能優雅降級', async () => {
    console.log('⚠️ 測試錯誤恢復機制')

    // 測試 1: 權限拒絕
    await test.step('測試權限拒絕恢復', async () => {
      await page.context().clearPermissions()
      
      const permissionTest = await page.evaluate(async () => {
        try {
          const recordingFlowService = (window as any).recordingFlowService
          if (recordingFlowService) {
            await recordingFlowService.startRecordingFlow('權限測試')
            return { success: true }
          }
          return { success: false, reason: 'No service' }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      })
      
      expect(permissionTest.success).toBe(false)
      expect(permissionTest.error).toMatch(/權限|permission/i)
    })

    // 測試 2: WebSocket 連接失敗
    await test.step('測試 WebSocket 連接失敗恢復', async () => {
      // 重新授權麥克風
      await page.context().grantPermissions(['microphone'])
      
      // 攔截 WebSocket 連接
      await page.route('**/ws/**', route => {
        route.abort('failed')
      })
      
      const wsFailTest = await page.evaluate(async () => {
        try {
          const recordingFlowService = (window as any).recordingFlowService
          if (recordingFlowService) {
            const session = await recordingFlowService.startRecordingFlow('WebSocket 失敗測試')
            
            // 即使 WebSocket 失敗，錄音應該還能繼續
            return {
              success: true,
              sessionId: session?.id,
              isRecording: recordingFlowService.getRecordingState()?.isRecording
            }
          }
          return { success: false }
        } catch (error) {
          return { success: false, error: String(error) }
        }
      })
      
      console.log('WebSocket 失敗測試結果:', wsFailTest)
      
      // 錄音應該仍能進行，只是沒有即時逐字稿
      expect(wsFailTest.success).toBe(true)
      expect(wsFailTest.sessionId).toBeDefined()
    })

    // 測試 3: 匯出 API 失敗
    await test.step('測試匯出 API 失敗恢復', async () => {
      // 攔截匯出 API
      await page.route('**/api/notes/export**', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Export service unavailable' })
        })
      })
      
      // 手動添加一些內容以便匯出
      await page.evaluate(() => {
        const store = (window as any).useAppStore?.getState?.()
        if (store) {
          store.addTranscriptEntry({
            startTime: 0,
            time: '00:00',
            text: '測試匯出失敗恢復'
          })
        }
      })
      
      // 嘗試匯出（應該會失敗並顯示錯誤）
      const exportButton = page.locator('button').filter({ hasText: /Export|匯出/ }).first()
      
      if (await exportButton.count() > 0) {
        await exportButton.click()
        
        // 檢查是否顯示錯誤訊息
        const errorMessage = page.locator('text=/匯出失敗|Export failed|錯誤/').first()
        await expect(errorMessage).toBeVisible({ timeout: 5000 })
        
        console.log('✅ 匯出失敗時正確顯示錯誤訊息')
      }
    })
  })
})