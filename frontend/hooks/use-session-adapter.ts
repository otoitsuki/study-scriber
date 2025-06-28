"use client"

import { useSession as useSessionLegacy } from './use-session'
import { useSessionNew } from './use-session-new'
import { isFeatureEnabled } from '../lib/feature-flags'
import { SessionResponse } from '../lib/api'

// 統一的 UseSession 介面
interface UseSessionReturn {
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

/**
 * useSession 適配器 Hook
 * 根據功能開關決定使用新舊版本的 useSession
 * 確保 API 完全相容，現有組件無需修改
 */
export function useSession(): UseSessionReturn {
    const useNewSessionHook = isFeatureEnabled('useNewSessionHook')
    const useNewStateManagement = isFeatureEnabled('useNewStateManagement')

    console.log('🔄 [useSessionAdapter] 功能開關狀態:', {
        useNewSessionHook,
        useNewStateManagement,
        willUseNewVersion: useNewSessionHook || useNewStateManagement
    })

    // 如果啟用新 Session Hook 或新狀態管理，使用新版本
    if (useNewSessionHook || useNewStateManagement) {
        console.log('🔄 [useSessionAdapter] 使用新版本 useSessionNew')
        return useSessionNew()
    }

    // 否則使用舊版本
    console.log('🔄 [useSessionAdapter] 使用舊版本 useSession')
    return useSessionLegacy()
}

// 導出舊版本供直接使用（用於測試或特殊情況）
export { useSession as useSessionLegacy } from './use-session'
export { useSessionNew } from './use-session-new'
