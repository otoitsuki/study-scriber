import axios, { AxiosResponse, AxiosError } from 'axios'
import { LLMConfig, LLMTestResponse } from '@/types/llm-config'

// API 基礎配置 - 使用環境變數
// 若設定為 'internal'，則走同源（由 Next rewrites 代理）
const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'internal'
const API_BASE_URL = rawApiUrl === 'internal' ? '' : rawApiUrl

// 差異化超時配置
const API_TIMEOUTS = {
  session: 15000,    // 會話操作需要更多時間（建立、升級等）
  notes: 8000,       // 筆記操作相對較快
  export: 30000,     // 匯出操作可能需要更長時間
  default: 10000     // 其他操作保持現有設定
} as const

// 錯誤分類：判斷是否可重試
const isRetriableError = (error: AxiosError): boolean => {
  // 網路錯誤（連接失敗、DNS 失敗等）
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') {
    return true
  }

  // 超時錯誤
  if (error.code === 'ECONNRESET' || error.message.includes('timeout')) {
    return true
  }

  // 伺服器錯誤（5xx）
  if (error.response?.status && error.response.status >= 500) {
    return true
  }

  // 特定的 4xx 錯誤（速率限制）
  if (error.response?.status === 429) {
    return true
  }

  return false
}

// 通用重試機制配置
interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
  backoffFactor: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,    // 1秒基礎延遲
  maxDelay: 10000,    // 最大延遲 10秒
  backoffFactor: 2    // 指數退避因子
}

// 將 Axios 錯誤格式化為可讀字串，避免 Next 以 console.error 觸發錯誤覆蓋只顯示 {}
const formatAxiosError = (error: AxiosError, clientName?: string): string => {
  const method = error.config?.method?.toUpperCase()
  const url = error.config?.url
  const status = error.response?.status
  const code = error.code
  const message = error.message

  let dataSnippet = ''
  try {
    const data = (error.response as any)?.data
    if (typeof data === 'string') {
      dataSnippet = data
    } else if (data != null) {
      dataSnippet = JSON.stringify(data)
    }
  } catch {
    dataSnippet = '[unserializable response.data]'
  }

  const parts = [
    clientName ? `client=${clientName}` : undefined,
    method && url ? `${method} ${url}` : url || undefined,
    status != null ? `status=${status}` : undefined,
    code ? `code=${code}` : undefined,
    message ? `message=${message}` : undefined,
    dataSnippet ? `data=${dataSnippet}` : undefined,
  ].filter(Boolean)

  return parts.join(' | ')
}

// 指數退避算法
const calculateDelay = (attempt: number, config: RetryConfig): number => {
  const delay = config.baseDelay * Math.pow(config.backoffFactor, attempt - 1)
  return Math.min(delay, config.maxDelay)
}

// 建立專用的 API 客戶端
const createApiClient = (timeoutMs: number) => {
  return axios.create({
    baseURL: API_BASE_URL,
    timeout: timeoutMs,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

// 不同類型的 API 客戶端
const sessionClient = createApiClient(API_TIMEOUTS.session)
const notesClient = createApiClient(API_TIMEOUTS.notes)
const exportClient = createApiClient(API_TIMEOUTS.export)
const defaultClient = createApiClient(API_TIMEOUTS.default)

// 通用重試包裝器
async function withRetry<T>(
  operation: () => Promise<T>,
  context: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config }

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const result = await operation()

      if (attempt > 1) {
        console.log(`✅ [API重試] ${context} 重試成功 (第 ${attempt} 次嘗試)`)
      }

      return result
    } catch (error) {
      const isLastAttempt = attempt === retryConfig.maxRetries

      if (axios.isAxiosError(error)) {
        // 不可重試的錯誤，立即失敗
        if (!isRetriableError(error)) {
          const formatted = formatAxiosError(error as AxiosError)
          console.warn(`❌ [API重試] ${context} 不可重試錯誤，終止 | ${formatted}`)
          throw error
        }

        // 最後一次嘗試失敗
        if (isLastAttempt) {
          const formatted = formatAxiosError(error as AxiosError)
          console.warn(`❌ [API重試] ${context} 重試失敗 (${retryConfig.maxRetries}/${retryConfig.maxRetries}) | ${formatted}`)
          throw error
        }

        // 計算延遲時間
        const delay = calculateDelay(attempt, retryConfig)

        console.warn(`⚠️ [API重試] ${context} 第 ${attempt} 次嘗試失敗，${delay}ms 後重試...`, {
          status: error.response?.status,
          code: error.code,
          attempt: `${attempt}/${retryConfig.maxRetries}`,
          nextDelay: delay
        })

        // 等待後重試
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        // 非 Axios 錯誤，直接拋出
        throw error
      }
    }
  }

  // 這裡不應該被執行到
  throw new Error(`${context} 重試邏輯異常`)
}

// 統一的回應攔截器設置
const setupInterceptors = (client: typeof sessionClient, clientName: string) => {
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      console.log(`📡 [${clientName}] API 請求成功:`, {
        method: response.config.method?.toUpperCase(),
        url: response.config.url,
        status: response.status,
        duration: response.headers['x-response-time'] || 'unknown'
      })
      return response
    },
    (error: AxiosError) => {
      // 不顯示預期的 404 錯誤（例如：沒有活躍會話）
      const isExpected404 = error.response?.status === 404 &&
        error.config?.url?.includes('/api/session/active')

      if (!isExpected404) {
        // 使用 warning 並輸出字串，避免 Next 將 console.error 轉為錯誤覆蓋且只顯示 {}
        const formatted = formatAxiosError(error, clientName)
        console.warn(`⚠️ API 錯誤: ${formatted}`)
      }

      return Promise.reject(error)
    }
  )
}

// 設置所有客戶端的攔截器
setupInterceptors(sessionClient, 'Session')
setupInterceptors(notesClient, 'Notes')
setupInterceptors(exportClient, 'Export')
setupInterceptors(defaultClient, 'Default')

// 型別定義
export interface SessionCreateRequest {
  title?: string
  type: 'note_only' | 'recording'
  content?: string
  start_ts?: number  // 錄音開始時間戳（毫秒），用於精確時間同步
  language?: string  // BCP-47 語言碼（如 zh-TW, en-US），符合後端 SessionCreateRequest schema
  stt_provider?: string  // 語音轉文字 Provider 名稱（如 whisper, gpt4o）- 已淡化
  llm_config?: LLMConfig  // 自訂 LLM 配置，將覆蓋環境變數設定
}

// STT Provider 類型定義
export type STTProvider = 'whisper' | 'gemini' | 'gpt4o' | 'localhost-breeze'

export interface SessionResponse {
  id: string
  title?: string
  type: 'note_only' | 'recording'
  status: 'draft' | 'active' | 'processing' | 'completed' | 'error'
  language: string
  created_at: string
  updated_at: string
}

export interface NoteUpdateRequest {
  content: string
  client_ts?: string  // ISO 時間戳字串，可選
}

export interface NoteUpdateResponse {
  success: boolean
  message: string
  server_ts: string  // ISO 時間戳字串
  note: NoteResponse
}

export interface NoteResponse {
  session_id: string
  content: string
  client_ts?: string  // ISO 時間戳字串，可選
  created_at: string
  updated_at: string
}

// Session API - 使用會話專用客戶端和重試機制
export const sessionAPI = {
  // 建立新會話（支援 LLM 配置）
  async createSession(data: SessionCreateRequest): Promise<SessionResponse> {
    return withRetry(
      async () => {
        const response = await sessionClient.post('/api/session', data)
        return response.data
      },
      `建立會話 (${data.type})`,
      { maxRetries: 2 } // 會話建立重試次數較少，避免重複建立
    )
  },

  // 獲取活躍會話 - 增強重試機制
  async getActiveSession(): Promise<SessionResponse | null> {
    return withRetry(
      async () => {
        try {
          const response = await sessionClient.get('/api/session/active')
          return response.data
        } catch (error) {
          // 如果沒有活躍會話，返回 null 而不是拋出錯誤
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return null
          }
          throw error
        }
      },
      '檢查活躍會話',
      { maxRetries: 3, baseDelay: 500 } // 更頻繁的重試，基礎延遲較短
    )
  },

  // 完成會話
  async finishSession(sessionId: string): Promise<void> {
    return withRetry(
      async () => {
        await sessionClient.patch(`/api/session/${sessionId}/finish`)
      },
      `完成會話 (${sessionId})`,
      { maxRetries: 2 }
    )
  },

  // 升級會話至錄音模式
  async upgradeToRecording(sessionId: string): Promise<SessionResponse> {
    return withRetry(
      async () => {
        const response = await sessionClient.patch(`/api/session/${sessionId}/upgrade`)
        return response.data
      },
      `升級會話 (${sessionId})`,
      { maxRetries: 2 }
    )
  },

  // 刪除會話及其所有相關數據
  async deleteSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    return withRetry(
      async () => {
        const response = await sessionClient.delete(`/api/session/${sessionId}`)
        return response.data
      },
      `刪除會話 (${sessionId})`,
      { maxRetries: 2 }
    )
  },

  // 測試 LLM 連線配置
  async testLLMConnection(config: LLMConfig): Promise<LLMTestResponse> {
    return withRetry(
      async () => {
        const response = await defaultClient.post('/api/llm/test', {
          base_url: config.baseUrl,
          api_key: config.apiKey,
          model: config.model,
          api_version: config.apiVersion || undefined
        })
        return response.data
      },
      `測試 LLM 連線 (${config.model})`,
      { maxRetries: 1 } // 測試連線不重試，避免多次錯誤嘗試
    )
  },
}

// Notes API - 使用筆記專用客戶端和重試機制
export const notesAPI = {
  // 更新筆記內容
  async updateNote(sessionId: string, data: NoteUpdateRequest): Promise<NoteUpdateResponse> {
    return withRetry(
      async () => {
        const response = await notesClient.put(`/api/notes/${sessionId}`, data)
        return response.data
      },
      `更新筆記 (${sessionId})`,
      { maxRetries: 3, baseDelay: 500 } // 筆記更新重試較積極
    )
  },

  // 獲取筆記內容
  async getNote(sessionId: string): Promise<NoteResponse> {
    return withRetry(
      async () => {
        const response = await notesClient.get(`/api/notes/${sessionId}`)
        return response.data
      },
      `獲取筆記 (${sessionId})`,
      { maxRetries: 3, baseDelay: 500 }
    )
  },
}

// Export API - 使用匯出專用客戶端
export const exportAPI = {
  // 匯出會話資料
  async exportSession(sessionId: string, type: 'zip' | 'md' = 'zip'): Promise<Blob> {
    return withRetry(
      async () => {
        const response = await exportClient.get(`/api/export/${sessionId}`, {
          params: { type },
          responseType: 'blob',
        })
        return response.data
      },
      `匯出會話 (${sessionId})`,
      { maxRetries: 2, baseDelay: 2000 } // 匯出重試延遲較長
    )
  },
}

// WebSocket URL 建構 - 使用環境變數
export const getWebSocketURL = (path: string): string => {
  const rawWs = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
  // 若設定為 'internal'，以同源協議與主機組 ws(s)://origin
  if (rawWs === 'internal' && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}${path}`
  }
  return `${rawWs}${path}`
}

// LLM 配置輔助函數
export const llmConfigUtils = {
  // 從 localStorage 載入 LLM 配置
  loadFromStorage(): LLMConfig | null {
    try {
      const baseUrl = localStorage.getItem('llm_base_url')
      const apiKey = localStorage.getItem('llm_api_key')
      const model = localStorage.getItem('llm_model')
      const apiVersion = localStorage.getItem('llm_api_version')

      if (!baseUrl || !apiKey || !model) {
        return null
      }

      return {
        baseUrl,
        apiKey,
        model,
        apiVersion: apiVersion || undefined
      }
    } catch {
      return null
    }
  },

  // 建立會話時自動附加 LLM 配置
  async createSessionWithLLMConfig(data: Omit<SessionCreateRequest, 'llm_config'>): Promise<SessionResponse> {
    const llmConfig = this.loadFromStorage()

    // 將 camelCase 的 LLM 配置轉換為 snake_case，符合後端 Pydantic 模型
    const requestData: Omit<SessionCreateRequest, 'llm_config'> & { llm_config?: any } = { ...data }
    if (llmConfig) {
      // 正規化 baseUrl：若缺少協定，預設補上 https://
      let baseUrl = llmConfig.baseUrl
      if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
        baseUrl = `https://${baseUrl}`
      }

      requestData.llm_config = {
        base_url: baseUrl,
        api_key: llmConfig.apiKey,
        model: llmConfig.model,
        api_version: llmConfig.apiVersion
      }
    }
    // 日誌請求內容，便於排查後端 500 錯誤
    console.log('🚀 [API] createSession payload:', requestData)

    return sessionAPI.createSession(requestData)
  },

  // 測試當前儲存的 LLM 配置
  async testStoredConfig(): Promise<LLMTestResponse | null> {
    const config = this.loadFromStorage()
    if (!config) {
      return null
    }

    return sessionAPI.testLLMConnection(config)
  }
}

// 匯出重試功能供其他模組使用
export { withRetry, isRetriableError, API_TIMEOUTS }

// 保持向後兼容性
export default defaultClient
