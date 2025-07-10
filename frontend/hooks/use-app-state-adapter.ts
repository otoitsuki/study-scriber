"use client"

import { useAppState as useAppStateLegacy } from './use-app-state'
import { useAppStateNew } from './use-app-state-new'
import { isFeatureEnabled } from '../lib/feature-flags'
import type { AppData } from '../types/app-state'

// 統一的 UseAppState 介面
interface UseAppStateReturn {
    // 應用狀態
    appData: AppData
    isLoading: boolean
    error: string | null

    // 會話管理
    createNoteSession: (title?: string) => Promise<void>
    createRecordingSession: (title?: string) => Promise<void>
    upgradeToRecording: () => Promise<void>
    finishSession: () => Promise<void>
    newNote: () => Promise<void>

    // 錄音控制
    startRecording: (title?: string) => Promise<void>
    stopRecording: () => Promise<void>

    // 本地草稿
    saveLocalDraft: (content: string) => void

    // 外部狀態
    session: any
    sessionLoading: boolean
    sessionError: string | null

    // 錄音狀態
    recordingError: string | null

    // 逐字稿狀態
    transcriptConnected: boolean
    transcriptError: string | null
    transcriptAutoScroll: boolean
    enableAutoScroll: () => void
    disableAutoScroll: () => void
    scrollToLatest: () => void
}

/**
 * useAppState 適配器 Hook
 * 根據功能開關決定使用新舊版本的 useAppState
 * 確保 API 完全相容，現有組件無需修改
 */
export function useAppState(): UseAppStateReturn {
    const useNewAppStateHook = isFeatureEnabled('useNewAppStateHook')
    const useNewStateManagement = isFeatureEnabled('useNewStateManagement')

    console.log('🔄 [useAppStateAdapter] 功能開關狀態:', {
        useNewAppStateHook,
        useNewStateManagement,
        willUseNewVersion: useNewAppStateHook || useNewStateManagement
    })

    // 如果啟用新 AppState Hook 或新狀態管理，使用新版本
    if (useNewAppStateHook || useNewStateManagement) {
        console.log('🔄 [useAppStateAdapter] 使用新版本 useAppStateNew')
        return useAppStateNew()
    }

    // 否則使用舊版本
    console.log('🔄 [useAppStateAdapter] 使用舊版本 useAppState')
    return useAppStateLegacy()
}

// 導出舊版本供直接使用（用於測試或特殊情況）
export { useAppState as useAppStateLegacy } from './use-app-state'
export { useAppStateNew } from './use-app-state-new'
