"use client"

import { useEffect, useRef, useCallback } from "react"
import { AppData, AppState, SessionStatus, SessionType, TranscriptEntry } from "../types/app-state"
import { AppStateContextValue } from "../types/app-state-context"
import { isFeatureEnabled } from "./feature-flags"

// Legacy Hook 介面定義
export interface LegacyAppStateHook {
    appData: AppData
    isLoading: boolean
    error: string | null
    startRecording: (title?: string) => Promise<void>
    stopRecording: () => Promise<void>
    newNote: () => Promise<void>
    saveLocalDraft: (content: string) => void
    session: { id: string; status: SessionStatus; type: SessionType } | null
    recordingError: string | null
    transcriptError: string | null
    createNoteSession: (title?: string) => Promise<void>
    sessionLoading: boolean
}

// 狀態同步橋接器
export class StateSyncBridge {
    private newContext: AppStateContextValue | null = null
    private legacyHook: LegacyAppStateHook | null = null
    private syncEnabled: boolean = true
    private lastSyncTimestamp: number = 0
    private syncInProgress: boolean = false

    constructor() {
        this.exposeToWindow()
    }

    // 註冊新 Context
    registerNewContext(context: AppStateContextValue): void {
        this.newContext = context
        console.log('🔄 [StateSyncBridge] 新 Context 已註冊')
        this.performSync('new-context-registered')
    }

    // 註冊舊 Hook
    registerLegacyHook(hook: LegacyAppStateHook): void {
        this.legacyHook = hook
        console.log('🔄 [StateSyncBridge] 舊 Hook 已註冊')
        this.performSync('legacy-hook-registered')
    }

    // 執行狀態同步
    private performSync(trigger: string): void {
        if (!this.syncEnabled || this.syncInProgress) return
        if (!this.newContext || !this.legacyHook) return

        this.syncInProgress = true
        const syncTimestamp = Date.now()

        try {
            // 避免過於頻繁的同步
            if (syncTimestamp - this.lastSyncTimestamp < 100) {
                this.syncInProgress = false
                return
            }

            console.log(`🔄 [StateSyncBridge] 執行狀態同步 (觸發: ${trigger})`)

            // 決定同步方向：根據功能開關決定誰是主要數據源
            const useNewAsSource = isFeatureEnabled('useNewStateManagement')

            if (useNewAsSource) {
                this.syncFromNewToLegacy()
            } else {
                this.syncFromLegacyToNew()
            }

            this.lastSyncTimestamp = syncTimestamp
        } catch (error) {
            console.error('🔄 [StateSyncBridge] 同步失敗:', error)
        } finally {
            this.syncInProgress = false
        }
    }

    // 從新系統同步到舊系統
    private syncFromNewToLegacy(): void {
        if (!this.newContext || !this.legacyHook) return

        const newData = this.newContext.appData
        const legacyData = this.legacyHook.appData

        // 檢查是否需要同步
        const needsSync = this.detectDifferences(newData, legacyData)

        if (needsSync.length > 0) {
            console.log('🔄 [StateSyncBridge] 從新系統同步到舊系統:', needsSync)
            // 注意：這裡不能直接修改 legacyData，需要透過 legacy hook 的方法
            // 實際實作時需要根據 legacy hook 的 API 來同步
        }
    }

    // 從舊系統同步到新系統
    private syncFromLegacyToNew(): void {
        if (!this.newContext || !this.legacyHook) return

        const legacyData = this.legacyHook.appData
        const newData = this.newContext.appData

        // 檢查是否需要同步
        const needsSync = this.detectDifferences(legacyData, newData)

        if (needsSync.length > 0) {
            console.log('🔄 [StateSyncBridge] 從舊系統同步到新系統:', needsSync)

            // 同步各個欄位
            if (needsSync.includes('state')) {
                this.newContext.setState(legacyData.state)
            }
            if (needsSync.includes('isRecording')) {
                this.newContext.setRecording(legacyData.isRecording)
            }
            if (needsSync.includes('recordingTime')) {
                this.newContext.setRecordingTime(legacyData.recordingTime)
            }
            if (needsSync.includes('editorContent')) {
                this.newContext.setEditorContent(legacyData.editorContent)
            }
            if (needsSync.includes('transcriptEntries')) {
                this.newContext.setTranscriptEntries(legacyData.transcriptEntries)
            }
            if (needsSync.includes('session')) {
                this.newContext.setSession(legacyData.session || null)
            }
        }
    }

    // 檢測兩個狀態之間的差異
    private detectDifferences(source: AppData, target: AppData): string[] {
        const differences: string[] = []

        if (source.state !== target.state) {
            differences.push('state')
        }
        if (source.isRecording !== target.isRecording) {
            differences.push('isRecording')
        }
        if (source.recordingTime !== target.recordingTime) {
            differences.push('recordingTime')
        }
        if (source.editorContent !== target.editorContent) {
            differences.push('editorContent')
        }
        if (source.transcriptEntries.length !== target.transcriptEntries.length) {
            differences.push('transcriptEntries')
        }
        if (JSON.stringify(source.session) !== JSON.stringify(target.session)) {
            differences.push('session')
        }

        return differences
    }

    // 啟用/停用同步
    enableSync(): void {
        this.syncEnabled = true
        console.log('🔄 [StateSyncBridge] 狀態同步已啟用')
    }

    disableSync(): void {
        this.syncEnabled = false
        console.log('🔄 [StateSyncBridge] 狀態同步已停用')
    }

    // 手動觸發同步
    manualSync(): void {
        this.performSync('manual-trigger')
    }

    // 取得同步狀態
    getSyncStatus(): { enabled: boolean; lastSync: number; inProgress: boolean } {
        return {
            enabled: this.syncEnabled,
            lastSync: this.lastSyncTimestamp,
            inProgress: this.syncInProgress,
        }
    }

    // 暴露到 window 供調試使用
    private exposeToWindow(): void {
        if (typeof window !== 'undefined') {
            (window as any).stateSyncBridge = {
                enableSync: () => this.enableSync(),
                disableSync: () => this.disableSync(),
                manualSync: () => this.manualSync(),
                getStatus: () => this.getSyncStatus(),
            }

            console.log('🔄 [StateSyncBridge] 調試介面已暴露到 window.stateSyncBridge')
        }
    }
}

// 單例模式
export const stateSyncBridge = new StateSyncBridge()

// Legacy Hook 適配器
export function useLegacyHookAdapter(legacyHook: LegacyAppStateHook): LegacyAppStateHook {
    const hasRegistered = useRef(false)

    useEffect(() => {
        if (!hasRegistered.current && isFeatureEnabled('enableStateSync')) {
            stateSyncBridge.registerLegacyHook(legacyHook)
            hasRegistered.current = true
        }
    }, [legacyHook])

    // 如果啟用新狀態管理，返回適配後的版本
    if (isFeatureEnabled('useNewStateManagement')) {
        // TODO: 返回適配後的版本，這裡暫時返回原版本
        return legacyHook
    }

    return legacyHook
}

// New Context 適配器
export function useNewContextAdapter(newContext: AppStateContextValue): AppStateContextValue {
    const hasRegistered = useRef(false)

    useEffect(() => {
        if (!hasRegistered.current && isFeatureEnabled('enableStateSync')) {
            stateSyncBridge.registerNewContext(newContext)
            hasRegistered.current = true
        }
    }, [newContext])

    return newContext
}

// 混合模式 Hook - 根據功能開關決定使用哪個系統
export function useHybridState(
    legacyHook: LegacyAppStateHook,
    newContext: AppStateContextValue
): LegacyAppStateHook {
    const useNew = isFeatureEnabled('useNewStateManagement')

    // 註冊到同步橋接器
    useEffect(() => {
        if (isFeatureEnabled('enableStateSync')) {
            stateSyncBridge.registerLegacyHook(legacyHook)
            stateSyncBridge.registerNewContext(newContext)
        }
    }, [legacyHook, newContext])

    if (useNew) {
        // 將新 Context 適配為 Legacy Hook 介面
        return {
            appData: newContext.appData,
            isLoading: newContext.isLoading,
            error: newContext.error,
            // TODO: 實作其他方法的適配
            startRecording: legacyHook.startRecording,
            stopRecording: legacyHook.stopRecording,
            newNote: legacyHook.newNote,
            saveLocalDraft: legacyHook.saveLocalDraft,
            session: newContext.appData.session || null,
            recordingError: legacyHook.recordingError,
            transcriptError: legacyHook.transcriptError,
            createNoteSession: legacyHook.createNoteSession,
            sessionLoading: legacyHook.sessionLoading,
        }
    }

    return legacyHook
}
