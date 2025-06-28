"use client"

import { useRecording as useRecordingLegacy } from './use-recording'
import { useRecordingNew } from './use-recording-new'
import { isFeatureEnabled } from '../lib/feature-flags'
import { TranscriptMessage } from '../lib/transcript-manager'

// 統一的 UseRecording 介面
interface UseRecordingReturn {
    isRecording: boolean
    recordingTime: number
    transcripts: TranscriptMessage[]
    transcriptCompleted: boolean
    error: string | null
    startRecording: (sessionId: string) => Promise<void>
    stopRecording: () => void
    clearTranscripts: () => void
}

/**
 * useRecording 適配器 Hook
 * 根據功能開關決定使用新舊版本的 useRecording
 * 確保 API 完全相容，現有組件無需修改
 */
export function useRecording(): UseRecordingReturn {
    const useNewRecordingHook = isFeatureEnabled('useNewRecordingHook')
    const useNewStateManagement = isFeatureEnabled('useNewStateManagement')

    console.log('🔄 [useRecordingAdapter] 功能開關狀態:', {
        useNewRecordingHook,
        useNewStateManagement,
        willUseNewVersion: useNewRecordingHook || useNewStateManagement
    })

    // 如果啟用新 Recording Hook 或新狀態管理，使用新版本
    if (useNewRecordingHook || useNewStateManagement) {
        console.log('🔄 [useRecordingAdapter] 使用新版本 useRecordingNew')
        return useRecordingNew()
    }

    // 否則使用舊版本
    console.log('🔄 [useRecordingAdapter] 使用舊版本 useRecording')
    return useRecordingLegacy()
}

// 導出舊版本供直接使用（用於測試或特殊情況）
export { useRecording as useRecordingLegacy } from './use-recording'
export { useRecordingNew } from './use-recording-new'
