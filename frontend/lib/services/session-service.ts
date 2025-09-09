"use client"

import { BaseService } from './base-service'
import { ISessionService } from './interfaces'
import { sessionAPI, llmConfigUtils, type SessionCreateRequest, type SessionResponse } from '../api'
import axios from 'axios'

/**
 * SessionService - 會話管理服務
 *
 * 重構現有的 sessionAPI 邏輯到服務層，提供：
 * - 會話創建（純筆記、錄音模式）
 * - 會話升級（純筆記 → 錄音模式）
 * - 會話狀態管理
 * - 統一錯誤處理和重試機制
 */
import { STTProvider } from '../api'

export class SessionService extends BaseService implements ISessionService {
    protected readonly serviceName = 'SessionService'

    /**
     * 服務初始化
     * 重用現有的 sessionAPI 配置和攔截器
     */
    async initialize(): Promise<void> {
        this.logInfo('服務初始化開始')

        // 檢查 sessionAPI 可用性
        try {
            // 簡單的健康檢查 - 嘗試獲取活躍會話
            await this.checkActiveSession()
            this.logSuccess('API 連接檢查', '後端 API 連接正常')
        } catch (error) {
            // 網路錯誤不影響初始化，記錄警告即可
            if (axios.isAxiosError(error) && error.code === 'ERR_NETWORK') {
                this.logWarning('API 連接檢查失敗，但不影響服務初始化', error.message)
            } else {
                this.logWarning('初始化健康檢查失敗', error)
            }
        }

        this.logSuccess('初始化完成')
    }

    /**
     * 服務清理
     */
    async cleanup(): Promise<void> {
        this.logInfo('服務清理開始')
        // SessionService 主要是無狀態的，無需特殊清理
        this.logSuccess('清理完成')
    }

    /**
     * 確保錄音會話存在 - 優雅處理會話衝突
     *
     * 策略：
     * 1. 優先嘗試創建新的錄音會話
     * 2. 若遇到 409 衝突，改為獲取現有活躍會話
     * 3. 確保返回可用的錄音會話
     */
    async ensureRecordingSession(title?: string, content?: string, startTs?: number, sttProvider?: STTProvider): Promise<SessionResponse> {
        this.logInfo('確保錄音會話存在 - 強制新建策略', { title, hasContent: !!content, hasStartTs: !!startTs, sttProvider })

        try {
            // 1. 檢查並完成任何現有活躍會話
            const existingSession = await this.checkActiveSession()
            if (existingSession) {
                this.logInfo('檢測到現有活躍會話，準備完成', {
                    sessionId: existingSession.id,
                    type: existingSession.type,
                    status: existingSession.status
                })

                await this.finishSession(existingSession.id)
                this.logSuccess('現有會話已完成', { sessionId: existingSession.id })
            } else {
                this.logInfo('沒有現有活躍會話')
            }

            // 2. 強制創建新會話
            const newSession = await this.createRecordingSession(
                title,
                content,
                startTs,
                sttProvider
            )

            this.logSuccess('強制新建策略完成', {
                newSessionId: newSession.id,
                type: newSession.type,
                status: newSession.status,
                sttProvider
            })

            return newSession

        } catch (error) {
            if (error instanceof Error && error.message.includes('409')) {
                // 遇到衝突，獲取現有活躍會話
                this.logWarning('會話衝突，嘗試獲取現有活躍會話')
                const activeSession = await this.checkActiveSession()
                if (activeSession) {
                    return activeSession
                }
            }
            this.handleError('確保錄音會話存在 - 強制新建策略', error as Error)
        }
    }

    /**
     * 創建錄音會話
     * 重用 sessionAPI.createSession 的重試機制和錯誤處理
     */
    async createRecordingSession(title?: string, content?: string, startTs?: number, sttProvider?: STTProvider): Promise<SessionResponse> {
        this.logInfo('創建錄音會話', { title, hasContent: !!content, hasStartTs: !!startTs, sttProvider })

        try {
            const sessionData: Omit<SessionCreateRequest, 'llm_config'> = {
                title,
                type: 'recording',
                content,
                start_ts: startTs,
                stt_provider: sttProvider,
                // 後端期望 language 欄位，符合 SessionCreateRequest schema
                language: 'zh-TW',
            }

            const session = await llmConfigUtils.createSessionWithLLMConfig(sessionData)

            this.logSuccess('錄音會話創建成功', {
                sessionId: session.id,
                type: session.type,
                status: session.status,
                withStartTs: !!startTs,
                sttProvider
            })

            return session
        } catch (error) {
            // 不在這裡處理 409 錯誤，交由 ensureRecordingSession 處理
            this.handleError('創建錄音會話', error)
        }
    }

    /**
     * 創建純筆記會話
     * 重用 sessionAPI.createSession 的重試機制和錯誤處理
     */
    async createNoteSession(title?: string, content?: string): Promise<SessionResponse> {
        this.logInfo('創建純筆記會話', { title, hasContent: !!content })

        try {
            const sessionData: Omit<SessionCreateRequest, 'llm_config'> = {
                title,
                type: 'note_only',
                content,
                // 後端期望 language 欄位，符合 SessionCreateRequest schema
                language: 'zh-TW',
            }

            const session = await llmConfigUtils.createSessionWithLLMConfig(sessionData)

            this.logSuccess('純筆記會話創建成功', {
                sessionId: session.id,
                type: session.type,
                status: session.status
            })

            return session
        } catch (error) {
            // 處理會話衝突錯誤（409）
            if (axios.isAxiosError(error) && error.response?.status === 409) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                this.logWarning('會話衝突錯誤 (409)', {
                    detail: error.response?.data?.detail,
                    message: error.message
                })
                this.handleError('創建純筆記會話', new Error(conflictMessage))
            }

            this.handleError('創建純筆記會話', error)
        }
    }

    /**
     * 升級會話至錄音模式
     * 重用 sessionAPI.upgradeToRecording 的重試機制和錯誤處理
     */
    async upgradeToRecording(sessionId: string): Promise<SessionResponse> {
        this.logInfo('升級會話至錄音模式', { sessionId })

        try {
            // 先檢查會話是否存在和狀態
            const currentSession = await this.checkActiveSession()

            if (!currentSession) {
                this.handleError('升級會話至錄音模式', new Error('沒有活躍的會話可以升級'))
            }

            if (currentSession!.id !== sessionId) {
                this.handleError('升級會話至錄音模式',
                    new Error(`會話 ID 不匹配：要求升級 ${sessionId}，但活躍會話為 ${currentSession!.id}`))
            }

            if (currentSession!.type === 'recording') {
                this.logInfo('會話已經是錄音模式，返回現有會話', { sessionId })
                return currentSession!
            }

            const updatedSession = await sessionAPI.upgradeToRecording(sessionId)

            this.logSuccess('會話升級成功', {
                sessionId: updatedSession.id,
                oldType: currentSession!.type,
                newType: updatedSession.type,
                status: updatedSession.status
            })

            return updatedSession
        } catch (error) {
            this.handleError('升級會話至錄音模式', error)
        }
    }

    /**
     * 完成會話
     * 重用 sessionAPI.finishSession 的重試機制和錯誤處理
     */
    async finishSession(sessionId: string): Promise<void> {
        this.logInfo('完成會話', { sessionId })

        try {
            await sessionAPI.finishSession(sessionId)

            this.logSuccess('會話完成成功', { sessionId })
        } catch (error) {
            this.handleError('完成會話', error)
        }
    }

    /**
     * 檢查活躍會話
     * 重用 sessionAPI.getActiveSession 的重試機制和錯誤處理
     */
    async checkActiveSession(): Promise<SessionResponse | null> {
        this.logInfo('檢查活躍會話')

        try {
            const activeSession = await sessionAPI.getActiveSession()

            if (activeSession) {
                this.logSuccess('活躍會話檢查', {
                    sessionId: activeSession.id,
                    type: activeSession.type,
                    status: activeSession.status
                })
                return activeSession
            } else {
                this.logInfo('沒有活躍會話')
                return null
            }
        } catch (error) {
            // 網路錯誤不應該拋出，只記錄警告
            if (axios.isAxiosError(error) && error.code === 'ERR_NETWORK') {
                this.logWarning('Backend API 連線暫時失敗，將在後續重試', error.message)
                return null
            }

            this.handleError('檢查活躍會話', error)
        }
    }

    /**
     * 等待會話在資料庫中完全可見
     * 用於解決會話創建後立即查詢可能失敗的時序問題
     */
    async waitForSessionReady(sessionId: string, maxWaitTime: number = 5000): Promise<boolean> {
        this.logInfo('等待會話準備就緒', { sessionId, maxWaitTime })

        const startTime = Date.now()
        const checkInterval = 200 // 每 200ms 檢查一次

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const activeSession = await this.checkActiveSession()

                if (activeSession && activeSession.id === sessionId) {
                    // 進一步驗證會話狀態
                    if (activeSession.status === 'active' && activeSession.type === 'recording') {
                        this.logSuccess('會話已準備就緒', {
                            sessionId,
                            status: activeSession.status,
                            type: activeSession.type,
                            waitTime: Date.now() - startTime
                        })
                        return true
                    }
                }
            } catch (error) {
                // 檢查失敗時繼續等待，不拋出錯誤
                this.logWarning('會話狀態檢查失敗，繼續等待', {
                    sessionId,
                    error: error instanceof Error ? error.message : String(error)
                })
            }

            // 等待下次檢查
            await new Promise(resolve => setTimeout(resolve, checkInterval))
        }

        this.logWarning('等待會話準備就緒超時', {
            sessionId,
            maxWaitTime,
            actualWaitTime: Date.now() - startTime
        })

        return false
    }

    /**
     * 刪除會話
     * 重用 sessionAPI.deleteSession 的重試機制和錯誤處理
     */
    async deleteSession(sessionId: string): Promise<void> {
        this.logInfo('刪除會話', { sessionId })

        try {
            const result = await sessionAPI.deleteSession(sessionId)

            this.logSuccess('會話刪除成功', {
                sessionId,
                result
            })
        } catch (error) {
            this.handleError('刪除會話', error)
        }
    }

    /**
     * 獲取服務狀態摘要
     * 擴展基礎狀態信息，包含 API 連接狀態
     */
    async getServiceStatus(): Promise<SessionServiceStatus> {
        const baseStatus = this.getStatus()

        // 檢查 API 連接狀態
        let apiConnected = false
        let lastApiCheck: string | null = null

        try {
            await this.checkActiveSession()
            apiConnected = true
            lastApiCheck = new Date().toISOString()
        } catch {
            apiConnected = false
            lastApiCheck = new Date().toISOString()
        }

        return {
            ...baseStatus,
            apiConnected,
            lastApiCheck
        }
    }
}

/**
 * SessionService 狀態介面
 * 擴展基礎服務狀態，包含 API 特定信息
 */
export interface SessionServiceStatus {
    serviceName: string
    isInitialized: boolean
    isRunning: boolean
    timestamp: string
    apiConnected: boolean
    lastApiCheck: string | null
}
