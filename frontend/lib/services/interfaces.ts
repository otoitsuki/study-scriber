"use client"

import type { SessionResponse } from '../api'

/**
 * 服務層介面定義
 *
 * 提供統一的服務契約，確保類型安全和一致性
 */

/**
 * 錄音流程啟動結果
 *
 * RecordingFlowService.startRecordingFlow() 的返回類型
 * 成功時直接返回 SessionResponse，失敗時拋出 Error
 */
export type StartRecordingResult = SessionResponse

/**
 * 會話管理服務介面
 */
export interface ISessionService {
    /**
     * 確保錄音會話存在 - 優雅處理會話衝突
     *
     * 策略：
     * 1. 優先嘗試創建新的錄音會話
     * 2. 若遇到 409 衝突，改為獲取現有活躍會話
     * 3. 確保返回可用的錄音會話
     */
    ensureRecordingSession(title?: string, content?: string, startTs?: number): Promise<SessionResponse>

    /**
     * 創建錄音會話
     */
    createRecordingSession(title: string, content?: string, startTs?: number): Promise<SessionResponse>

    /**
     * 創建純筆記會話
     */
    createNoteSession(title: string, content?: string): Promise<SessionResponse>

    /**
     * 升級會話至錄音模式
     */
    upgradeToRecording(sessionId: string): Promise<SessionResponse>

    /**
     * 完成會話
     */
    finishSession(sessionId: string): Promise<void>

    /**
     * 檢查活躍會話
     */
    checkActiveSession(): Promise<SessionResponse | null>

    /**
     * 等待會話在資料庫中完全可見
     */
    waitForSessionReady(sessionId: string, maxWaitTime?: number): Promise<boolean>

    /**
     * 刪除會話
     */
    deleteSession(sessionId: string): Promise<void>
}

/**
 * 錄音狀態
 */
export interface RecordingState {
    isRecording: boolean
    recordingTime: number
    currentSessionId: string | null
    error: string | null
}

/**
 * 錄音服務介面
 */
export interface IRecordingService {
    /**
     * 開始錄音
     */
    startRecording(sessionId: string): Promise<void>

    /**
     * 停止錄音
     */
    stopRecording(): Promise<void>

    /**
     * 取得當前錄音狀態
     */
    getRecordingState(): RecordingState

    /**
     * 檢查是否正在錄音
     */
    isRecording(): boolean

    /**
     * 取得錄音時間（秒）
     */
    getRecordingTime(): number
}

/**
 * 逐字稿訊息類型
 */
export interface TranscriptMessage {
    type: string
    text?: string
    start_time?: number
    end_time?: number
    start_sequence?: number
    confidence?: number
    timestamp?: number
    phase?: string
    message?: string
    error_type?: string
    error_message?: string
    details?: any
}

/**
 * 逐字稿項目
 */
export interface TranscriptEntry {
    time: string
    text: string
}

/**
 * 逐字稿服務介面
 */
export interface ITranscriptService {
    /**
     * 連接逐字稿服務
     */
    connect(sessionId: string): Promise<void>

    /**
     * 斷開逐字稿服務
     */
    disconnect(sessionId?: string): Promise<void>

    /**
     * 添加逐字稿監聽器
     */
    addTranscriptListener(sessionId: string, callback: (message: TranscriptMessage) => void): void

    /**
     * 移除逐字稿監聽器
     */
    removeTranscriptListener(sessionId: string, callback: (message: TranscriptMessage) => void): void

    /**
     * 檢查連接狀態
     */
    isConnected(sessionId: string): boolean

    /**
     * 清除逐字稿
     */
    clearTranscripts(sessionId: string): void
}

/**
 * 服務容器介面
 */
export interface IServiceContainer {
    /**
     * 註冊服務
     */
    register<T>(key: string, factory: () => T): void

    /**
     * 註冊單例服務
     */
    registerSingleton<T>(key: string, factory: () => T): void

    /**
     * 解析服務
     */
    resolve<T>(key: string): T

    /**
     * 檢查服務是否已註冊
     */
    isRegistered(key: string): boolean

    /**
     * 取得已註冊的服務清單
     */
    getRegisteredServices(): string[]
}

/**
 * 服務註冊鍵值常數
 * 避免字串拼寫錯誤，提供類型安全的服務鍵值
 */
export const SERVICE_KEYS = {
    SESSION_SERVICE: 'SessionService',
    RECORDING_SERVICE: 'RecordingService',
    TRANSCRIPT_SERVICE: 'TranscriptService',
    RECORDING_FLOW_SERVICE: 'RecordingFlowService'
} as const

/**
 * 服務鍵值類型
 */
export type ServiceKey = typeof SERVICE_KEYS[keyof typeof SERVICE_KEYS]

/**
 * 匯出服務類型映射
 * 提供編譯時類型檢查
 */
export interface ServiceTypeMap {
    [SERVICE_KEYS.SESSION_SERVICE]: ISessionService
    [SERVICE_KEYS.RECORDING_SERVICE]: IRecordingService
    [SERVICE_KEYS.TRANSCRIPT_SERVICE]: ITranscriptService
}
