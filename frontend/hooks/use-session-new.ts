"use client"

import { useCallback, useMemo, useEffect } from 'react'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'
import { SERVICE_KEYS, serviceContainer } from '../lib/services'
import type { ISessionService } from '../lib/services'
import type { SessionResponse } from '../lib/api'

interface UseSessionNewReturn {
    currentSession: SessionResponse | null
    isLoading: boolean
    error: string | null
    createNoteSession: (title?: string, content?: string) => Promise<SessionResponse | null>
    createRecordingSession: (title?: string, content?: string) => Promise<SessionResponse | null>
    upgradeToRecording: () => Promise<SessionResponse | null>
    finishSession: () => Promise<void>
    deleteSession: () => Promise<void>
    clearSession: () => void
    checkActiveSession: () => Promise<SessionResponse | null>
}

/**
 * useSessionNew - 會話管理 Hook (適配器層)
 *
 * 重構為適配器層：
 * - 內部調用 SessionService 而非直接調用 sessionAPI
 * - 保持對外接口完全不變，確保組件層無感知變更
 * - 使用服務層實現清晰的架構分層
 */
export function useSessionNew(): UseSessionNewReturn {
    const context = useAppStateContext()

    console.log('🔄 [useSessionNew] Hook 初始化 (適配器層)，功能開關狀態:', {
        useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
        useNewSessionHook: isFeatureEnabled('useNewSessionHook'),
        contextSession: context.appData.session,
        contextError: context.error,
        contextLoading: context.isLoading,
    })

    // 解析服務實例 - 使用服務層
    const sessionService = useMemo(() => {
        try {
            return serviceContainer.resolve<ISessionService>(SERVICE_KEYS.SESSION_SERVICE)
        } catch (error) {
            console.error('❌ [useSessionNew] 無法解析 SessionService:', error)
            throw new Error('會話服務初始化失敗')
        }
    }, [])

    const clearError = useCallback(() => {
        context.setError(null)
    }, [context])

    const checkActiveSession = useCallback(async (): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const activeSession = await sessionService.checkActiveSession()
            if (activeSession) {
                context.setSession({
                    id: activeSession.id,
                    status: activeSession.status,
                    type: activeSession.type,
                })
                console.log('✅ [useSessionNew] 已恢復活躍會話狀態:', activeSession)
                return activeSession
            } else {
                console.log('ℹ️ [useSessionNew] 沒有活躍會話，使用預設狀態')
                context.setSession(null)
                return null
            }
        } catch (err) {
            if (err instanceof Error && err.message.includes('Network Error')) {
                console.warn('⚠️ [useSessionNew] Backend API 連線暫時失敗，將在後續重試:', err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '檢查活躍會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 檢查活躍會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const createNoteSession = useCallback(async (title?: string, content?: string): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const session = await sessionService.createNoteSession(title, content)

            context.setSession({
                id: session.id,
                status: session.status,
                type: session.type,
            })

            console.log('✅ [useSessionNew] 純筆記會話建立成功:', session)
            return session
        } catch (err) {
            // 保持原有的 409 衝突錯誤處理邏輯
            if (err instanceof Error && err.message.includes('409')) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                context.setError(conflictMessage)
                console.error('❌ [useSessionNew] 會話衝突錯誤 (409):', err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 建立純筆記會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const createRecordingSession = useCallback(async (title?: string, content?: string): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const session = await sessionService.createRecordingSession(title, content)

            context.setSession({
                id: session.id,
                status: session.status,
                type: session.type,
            })

            console.log('✅ [useSessionNew] 錄音會話建立成功:', session)
            return session
        } catch (err) {
            // 保持原有的 409 衝突錯誤處理邏輯
            if (err instanceof Error && err.message.includes('409')) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                context.setError(conflictMessage)
                console.error('❌ [useSessionNew] 會話衝突錯誤 (409):', err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立錄音會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 建立錄音會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const upgradeToRecording = useCallback(async (): Promise<SessionResponse | null> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            context.setError('沒有活躍的會話可以升級')
            return null
        }

        if (currentSessionData.type === 'recording') {
            console.log('🔄 [useSessionNew] 會話已經是錄音模式')
            try {
                const activeSession = await sessionService.checkActiveSession()
                return activeSession
            } catch (err) {
                console.error('❌ [useSessionNew] 獲取活躍會話失敗:', err)
                return null
            }
        }

        context.setLoading(true)
        clearError()

        try {
            const updatedSession = await sessionService.upgradeToRecording(currentSessionData.id)

            context.setSession({
                id: updatedSession.id,
                status: updatedSession.status,
                type: updatedSession.type,
            })

            console.log('✅ [useSessionNew] 會話升級為錄音模式成功:', updatedSession)
            return updatedSession
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '升級會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 升級會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const finishSession = useCallback(async (): Promise<void> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            console.log('🔄 [useSessionNew] 沒有活躍的會話需要完成')
            return
        }

        context.setLoading(true)
        clearError()

        try {
            await sessionService.finishSession(currentSessionData.id)
            console.log('✅ [useSessionNew] 會話完成成功:', currentSessionData.id)

            context.updateSessionStatus('completed')
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '完成會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 完成會話失敗:', err)
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const deleteSession = useCallback(async (): Promise<void> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            console.log('🔄 [useSessionNew] 沒有活躍的會話需要刪除')
            return
        }

        context.setLoading(true)
        clearError()

        try {
            await sessionService.deleteSession(currentSessionData.id)
            console.log('✅ [useSessionNew] 會話刪除成功:', currentSessionData.id)
            context.setSession(null)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '刪除會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 刪除會話失敗:', err)
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context, sessionService])

    const clearSession = useCallback(() => {
        context.setSession(null)
        context.setError(null)
        console.log('🔄 [useSessionNew] 會話已清除')
    }, [context])

    // 向後相容的 currentSession 格式
    const currentSession: SessionResponse | null = useMemo(() => {
        const sessionData = context.appData.session
        if (!sessionData) return null

        return {
            id: sessionData.id,
            title: '',
            type: sessionData.type,
            status: sessionData.status,
            language: 'zh-TW',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }
    }, [context.appData.session])

    // 確保服務層已初始化
    useEffect(() => {
        if (!sessionService) {
            console.error('❌ [useSessionNew] SessionService 未正確初始化')
            context.setError('會話服務初始化失敗')
        }
    }, [sessionService, context])

    return useMemo(() => ({
        currentSession,
        isLoading: context.isLoading,
        error: context.error,
        createNoteSession,
        createRecordingSession,
        upgradeToRecording,
        finishSession,
        deleteSession,
        clearSession,
        checkActiveSession,
    }), [
        currentSession,
        context.isLoading,
        context.error,
        createNoteSession,
        createRecordingSession,
        upgradeToRecording,
        finishSession,
        deleteSession,
        clearSession,
        checkActiveSession,
    ])
}
