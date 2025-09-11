"use client"

import type { AppData } from '../types/app-state'

/**
 * 初始狀態載入器
 * 負責從 localStorage 或其他持久化存儲載入初始狀態
 */
export class InitialStateLoader {
    private static readonly STORAGE_KEYS = {
        DRAFT_NOTE: 'draft_note',
        LAST_SESSION: 'last_session',
        APP_STATE: 'app_state_v1',
    } as const

    /**
     * 載入初始應用狀態
     * 優先順序：localStorage > 預設狀態
     */
    static loadInitialAppData(): AppData {
        console.log('🔄 [InitialStateLoader] 開始載入初始狀態')

        try {
            // 1. 載入草稿筆記
            const draftContent = this.loadDraftNote()

            // 2. 載入上次會話資訊（如果有的話）
            const lastSession = this.loadLastSession()

            // 3. 載入完整應用狀態（如果有的話）
            const savedAppState = this.loadSavedAppState()

            // 修正：如果儲存的狀態是暫時性或已完成的，則重置為預設狀態
            const transientAppStates = ['recording_waiting', 'recording_active', 'processing', 'finished', 'uploading']
            console.log('🔍 [InitialStateLoader] 檢查儲存的狀態:', {
                savedState: savedAppState?.state,
                shouldReset: savedAppState?.state && transientAppStates.includes(savedAppState.state)
            })

            const validInitialState =
                savedAppState?.state && !transientAppStates.includes(savedAppState.state)
                    ? savedAppState.state
                    : 'default'

            console.log('🔍 [InitialStateLoader] 最終初始狀態:', validInitialState)

            const initialAppData: AppData = {
                state: validInitialState,
                transcriptEntries: savedAppState?.transcriptEntries || [],
                editorContent: draftContent || '',
                isRecording: false, // 重啟後永遠不應該是錄音狀態
                recordingTime: 0,   // 重啟後重置錄音時間
                session: lastSession, // 可能為 null
            }

            console.log('🔄 [InitialStateLoader] 初始狀態載入完成:', {
                hasDraftContent: !!draftContent,
                hasLastSession: !!lastSession,
                hasSavedAppState: !!savedAppState,
                state: initialAppData.state,
                transcriptCount: initialAppData.transcriptEntries.length
            })

            return initialAppData
        } catch (error) {
            console.error('❌ [InitialStateLoader] 載入初始狀態失敗:', error)
            return this.getDefaultAppData()
        }
    }

    /**
     * 載入草稿筆記內容
     */
    private static loadDraftNote(): string {
        try {
            const draft = localStorage.getItem(this.STORAGE_KEYS.DRAFT_NOTE)
            return draft || ''
        } catch (error) {
            console.warn('⚠️ [InitialStateLoader] 載入草稿筆記失敗:', error)
            return ''
        }
    }

    /**
     * 載入上次會話資訊
     */
    private static loadLastSession(): AppData['session'] {
        try {
            const sessionData = localStorage.getItem(this.STORAGE_KEYS.LAST_SESSION)
            if (!sessionData) return null

            const session = JSON.parse(sessionData)

            // 驗證會話資料結構
            if (session && typeof session === 'object' && session.id) {
                // 不恢復已完成、錯誤或暫時性狀態的會話
                const transientStates = ['completed', 'error', 'active', 'processing', 'recording', 'uploading']
                if (transientStates.includes(session.status)) {
                    console.log('🔄 [InitialStateLoader] 上次會話狀態為暫時性/已完成，不恢復:', {
                        status: session.status,
                        id: session.id
                    })
                    // 清除 localStorage 中的過期會話資料
                    localStorage.removeItem(this.STORAGE_KEYS.LAST_SESSION)
                    return null
                }

                console.log('🔄 [InitialStateLoader] 恢復上次會話:', {
                    id: session.id,
                    status: session.status,
                    type: session.type
                })
                return session
            }

            return null
        } catch (error) {
            console.warn('⚠️ [InitialStateLoader] 載入上次會話失敗:', error)
            return null
        }
    }

    /**
     * 載入完整的應用狀態
     */
    private static loadSavedAppState(): Partial<AppData> | null {
        try {
            const stateData = localStorage.getItem(this.STORAGE_KEYS.APP_STATE)
            if (!stateData) return null

            const savedState = JSON.parse(stateData)

            // 驗證狀態資料結構
            if (savedState && typeof savedState === 'object') {
                console.log('🔄 [InitialStateLoader] 載入已儲存的應用狀態')
                return savedState
            }

            return null
        } catch (error) {
            console.warn('⚠️ [InitialStateLoader] 載入應用狀態失敗:', error)
            return null
        }
    }

    /**
     * 獲取預設應用狀態
     */
    private static getDefaultAppData(): AppData {
        console.log('🔄 [InitialStateLoader] 使用預設狀態')
        return {
            state: 'default',
            transcriptEntries: [],
            editorContent: '',
            isRecording: false,
            recordingTime: 0,
            session: null,
        }
    }

    /**
     * 儲存應用狀態到 localStorage
     */
    static saveAppState(appData: AppData): void {
        try {
            // 儲存完整應用狀態（排除敏感資訊）
            const stateToSave = {
                state: appData.state,
                transcriptEntries: appData.transcriptEntries,
                // 不儲存 editorContent（已單獨儲存為 draft_note）
                // 不儲存 isRecording 和 recordingTime（重啟後應重置）
            }

            localStorage.setItem(this.STORAGE_KEYS.APP_STATE, JSON.stringify(stateToSave))

            // 儲存會話資訊
            if (appData.session) {
                localStorage.setItem(this.STORAGE_KEYS.LAST_SESSION, JSON.stringify(appData.session))
            } else {
                localStorage.removeItem(this.STORAGE_KEYS.LAST_SESSION)
            }

            console.log('💾 [InitialStateLoader] 應用狀態已儲存')
        } catch (error) {
            console.error('❌ [InitialStateLoader] 儲存應用狀態失敗:', error)
        }
    }

    /**
     * 清除所有持久化狀態
     */
    static clearPersistedState(): void {
        try {
            localStorage.removeItem(this.STORAGE_KEYS.APP_STATE)
            localStorage.removeItem(this.STORAGE_KEYS.LAST_SESSION)
            // 注意：不清除 DRAFT_NOTE，因為那是用戶的草稿內容

            console.log('🗑️ [InitialStateLoader] 持久化狀態已清除')
        } catch (error) {
            console.error('❌ [InitialStateLoader] 清除持久化狀態失敗:', error)
        }
    }

    /**
     * 檢查是否有持久化狀態
     */
    static hasPersistedState(): boolean {
        try {
            return !!(
                localStorage.getItem(this.STORAGE_KEYS.APP_STATE) ||
                localStorage.getItem(this.STORAGE_KEYS.LAST_SESSION)
            )
        } catch (error) {
            console.warn('⚠️ [InitialStateLoader] 檢查持久化狀態失敗:', error)
            return false
        }
    }
}
