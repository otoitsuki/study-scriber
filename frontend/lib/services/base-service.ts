"use client"

/**
 * BaseService - 服務層基礎抽象類
 *
 * 提供統一的服務基礎設施：
 * - 統一日誌介面
 * - 生命週期管理 (initialize/cleanup)
 * - 錯誤處理模式
 * - 服務狀態管理
 */
export abstract class BaseService {
    /**
     * 日誌工具 - 重用現有的 console 模式
     */
    protected readonly logger = console

    /**
     * 服務名稱，用於日誌和調試
     */
    protected abstract readonly serviceName: string

    /**
     * 服務初始化狀態
     */
    private _isInitialized = false

    /**
     * 服務是否正在運行
     */
    private _isRunning = false

    /**
     * 初始化服務
     * 子類必須實現具體的初始化邏輯
     */
    abstract initialize(): Promise<void>

    /**
     * 清理服務資源
     * 子類必須實現具體的清理邏輯
     */
    abstract cleanup(): Promise<void>

    /**
     * 啟動服務
     * 統一的啟動流程：檢查狀態 → 初始化 → 標記為運行中
     */
    async start(): Promise<void> {
        if (this._isRunning) {
            this.logger.warn(`🔄 [${this.serviceName}] 服務已在運行中，跳過啟動`)
            return
        }

        try {
            this.logger.log(`🚀 [${this.serviceName}] 開始啟動服務...`)

            if (!this._isInitialized) {
                await this.initialize()
                this._isInitialized = true
                this.logger.log(`✅ [${this.serviceName}] 服務初始化完成`)
            }

            this._isRunning = true
            this.logger.log(`✅ [${this.serviceName}] 服務啟動成功`)
        } catch (error) {
            this.logger.error(`❌ [${this.serviceName}] 服務啟動失敗:`, error)
            throw error
        }
    }

    /**
     * 停止服務
     * 統一的停止流程：檢查狀態 → 清理資源 → 標記為停止
     */
    async stop(): Promise<void> {
        if (!this._isRunning) {
            this.logger.warn(`🔄 [${this.serviceName}] 服務未在運行中，跳過停止`)
            return
        }

        try {
            this.logger.log(`🛑 [${this.serviceName}] 開始停止服務...`)

            await this.cleanup()
            this._isRunning = false

            this.logger.log(`✅ [${this.serviceName}] 服務停止完成`)
        } catch (error) {
            this.logger.error(`❌ [${this.serviceName}] 服務停止失敗:`, error)
            throw error
        }
    }

    /**
     * 重啟服務
     * 先停止，再啟動
     */
    async restart(): Promise<void> {
        this.logger.log(`🔄 [${this.serviceName}] 開始重啟服務...`)
        await this.stop()
        await this.start()
        this.logger.log(`✅ [${this.serviceName}] 服務重啟完成`)
    }

    /**
     * 檢查服務是否已初始化
     */
    get isInitialized(): boolean {
        return this._isInitialized
    }

    /**
     * 檢查服務是否正在運行
     */
    get isRunning(): boolean {
        return this._isRunning
    }

    /**
     * 獲取服務狀態摘要
     */
    getStatus(): ServiceStatus {
        return {
            serviceName: this.serviceName,
            isInitialized: this._isInitialized,
            isRunning: this._isRunning,
            timestamp: new Date().toISOString()
        }
    }

    /**
     * 統一錯誤處理
     * 提供一致的錯誤日誌格式和錯誤包裝
     */
    protected handleError(operation: string, error: unknown): never {
        const errorMessage = error instanceof Error ? error.message : '未知錯誤'
        const fullMessage = `${this.serviceName} ${operation} 失敗: ${errorMessage}`

        this.logger.error(`❌ [${this.serviceName}] ${operation} 失敗:`, error)

        throw new ServiceError(fullMessage, {
            serviceName: this.serviceName,
            operation,
            originalError: error,
            timestamp: new Date().toISOString()
        })
    }

    /**
     * 統一成功日誌
     */
    protected logSuccess(operation: string, details?: any): void {
        this.logger.log(`✅ [${this.serviceName}] ${operation} 成功`, details ? details : '')
    }

    /**
     * 統一資訊日誌
     */
    protected logInfo(message: string, details?: any): void {
        this.logger.log(`ℹ️ [${this.serviceName}] ${message}`, details ? details : '')
    }

    /**
     * 統一警告日誌
     */
    protected logWarning(message: string, details?: any): void {
        this.logger.warn(`⚠️ [${this.serviceName}] ${message}`, details ? details : '')
    }
}

/**
 * 服務狀態介面
 */
export interface ServiceStatus {
    serviceName: string
    isInitialized: boolean
    isRunning: boolean
    timestamp: string
}

/**
 * 服務錯誤類別
 * 提供結構化的錯誤訊息和上下文
 */
export class ServiceError extends Error {
    readonly serviceName: string
    readonly operation: string
    readonly originalError: unknown
    readonly timestamp: string

    constructor(message: string, context: {
        serviceName: string
        operation: string
        originalError: unknown
        timestamp: string
    }) {
        super(message)
        this.name = 'ServiceError'
        this.serviceName = context.serviceName
        this.operation = context.operation
        this.originalError = context.originalError
        this.timestamp = context.timestamp
    }
}
