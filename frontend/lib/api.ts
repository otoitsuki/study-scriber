import axios, { AxiosResponse, AxiosError } from 'axios'

// API 基礎配置 - 使用環境變數
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 請求攔截器 - 添加錯誤處理
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    // 不顯示預期的 404 錯誤（例如：沒有活躍會話）
    if (!(error.response?.status === 404 && error.config?.url?.includes('/api/session/active'))) {
      console.error('API Error:', error.response?.data || error.message)
    }
    return Promise.reject(error)
  }
)

// 型別定義
export interface SessionCreateRequest {
  title: string
  type: 'note_only' | 'recording'
  content?: string
}

export interface SessionResponse {
  id: string
  title: string
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

// Session API
export const sessionAPI = {
  // 建立新會話
  async createSession(data: SessionCreateRequest): Promise<SessionResponse> {
    const response = await apiClient.post('/api/session', data)
    return response.data
  },

  // 獲取活躍會話
  async getActiveSession(): Promise<SessionResponse | null> {
    try {
      const response = await apiClient.get('/api/session/active')
      return response.data
    } catch (error) {
      // 如果沒有活躍會話，返回 null 而不是拋出錯誤
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      throw error
    }
  },

  // 完成會話
  async finishSession(sessionId: string): Promise<void> {
    await apiClient.patch(`/api/session/${sessionId}/finish`)
  },

  // 升級會話至錄音模式
  async upgradeToRecording(sessionId: string): Promise<SessionResponse> {
    const response = await apiClient.patch(`/api/session/${sessionId}/upgrade`)
    return response.data
  },

  // 刪除會話及其所有相關數據
  async deleteSession(sessionId: string): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.delete(`/api/session/${sessionId}`)
    return response.data
  },
}

// Notes API
export const notesAPI = {
  // 更新筆記內容
  async updateNote(sessionId: string, data: NoteUpdateRequest): Promise<NoteUpdateResponse> {
    const response = await apiClient.put(`/api/notes/${sessionId}`, data)
    return response.data
  },

  // 獲取筆記內容
  async getNote(sessionId: string): Promise<NoteResponse> {
    const response = await apiClient.get(`/api/notes/${sessionId}`)
    return response.data
  },
}

// Export API
export const exportAPI = {
  // 匯出會話資料
  async exportSession(sessionId: string, type: 'zip' | 'md' = 'zip'): Promise<Blob> {
    const response = await apiClient.get(`/api/export/${sessionId}`, {
      params: { type },
      responseType: 'blob',
    })
    return response.data
  },
}

// WebSocket URL 建構 - 使用環境變數
export const getWebSocketURL = (path: string): string => {
  const wsBaseURL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
  return `${wsBaseURL}${path}`
}

export default apiClient
