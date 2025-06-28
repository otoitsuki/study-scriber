"use client"

// 功能開關配置
export interface FeatureFlags {
    useNewStateManagement: boolean
    useNewRecordingHook: boolean
    useNewSessionHook: boolean
    useNewTranscriptHook: boolean
    useNewAppStateHook: boolean
    enableStateSync: boolean
    enableDebugLogging: boolean
}

// 預設功能開關設定（保守模式）
const defaultFeatureFlags: FeatureFlags = {
    useNewStateManagement: false,  // 預設關閉新狀態管理
    useNewRecordingHook: false,    // 預設關閉新 recording hook
    useNewSessionHook: false,      // 預設關閉新 session hook
    useNewTranscriptHook: false,   // 預設關閉新 transcript hook
    useNewAppStateHook: false,     // 預設關閉新 app state hook
    enableStateSync: true,         // 預設開啟狀態同步
    enableDebugLogging: true,      // 預設開啟調試日誌
}

// 從 localStorage 讀取功能開關設定
function loadFeatureFlags(): FeatureFlags {
    if (typeof window === 'undefined') {
        return defaultFeatureFlags
    }

    try {
        const stored = localStorage.getItem('study-scriber-feature-flags')
        if (stored) {
            const parsed = JSON.parse(stored)
            return { ...defaultFeatureFlags, ...parsed }
        }
    } catch (error) {
        console.warn('🚩 [FeatureFlags] 讀取功能開關失敗:', error)
    }

    return defaultFeatureFlags
}

// 儲存功能開關設定到 localStorage
function saveFeatureFlags(flags: Partial<FeatureFlags>): void {
    if (typeof window === 'undefined') return

    try {
        const current = loadFeatureFlags()
        const updated = { ...current, ...flags }
        localStorage.setItem('study-scriber-feature-flags', JSON.stringify(updated))
        console.log('🚩 [FeatureFlags] 功能開關已更新:', updated)
    } catch (error) {
        console.error('🚩 [FeatureFlags] 儲存功能開關失敗:', error)
    }
}

// 功能開關管理器
class FeatureFlagManager {
    private flags: FeatureFlags

    constructor() {
        this.flags = loadFeatureFlags()
        this.exposeToWindow()
    }

    // 檢查功能是否啟用
    isEnabled(flag: keyof FeatureFlags): boolean {
        return this.flags[flag]
    }

    // 啟用功能
    enable(flag: keyof FeatureFlags): void {
        this.updateFlag(flag, true)
    }

    // 停用功能
    disable(flag: keyof FeatureFlags): void {
        this.updateFlag(flag, false)
    }

    // 切換功能狀態
    toggle(flag: keyof FeatureFlags): void {
        this.updateFlag(flag, !this.flags[flag])
    }

    // 更新單一功能開關
    private updateFlag(flag: keyof FeatureFlags, value: boolean): void {
        this.flags = { ...this.flags, [flag]: value }
        saveFeatureFlags({ [flag]: value })

        console.log(`🚩 [FeatureFlags] ${flag}: ${value ? '啟用' : '停用'}`)

        // 如果是關鍵功能，給予警告
        if (flag === 'useNewStateManagement' && value) {
            console.warn('⚠️ [FeatureFlags] 新狀態管理系統已啟用，請確保已完成測試')
        }
    }

    // 批次更新功能開關
    updateFlags(updates: Partial<FeatureFlags>): void {
        this.flags = { ...this.flags, ...updates }
        saveFeatureFlags(updates)
        console.log('🚩 [FeatureFlags] 批次更新完成:', updates)
    }

    // 重置所有功能開關
    reset(): void {
        this.flags = defaultFeatureFlags
        if (typeof window !== 'undefined') {
            localStorage.removeItem('study-scriber-feature-flags')
        }
        console.log('🚩 [FeatureFlags] 已重置為預設值')
    }

    // 取得當前所有功能開關狀態
    getAll(): FeatureFlags {
        return { ...this.flags }
    }

    // 暴露到 window 供調試使用
    private exposeToWindow(): void {
        if (typeof window !== 'undefined') {
            (window as any).featureFlags = {
                enable: (flag: keyof FeatureFlags) => this.enable(flag),
                disable: (flag: keyof FeatureFlags) => this.disable(flag),
                toggle: (flag: keyof FeatureFlags) => this.toggle(flag),
                isEnabled: (flag: keyof FeatureFlags) => this.isEnabled(flag),
                getAll: () => this.getAll(),
                reset: () => this.reset(),

                // 便利方法
                enableNewState: () => this.enable('useNewStateManagement'),
                disableNewState: () => this.disable('useNewStateManagement'),
                enableAll: () => this.updateFlags({
                    useNewStateManagement: true,
                    useNewRecordingHook: true,
                    useNewSessionHook: true,
                    useNewTranscriptHook: true,
                    useNewAppStateHook: true,
                }),
                disableAll: () => this.updateFlags({
                    useNewStateManagement: false,
                    useNewRecordingHook: false,
                    useNewSessionHook: false,
                    useNewTranscriptHook: false,
                    useNewAppStateHook: false,
                }),
            }

            console.log('🚩 [FeatureFlags] 調試介面已暴露到 window.featureFlags')
            console.log('   使用方法: window.featureFlags.enableNewState()')
            console.log('   查看狀態: window.featureFlags.getAll()')
        }
    }
}

// 單例模式
export const featureFlagManager = new FeatureFlagManager()

// 便利函數
export const isFeatureEnabled = (flag: keyof FeatureFlags): boolean =>
    featureFlagManager.isEnabled(flag)

export const enableFeature = (flag: keyof FeatureFlags): void =>
    featureFlagManager.enable(flag)

export const disableFeature = (flag: keyof FeatureFlags): void =>
    featureFlagManager.disable(flag)
