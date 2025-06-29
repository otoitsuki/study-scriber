"use client"

import { BaseService, ServiceStatus } from './base-service'

/**
 * ServiceContainer - 服務依賴注入容器
 *
 * 參考後端 container.py 模式，提供：
 * - Singleton 模式 (參考 TranscriptManager.getInstance())
 * - 類型安全的服務註冊和解析
 * - 服務生命週期管理
 * - 依賴關係管理
 */
export class ServiceContainer {
    /**
     * Singleton 實例
     */
    private static instance: ServiceContainer | null = null

    /**
     * 服務工廠函數映射表
     * key: 服務識別符, value: 服務工廠函數
     */
    private readonly providers = new Map<string, () => any>()

    /**
     * 單例服務實例快取
     * key: 服務識別符, value: 服務實例
     */
    private readonly singletons = new Map<string, any>()

    /**
     * 已註冊的單例服務標識
     */
    private readonly singletonKeys = new Set<string>()

    /**
     * 私有建構子 (Singleton 模式)
     */
    private constructor() {
        // 開發模式下將實例掛到全域以利除錯
        if (typeof window !== 'undefined') {
            ; (window as any).serviceContainer = this
            console.log('🔧 [ServiceContainer] 服務容器已初始化')
        }
    }

    /**
     * 取得 ServiceContainer 實例 (Singleton)
     */
    static getInstance(): ServiceContainer {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer()
        }
        return ServiceContainer.instance
    }

    /**
     * 註冊服務工廠函數
     * 參考後端 container.py 的 register 方法
     *
     * @param key 服務識別符
     * @param factory 服務工廠函數
     */
    register<T>(key: string, factory: () => T): void {
        if (this.providers.has(key)) {
            console.warn(`⚠️ [ServiceContainer] 服務 "${key}" 已存在，將被覆蓋`)
        }

        this.providers.set(key, factory)
        console.log(`✅ [ServiceContainer] 服務 "${key}" 註冊成功`)
    }

    /**
     * 註冊單例服務
     * 單例服務只會被創建一次，後續調用返回同一實例
     *
     * @param key 服務識別符
     * @param factory 服務工廠函數
     */
    registerSingleton<T>(key: string, factory: () => T): void {
        this.register(key, factory)
        this.singletonKeys.add(key)
        console.log(`✅ [ServiceContainer] 單例服務 "${key}" 註冊成功`)
    }

    /**
     * 解析服務實例
     * 參考後端 container.py 的 resolve 方法
     *
     * @param key 服務識別符
     * @returns 服務實例
     * @throws 如果服務未註冊
     */
    resolve<T>(key: string): T {
        // 檢查單例快取
        if (this.singletonKeys.has(key) && this.singletons.has(key)) {
            return this.singletons.get(key) as T
        }

        // 取得工廠函數
        const provider = this.providers.get(key)
        if (!provider) {
            const error = `服務 "${key}" 未註冊`
            console.error(`❌ [ServiceContainer] ${error}`)
            throw new Error(error)
        }

        try {
            const instance = provider() as T

            // 單例服務快取實例
            if (this.singletonKeys.has(key)) {
                this.singletons.set(key, instance)
            }

            console.log(`✅ [ServiceContainer] 服務 "${key}" 解析成功`)
            return instance
        } catch (error) {
            console.error(`❌ [ServiceContainer] 創建服務 "${key}" 失敗:`, error)
            throw error
        }
    }

    /**
     * 檢查服務是否已註冊
     *
     * @param key 服務識別符
     */
    isRegistered(key: string): boolean {
        return this.providers.has(key)
    }

    /**
     * 取得所有已註冊的服務識別符
     */
    getRegisteredServices(): string[] {
        return Array.from(this.providers.keys())
    }

    /**
     * 清除指定服務註冊
     *
     * @param key 服務識別符
     */
    unregister(key: string): boolean {
        const hasProvider = this.providers.delete(key)
        this.singletons.delete(key)
        this.singletonKeys.delete(key)

        if (hasProvider) {
            console.log(`🗑️ [ServiceContainer] 服務 "${key}" 已清除`)
        }

        return hasProvider
    }

    /**
     * 清除所有服務註冊
     * 主要用於測試環境
     */
    clear(): void {
        const count = this.providers.size
        this.providers.clear()
        this.singletons.clear()
        this.singletonKeys.clear()
        console.log(`🗑️ [ServiceContainer] 已清除 ${count} 個服務`)
    }

    /**
     * 獲取容器狀態摘要
     */
    getContainerStatus(): ServiceContainerStatus {
        const registeredServices = this.getRegisteredServices()
        const activeSingletons = Array.from(this.singletons.keys())

        return {
            totalServices: registeredServices.length,
            activeSingletonsCount: activeSingletons.length,
            registeredServices,
            activeSingletons,
            timestamp: new Date().toISOString()
        }
    }

    /**
     * 初始化所有已註冊的 BaseService 實例
     * 用於應用程式啟動時統一初始化服務
     */
    async initializeServices(): Promise<ServiceInitializationResult[]> {
        const results: ServiceInitializationResult[] = []
        const services = this.getRegisteredServices()

        console.log(`🚀 [ServiceContainer] 開始初始化 ${services.length} 個服務...`)

        for (const serviceKey of services) {
            try {
                const service = this.resolve(serviceKey)

                // 檢查是否為 BaseService 實例
                if (service instanceof BaseService) {
                    await service.start()
                    results.push({
                        serviceKey,
                        success: true,
                        status: service.getStatus()
                    })
                    console.log(`✅ [ServiceContainer] 服務 "${serviceKey}" 初始化成功`)
                } else {
                    // 非 BaseService 實例，跳過初始化
                    results.push({
                        serviceKey,
                        success: true,
                        status: null,
                        message: '非 BaseService 實例，跳過初始化'
                    })
                    console.log(`ℹ️ [ServiceContainer] 服務 "${serviceKey}" 非 BaseService 實例，跳過初始化`)
                }
            } catch (error) {
                results.push({
                    serviceKey,
                    success: false,
                    error: error instanceof Error ? error.message : '未知錯誤'
                })
                console.error(`❌ [ServiceContainer] 服務 "${serviceKey}" 初始化失敗:`, error)
            }
        }

        const successCount = results.filter(r => r.success).length
        console.log(`🎯 [ServiceContainer] 服務初始化完成: ${successCount}/${services.length} 成功`)

        return results
    }

    /**
     * 清理所有已啟動的 BaseService 實例
     * 用於應用程式關閉時統一清理資源
     */
    async cleanupServices(): Promise<ServiceCleanupResult[]> {
        const results: ServiceCleanupResult[] = []
        const singletonKeys = Array.from(this.singletons.keys())

        console.log(`🛑 [ServiceContainer] 開始清理 ${singletonKeys.length} 個單例服務...`)

        for (const serviceKey of singletonKeys) {
            try {
                const service = this.singletons.get(serviceKey)

                if (service instanceof BaseService && service.isRunning) {
                    await service.stop()
                    results.push({
                        serviceKey,
                        success: true
                    })
                    console.log(`✅ [ServiceContainer] 服務 "${serviceKey}" 清理成功`)
                } else {
                    results.push({
                        serviceKey,
                        success: true,
                        message: '服務未運行或非 BaseService 實例'
                    })
                }
            } catch (error) {
                results.push({
                    serviceKey,
                    success: false,
                    error: error instanceof Error ? error.message : '未知錯誤'
                })
                console.error(`❌ [ServiceContainer] 服務 "${serviceKey}" 清理失敗:`, error)
            }
        }

        const successCount = results.filter(r => r.success).length
        console.log(`🎯 [ServiceContainer] 服務清理完成: ${successCount}/${singletonKeys.length} 成功`)

        return results
    }
}

/**
 * 服務容器錯誤類別
 */
export class ServiceContainerError extends Error {
    readonly errorType: 'UNREGISTERED_SERVICE' | 'CREATION_FAILED' | 'UNKNOWN'
    readonly serviceKey: string
    readonly originalError?: unknown

    constructor(
        message: string,
        errorType: 'UNREGISTERED_SERVICE' | 'CREATION_FAILED' | 'UNKNOWN',
        serviceKey: string,
        originalError?: unknown
    ) {
        super(message)
        this.name = 'ServiceContainerError'
        this.errorType = errorType
        this.serviceKey = serviceKey
        this.originalError = originalError
    }
}

/**
 * 容器狀態介面
 */
export interface ServiceContainerStatus {
    totalServices: number
    activeSingletonsCount: number
    registeredServices: string[]
    activeSingletons: string[]
    timestamp: string
}

/**
 * 服務初始化結果介面
 */
export interface ServiceInitializationResult {
    serviceKey: string
    success: boolean
    status?: ServiceStatus | null
    error?: string
    message?: string
}

/**
 * 服務清理結果介面
 */
export interface ServiceCleanupResult {
    serviceKey: string
    success: boolean
    error?: string
    message?: string
}

/**
 * 匯出全域容器實例 (Singleton)
 * 方便其他模組使用
 */
export const serviceContainer = ServiceContainer.getInstance()
