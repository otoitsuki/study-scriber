"use client"

import { useCallback, useMemo } from 'react'
import axios from 'axios'
import { sessionAPI, type SessionCreateRequest, type SessionResponse } from '../lib/api'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'

interface UseSessionNewReturn {
    currentSession: SessionResponse | null
    isLoading: boolean
    error: string | null
    createNoteSession: (title: string, content?: string) => Promise<SessionResponse | null>
    createRecordingSession: (title: string, content?: string) => Promise<SessionResponse | null>
    upgradeToRecording: () => Promise<SessionResponse | null>
    finishSession: () => Promise<void>
    deleteSession: () => Promise<void>
    clearSession: () => void
    checkActiveSession: () => Promise<SessionResponse | null>
}

export function useSessionNew(): UseSessionNewReturn {
    const context = useAppStateContext()

    console.log('🔄 [useSessionNew] Hook 初始化，功能開關狀態:', {
        useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
        useNewSessionHook: isFeatureEnabled('useNewSessionHook'),
        contextSession: context.appData.session,
        contextError: context.error,
        contextLoading: context.isLoading,
    })

    const clearError = useCallback(() => {
        context.setError(null)
    }, [context])

    const checkActiveSession = useCallback(async (): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const activeSession = await sessionAPI.getActiveSession()
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
    }, [clearError, context])

    const createNoteSession = useCallback(async (title: string, content?: string): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const sessionData: SessionCreateRequest = {
                title,
                type: 'note_only',
                content,
            }

            const session = await sessionAPI.createSession(sessionData)

            context.setSession({
                id: session.id,
                status: session.status,
                type: session.type,
            })

            console.log('✅ [useSessionNew] 純筆記會話建立成功:', session)
            return session
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                context.setError(conflictMessage)
                console.error('❌ [useSessionNew] 會話衝突錯誤 (409):', err.response?.data?.detail || err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 建立純筆記會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context])

    const createRecordingSession = useCallback(async (title: string, content?: string): Promise<SessionResponse | null> => {
        context.setLoading(true)
        clearError()

        try {
            const sessionData: SessionCreateRequest = {
                title,
                type: 'recording',
                content,
            }

            const session = await sessionAPI.createSession(sessionData)

            context.setSession({
                id: session.id,
                status: session.status,
                type: session.type,
            })

            console.log('✅ [useSessionNew] 錄音會話建立成功:', session)
            return session
        } catch (err) {
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                context.setError(conflictMessage)
                console.error('❌ [useSessionNew] 會話衝突錯誤 (409):', err.response?.data?.detail || err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立錄音會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 建立錄音會話失敗:', err)
            return null
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context])

    const upgradeToRecording = useCallback(async (): Promise<SessionResponse | null> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            context.setError('沒有活躍的會話可以升級')
            return null
        }

        if (currentSessionData.type === 'recording') {
            console.log('🔄 [useSessionNew] 會話已經是錄音模式')
            try {
                const activeSession = await sessionAPI.getActiveSession()
                return activeSession
            } catch (err) {
                console.error('❌ [useSessionNew] 獲取活躍會話失敗:', err)
                return null
            }
        }

        context.setLoading(true)
        clearError()

        try {
            const updatedSession = await sessionAPI.upgradeToRecording(currentSessionData.id)

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
    }, [clearError, context])

    const finishSession = useCallback(async (): Promise<void> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            console.log('🔄 [useSessionNew] 沒有活躍的會話需要完成')
            return
        }

        context.setLoading(true)
        clearError()

        try {
            await sessionAPI.finishSession(currentSessionData.id)
            console.log('✅ [useSessionNew] 會話完成成功:', currentSessionData.id)

            context.updateSessionStatus('completed')
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '完成會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 完成會話失敗:', err)
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context])

    const deleteSession = useCallback(async (): Promise<void> => {
        const currentSessionData = context.appData.session

        if (!currentSessionData) {
            console.log('🔄 [useSessionNew] 沒有活躍的會話需要刪除')
            return
        }

        context.setLoading(true)
        clearError()

        try {
            await sessionAPI.deleteSession(currentSessionData.id)
            console.log('✅ [useSessionNew] 會話刪除成功:', currentSessionData.id)
            context.setSession(null)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '刪除會話失敗'
            context.setError(errorMessage)
            console.error('❌ [useSessionNew] 刪除會話失敗:', err)
        } finally {
            context.setLoading(false)
        }
    }, [clearError, context])

    const clearSession = useCallback(() => {
        context.setSession(null)
        context.setError(null)
        console.log('🔄 [useSessionNew] 會話已清除')
    }, [context])

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
