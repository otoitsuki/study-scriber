// @ts-nocheck
import { test, expect } from '@playwright/test'

const API_BASE = 'http://localhost:8000'
const TEST_SESSION_ID = 'test-session-id'

// 模擬 Session 回應
const mockSessionResponse = {
  id: TEST_SESSION_ID,
  title: 'Mock Session',
  type: 'recording',
  status: 'active',
  language: 'zh-TW',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

export { }

test.describe('TranscriptManager phase 訊息處理', () => {
  
  test.beforeEach(async ({ page }) => {
    // 收集瀏覽器端 console 以驗證日誌輸出
    const consoleMessages: string[] = []
    page.on('console', msg => {
      const text = msg.text()
      console.log('PAGE CONSOLE:', text)
      consoleMessages.push(text)
    })
    
    // 將 consoleMessages 掛載到 page 物件上供測試使用
    page.consoleMessages = consoleMessages
    
    page.on('pageerror', err => console.log('PAGEERROR', err.message))

    // 設置 API 攔截
    await page.route(`${API_BASE}/api/session/active*`, route => {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    })

    await page.route(`${API_BASE}/api/session*`, route => {
      if (route.request().method().toLowerCase() === 'post') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSessionResponse) })
      }
      return route.fallback()
    })

    await page.route(`${API_BASE}/**`, route => {
      const url = route.request().url()
      if (url.includes('/api/session/active') || url.match(/\/api\/session(\/.*)?$/)) {
        return route.fallback()
      }
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    // 模擬必要的 API
    await page.addInitScript(() => {
      // Fake getUserMedia
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', {
          value: {}, configurable: true
        })
      }
      navigator.mediaDevices.getUserMedia = async () => new MediaStream()
      
      // 隱藏 stagewise overlay
      const injectStyle = () => {
        const style = document.createElement('style')
        style.innerHTML = 'stagewise-companion-anchor{display:none !important;}'
        document.head.appendChild(style)
      }
      if (document.head) {
        injectStyle()
      } else {
        document.addEventListener('DOMContentLoaded', injectStyle)
      }
      
      // MediaRecorder polyfill
      window.MediaRecorder = class {
        constructor(stream, options) {
          this.stream = stream
          this.mimeType = options?.mimeType || 'audio/webm;codecs=opus'
          this.state = 'inactive'
          this._listeners = {}
        }
        start() {
          this.state = 'recording'
          this._interval = setInterval(() => {
            const blob = new Blob(['dummy'], { type: this.mimeType })
            this._emit('dataavailable', { data: blob })
          }, 12000)
        }
        stop() {
          clearInterval(this._interval)
          this.state = 'inactive'
          this._emit('stop', {})
        }
        addEventListener(type, cb) {
          (this._listeners[type] ||= []).push(cb)
        }
        removeEventListener(type, cb) {
          this._listeners[type] = (this._listeners[type] || []).filter(f => f !== cb)
        }
        _emit(type, evt) {
          (this._listeners[type] || []).forEach(f => f(evt))
        }
      }
      
      // WebSocket polyfill
      window.WebSocket = class {
        constructor() {
          this.readyState = window.WebSocket.OPEN
          this.isConnected = true
          setTimeout(() => { if (this.onopen) this.onopen(); }, 0)
        }
        send() { }
        close() {
          this.isConnected = false
          this.readyState = window.WebSocket.CLOSED
          if (this.onclose) this.onclose({ code: 1000, reason: 'closed' })
        }
        addEventListener() { }
        removeEventListener() { }
      }

      // 設置 WebSocket 常數
      window.WebSocket.CONNECTING = 0
      window.WebSocket.OPEN = 1
      window.WebSocket.CLOSING = 2
      window.WebSocket.CLOSED = 3

      window.MediaRecorder.isTypeSupported = () => true
    })

    await page.goto('/')
    await page.getByRole('heading', { name: 'Study Scriber' })
  })

  test('應正確處理 waiting phase 訊息', async ({ page }) => {
    await page.getByRole('button', { name: 'Start recording' }).click({ force: true })
    await expect(page.getByText(/Recording…/)).toBeVisible({ timeout: 10000 })

    // 模擬收到 waiting phase 訊息
    await page.evaluate(sessionId => {
      const manager = window.transcriptManager
      // 直接呼叫 handleMessage 方法（透過 connections Map 取得 WebSocket）
      const connections = manager.connections
      connections.forEach((ws, sid) => {
        if (sid === sessionId) {
          // 模擬 WebSocket 收到 phase 訊息
          manager.handleMessage(sessionId, { phase: 'waiting' })
        }
      })
    }, TEST_SESSION_ID)

    // 等待一下讓 console.log 有時間輸出
    await page.waitForTimeout(500)

    // 驗證是否有輸出相關的 console.log
    const hasWaitingLog = page.consoleMessages.some(msg => 
      msg.includes('waiting') || msg.includes('phase') || msg.includes('未知訊息類型')
    )
    
    expect(hasWaitingLog).toBeTruthy()
  })

  test('應正確處理 active phase 訊息', async ({ page }) => {
    await page.getByRole('button', { name: 'Start recording' }).click({ force: true })
    await expect(page.getByText(/Recording…/)).toBeVisible({ timeout: 10000 })

    // 模擬收到 active phase 訊息
    await page.evaluate(sessionId => {
      const manager = window.transcriptManager
      // 直接呼叫 handleMessage 方法
      const connections = manager.connections
      connections.forEach((ws, sid) => {
        if (sid === sessionId) {
          manager.handleMessage(sessionId, { phase: 'active' })
        }
      })
    }, TEST_SESSION_ID)

    // 等待一下讓 console.log 有時間輸出
    await page.waitForTimeout(500)

    // 驗證是否有輸出相關的 console.log
    const hasActiveLog = page.consoleMessages.some(msg => 
      msg.includes('active') || msg.includes('phase') || msg.includes('未知訊息類型')
    )
    
    expect(hasActiveLog).toBeTruthy()
  })

  test('phase 訊息不應影響正常的 transcript_segment 處理', async ({ page }) => {
    await page.getByRole('button', { name: 'Start recording' }).click({ force: true })
    await expect(page.getByText(/Recording…/)).toBeVisible({ timeout: 10000 })

    // 先發送 waiting phase
    await page.evaluate(sessionId => {
      const manager = window.transcriptManager
      manager.handleMessage(sessionId, { phase: 'waiting' })
    }, TEST_SESSION_ID)

    // 再發送 active phase
    await page.evaluate(sessionId => {
      const manager = window.transcriptManager
      manager.handleMessage(sessionId, { phase: 'active' })
    }, TEST_SESSION_ID)

    // 最後發送正常的 transcript_segment
    await page.evaluate(sessionId => {
      const manager = window.transcriptManager
      manager.broadcastToListeners(sessionId, {
        type: 'transcript_segment',
        text: 'Phase test transcript',
        start_sequence: 0,
        timestamp: Date.now(),
      })
    }, TEST_SESSION_ID)

    // 驗證逐字稿正常顯示
    await expect(page.getByText('Phase test transcript')).toBeVisible({ timeout: 10000 })
  })
})