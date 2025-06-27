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

test('錄音開始後應先顯示 waiting 再顯示 transcript', async ({ page }) => {
  // 收集瀏覽器端 console / error 以利除錯
  page.on('console', msg => console.log('PAGE', msg.type(), msg.text()))
  page.on('pageerror', err => console.log('PAGEERROR', err.message))

  // 精確攔截
  await page.route(`${API_BASE}/api/session/active*`, route => {
    // 無活躍會話 → 回 404
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
  })

  await page.route(`${API_BASE}/api/session*`, route => {
    // 建立新 session
    if (route.request().method().toLowerCase() === 'post') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockSessionResponse) })
    }
    return route.fallback()
  })

  // 其他 API 統一 200（但保留 /api/session 相關路徑給前面的攔截）
  await page.route(`${API_BASE}/**`, route => {
    const url = route.request().url()
    if (url.includes('/api/session/active') || url.match(/\/api\/session(\/.*)?$/)) {
      return route.fallback()
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })

  // 偽造 getUserMedia 與 MediaRecorder
  await page.addInitScript(() => {
    // Fake getUserMedia returns empty MediaStream
    if (!navigator.mediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {}, configurable: true
      })
    }
    navigator.mediaDevices.getUserMedia = async () => new MediaStream()
    // hide stagewise overlay if present
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
    // Minimal MediaRecorder polyfill
    window.MediaRecorder = class {
      constructor(stream, options) {
        this.stream = stream
        this.mimeType = options?.mimeType || 'audio/webm;codecs=opus'
        this.state = 'inactive'
        this._listeners = {}
      }
      start() {
        this.state = 'recording'
        // 每 12s 產生一次假 blob（測試用不需真實音訊）
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
    // Minimal WebSocket polyfill to auto-connect
    window.WebSocket = class {
      constructor() {
        this.readyState = window.WebSocket.OPEN; // 使用正確的常數
        this.isConnected = true; // 添加 isConnected 屬性
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

  // 保險：若頁面尚未渲染完成，等待 header
  await page.getByRole('heading', { name: 'Study Scriber' })

  await page.getByRole('button', { name: 'Start recording' }).click({ force: true })

  // 等待進入錄音畫面（右側出現 Recording… 文字）
  await expect(page.getByText(/Recording…/)).toBeVisible({ timeout: 10000 })

  await page.evaluate(sessionId => {
    const manager = window.transcriptManager
    manager.broadcastToListeners(sessionId, {
      type: 'transcript_segment',
      text: 'Hello world',
      start_sequence: 0,
      timestamp: Date.now(),
    })
  }, TEST_SESSION_ID)

  await expect(page.getByText('Hello world')).toBeVisible({ timeout: 10000 })
})
