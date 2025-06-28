"use client"

import React from 'react'
import { AppStateProvider } from '../hooks/use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'

interface AppStateProviderWrapperProps {
    children: React.ReactNode
}

/**
 * AppStateProvider 包裝器
 * 根據功能開關決定是否啟用新的狀態管理系統
 * 這提供了漸進式部署的能力，可以安全地在新舊系統間切換
 */
export function AppStateProviderWrapper({ children }: AppStateProviderWrapperProps) {
    // 檢查是否啟用新的狀態管理系統
    const useNewStateManagement = isFeatureEnabled('useNewStateManagement')
    const useNewAppStateHook = isFeatureEnabled('useNewAppStateHook')

    console.log('🔄 [AppStateProviderWrapper] 功能開關狀態:', {
        useNewStateManagement,
        useNewAppStateHook,
        willUseProvider: useNewStateManagement || useNewAppStateHook
    })

    // 如果啟用新狀態管理，使用 AppStateProvider 包裝
    if (useNewStateManagement || useNewAppStateHook) {
        console.log('🔄 [AppStateProviderWrapper] 啟用新狀態管理 - 使用 AppStateProvider')
        return (
            <AppStateProvider>
                {children}
            </AppStateProvider>
        )
    }

    // 否則直接渲染子組件（使用舊系統）
    console.log('🔄 [AppStateProviderWrapper] 使用舊狀態管理 - 直接渲染')
    return <>{children}</>
}
