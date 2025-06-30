"use client"

import { isFeatureEnabled } from './feature-flags'

/**
 * TranscriptManager 適配器
 *
 * 根據功能旗標 `useRefactoredTranscriptManager` 選擇使用：
 * - 新的重構實現（transcript-manager-new.ts）
 * - 舊的實現（transcript-manager.ts）
 *
 * 這允許我們進行安全的漸進式切換和測試
 */

// 定義通用介面，確保新舊實現兼容
export interface ITranscriptManager {
  connect(sessionId: string): Promise<void>
  disconnect(sessionId: string): Promise<void>
  disconnectAll(): Promise<void>
  isConnected(sessionId: string): boolean
  getConnectionCount(): number
}

let managerInstance: ITranscriptManager | null = null

/**
 * 取得 TranscriptManager 實例
 * 根據功能旗標自動選擇實現
 */
export async function getTranscriptManager(): Promise<ITranscriptManager> {
  const useRefactored = isFeatureEnabled('useRefactoredTranscriptManager')

  console.log(`🎯 [TranscriptManagerAdapter] 使用 ${useRefactored ? '新' : '舊'} 實現`)

  if (useRefactored) {
    // 動態導入新實現
    if (!managerInstance || !(managerInstance as any).isRefactored) {
      const { TranscriptManager } = await import('./transcript-manager-new')
      managerInstance = TranscriptManager.getInstance()
        ; (managerInstance as any).isRefactored = true
      console.log('✅ [TranscriptManagerAdapter] 已載入重構後的 TranscriptManager')
    }
  } else {
    // 動態導入舊實現
    if (!managerInstance || (managerInstance as any).isRefactored) {
      const { transcriptManager } = await import('./transcript-manager')
      managerInstance = transcriptManager
        ; (managerInstance as any).isRefactored = false
      console.log('✅ [TranscriptManagerAdapter] 已載入原始 TranscriptManager')
    }
  }

  return managerInstance
}

/**
 * 強制重新載入 TranscriptManager（用於功能旗標變更後）
 */
export async function reloadTranscriptManager(): Promise<ITranscriptManager> {
  // 清理現有實例
  if (managerInstance) {
    try {
      await managerInstance.disconnectAll()
    } catch (error) {
      console.warn('⚠️ [TranscriptManagerAdapter] 清理舊實例時發生錯誤:', error)
    }
  }

  managerInstance = null
  return getTranscriptManager()
}

/**
 * 便利函數：取得當前使用的實現類型
 */
export function getCurrentImplementation(): 'refactored' | 'legacy' {
  return isFeatureEnabled('useRefactoredTranscriptManager') ? 'refactored' : 'legacy'
}

/**
 * 便利函數：切換實現並重新載入
 */
export async function switchImplementation(useRefactored: boolean): Promise<ITranscriptManager> {
  const { enableFeature, disableFeature } = await import('./feature-flags')

  if (useRefactored) {
    enableFeature('useRefactoredTranscriptManager')
  } else {
    disableFeature('useRefactoredTranscriptManager')
  }

  return reloadTranscriptManager()
}

// 暴露到 window 供調試使用
if (typeof window !== 'undefined') {
  (window as any).transcriptManagerAdapter = {
    getCurrentImplementation,
    switchToRefactored: () => switchImplementation(true),
    switchToLegacy: () => switchImplementation(false),
    reload: reloadTranscriptManager,
    getManager: getTranscriptManager,
  }

  console.log('🎯 [TranscriptManagerAdapter] 調試介面已暴露到 window.transcriptManagerAdapter')
  console.log('   切換到新實現: window.transcriptManagerAdapter.switchToRefactored()')
  console.log('   切換到舊實現: window.transcriptManagerAdapter.switchToLegacy()')
}
