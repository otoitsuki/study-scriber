"use client"

/**
 * 服務層統一入口
 *
 * 提供服務層所有模組的統一匯出
 */

// 基礎服務類別
export { BaseService, ServiceError } from './base-service'
export type { ServiceStatus } from './base-service'

// 服務容器
export { ServiceContainer, ServiceContainerError, serviceContainer } from './service-container'
export type {
    ServiceContainerStatus,
    ServiceInitializationResult,
    ServiceCleanupResult
} from './service-container'

// 具體服務實現
export { SessionService } from './session-service'
export type { SessionServiceStatus } from './session-service'

export { RecordingService } from './recording-service'
export type { RecordingServiceStatus } from './recording-service'

export { TranscriptService } from './transcript-service'

// 服務註冊
export { ServiceRegistry } from './service-registry'

// 服務介面和鍵值
export type {
    ISessionService,
    IRecordingService,
    ITranscriptService,
    IServiceContainer,
    RecordingState,
    TranscriptMessage,
    TranscriptEntry,
    ServiceKey,
    ServiceTypeMap
} from './interfaces'

export { SERVICE_KEYS } from './interfaces'
