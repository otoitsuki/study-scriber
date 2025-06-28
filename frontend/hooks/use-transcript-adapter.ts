"use client"

import { useTranscript as useTranscriptLegacy } from './use-transcript'
import { useTranscriptNew } from './use-transcript-new'
import { isFeatureEnabled } from '../lib/feature-flags'
import { TranscriptMessage } from '../lib/transcript-manager'

// 統一的 UseTranscript 介面
interface UseTranscriptReturn {
    transcripts: TranscriptMessage[]
    isConnected: boolean
    isCompleted: boolean
    error: string | null
    connect: (sessionId: string) => Promise<void>
    disconnect: () => void
    clearTranscripts: () => void
    // 自動捲動功能
    autoScrollEnabled: boolean
    enableAutoScroll: () => void
    disableAutoScroll: () => void
    scrollToLatest: () => void
    setScrollContainer: (element: HTMLElement | null) => void
}

/**
 * useTranscript 適配器 Hook
 * 根據功能開關決定使用新舊版本的 useTranscript
 * 特別注意保持 TranscriptManager 的 WebSocket 重連機制
 */
export function useTranscript(): UseTranscriptReturn {
    const useNewTranscriptHook = isFeatureEnabled('useNewTranscriptHook')
    const useNewStateManagement = isFeatureEnabled('useNewStateManagement')

    console.log('🔄 [useTranscriptAdapter] 功能開關狀態:', {
        useNewTranscriptHook,
        useNewStateManagement,
        willUseNewVersion: useNewTranscriptHook || useNewStateManagement
    })

    // 如果啟用新 Transcript Hook 或新狀態管理，使用新版本
    if (useNewTranscriptHook || useNewStateManagement) {
        console.log('🔄 [useTranscriptAdapter] 使用新版本 useTranscriptNew')
        return useTranscriptNew()
    }

    // 否則使用舊版本
    console.log('🔄 [useTranscriptAdapter] 使用舊版本 useTranscript')
    return useTranscriptLegacy()
}

// 導出舊版本供直接使用（用於測試或特殊情況）
export { useTranscript as useTranscriptLegacy } from './use-transcript'
export { useTranscriptNew } from './use-transcript-new'
