"use client"

import { useState, useCallback, useMemo } from 'react'
import axios from 'axios'
import { sessionAPI, type SessionCreateRequest, type SessionResponse } from '../lib/api'

interface UseSessionReturn {
    currentSession: SessionResponse | null
    isLoading: boolean
    error: string | null
    createNoteSession: (title?: string, content?: string) => Promise<SessionResponse | null>
    createRecordingSession: (title?: string, content?: string, lang_code?: string, stt_provider?: string) => Promise<SessionResponse | null>
    upgradeToRecording: () => Promise<SessionResponse | null>
    finishSession: () => Promise<void>
    deleteSession: () => Promise<void>
    clearSession: () => void
    checkActiveSession: () => Promise<SessionResponse | null>
}

export function useSession(): UseSessionReturn {
    const [currentSession, setCurrentSession] = useState<SessionResponse | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const clearError = useCallback(() => {
        setError(null)
    }, [])

    const checkActiveSession = useCallback(async (): Promise<SessionResponse | null> => {
        setIsLoading(true)
        clearError()

        try {
            const activeSession = await sessionAPI.getActiveSession()
            if (activeSession) {
                setCurrentSession(activeSession)
                console.log('✅ 已恢復活躍會話狀態:', activeSession)
                return activeSession
            } else {
                console.log('ℹ️ 沒有活躍會話，使用預設狀態')
                return null
            }
        } catch (err) {
            // 如果是網路錯誤，且是初始化階段，則靜默處理
            if (err instanceof Error && err.message.includes('Network Error')) {
                console.warn('⚠️ Backend API 連線暫時失敗，將在後續重試:', err.message)
                return null // 靜默失敗，不設置錯誤狀態
            }

            const errorMessage = err instanceof Error ? err.message : '檢查活躍會話失敗'
            setError(errorMessage)
            console.error('❌ 檢查活躍會話失敗:', err)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [clearError])
    const createNoteSession = useCallback(async (title?: string, content?: string): Promise<SessionResponse | null> => {
        setIsLoading(true)
        clearError()

        try {
            const sessionData: SessionCreateRequest = {
                title,
                type: 'note_only',
                content,
            }

            const session = await sessionAPI.createSession(sessionData)
            setCurrentSession(session)
            console.log('✅ 純筆記會話建立成功:', session)
            return session
        } catch (err) {
            // 特別處理 409 衝突錯誤
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                setError(conflictMessage)
                console.error('❌ 會話衝突錯誤 (409):', err.response?.data?.detail || err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立會話失敗'
            setError(errorMessage)
            console.error('❌ 建立純筆記會話失敗:', err)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [clearError])

    const createRecordingSession = useCallback(async (title?: string, content?: string, lang_code?: string, stt_provider?: string): Promise<SessionResponse | null> => {
        setIsLoading(true)
        clearError()

        try {
            const sessionData: SessionCreateRequest = {
                title,
                type: 'recording',
                content,
                lang_code,
                stt_provider,
            }

            const session = await sessionAPI.createSession(sessionData)
            setCurrentSession(session)
            console.log('✅ 錄音會話建立成功:', session)
            return session
        } catch (err) {
            // 特別處理 409 衝突錯誤
            if (axios.isAxiosError(err) && err.response?.status === 409) {
                const conflictMessage = '檢測到活躍會話衝突，請重新整理頁面後再試'
                setError(conflictMessage)
                console.error('❌ 會話衝突錯誤 (409):', err.response?.data?.detail || err.message)
                return null
            }

            const errorMessage = err instanceof Error ? err.message : '建立錄音會話失敗'
            setError(errorMessage)
            console.error('❌ 建立錄音會話失敗:', err)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [clearError])

    const upgradeToRecording = useCallback(async (): Promise<SessionResponse | null> => {
        if (!currentSession) {
            setError('沒有活躍的會話可以升級')
            return null
        }

        if (currentSession.type === 'recording') {
            console.log('🔄 會話已經是錄音模式')
            return currentSession
        }

        setIsLoading(true)
        clearError()

        try {
            const updatedSession = await sessionAPI.upgradeToRecording(currentSession.id)
            setCurrentSession(updatedSession)
            console.log('✅ 會話升級為錄音模式成功:', updatedSession)
            return updatedSession
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '升級會話失敗'
            setError(errorMessage)
            console.error('❌ 升級會話失敗:', err)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [currentSession, clearError])

    const finishSession = useCallback(async (): Promise<void> => {
        if (!currentSession) {
            console.log('🔄 沒有活躍的會話需要完成')
            return
        }

        setIsLoading(true)
        clearError()

        try {
            await sessionAPI.finishSession(currentSession.id)
            console.log('✅ 會話完成成功:', currentSession.id)
            // 保持 session 資料，只更新狀態
            setCurrentSession((prev: SessionResponse | null) => prev ? { ...prev, status: 'completed' } : null)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '完成會話失敗'
            setError(errorMessage)
            console.error('❌ 完成會話失敗:', err)
        } finally {
            setIsLoading(false)
        }
    }, [currentSession, clearError])

    const deleteSession = useCallback(async (): Promise<void> => {
        if (!currentSession) {
            console.log('🔄 沒有活躍的會話需要刪除')
            return
        }

        setIsLoading(true)
        clearError()

        try {
            await sessionAPI.deleteSession(currentSession.id)
            console.log('✅ 會話刪除成功:', currentSession.id)
            setCurrentSession(null)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '刪除會話失敗'
            setError(errorMessage)
            console.error('❌ 刪除會話失敗:', err)
        } finally {
            setIsLoading(false)
        }
    }, [currentSession, clearError])

    const clearSession = useCallback(() => {
        setCurrentSession(null)
        setError(null)
        console.log('🔄 會話已清除')
    }, [])

    return useMemo(() => ({
        currentSession,
        isLoading,
        error,
        createNoteSession,
        createRecordingSession,
        upgradeToRecording,
        finishSession,
        deleteSession,
        clearSession,
        checkActiveSession,
    }), [
        currentSession,
        isLoading,
        error,
        createNoteSession,
        createRecordingSession,
        upgradeToRecording,
        finishSession,
        deleteSession,
        clearSession,
        checkActiveSession,
    ])
}
