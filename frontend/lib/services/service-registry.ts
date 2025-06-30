"use client"

import { serviceContainer } from './service-container'
import { SessionService } from './session-service'
import { RecordingService } from './recording-service'
import { SimpleRecordingService } from './simple-recording-service'
import { TranscriptService } from './transcript-service'
import { RecordingFlowService } from './recording-flow-service'
import { SERVICE_KEYS } from './interfaces'
import { isFeatureEnabled } from '../feature-flags'

/**
 * 服務註冊管理
 *
 * 統一管理所有服務的註冊和初始化
 */
export class ServiceRegistry {
    private static isRegistered = false

    /**
     * 註冊所有服務
     *
     * 使用 Singleton 模式確保服務只註冊一次
     */
    static async registerServices(): Promise<void> {
        if (ServiceRegistry.isRegistered) {
            console.log('🔄 [ServiceRegistry] 服務已註冊，跳過重複註冊')
            return
        }

        try {
            console.log('🚀 [ServiceRegistry] 開始註冊服務...')

            // 註冊 SessionService
            serviceContainer.registerSingleton(SERVICE_KEYS.SESSION_SERVICE, () => new SessionService())
            console.log('✅ [ServiceRegistry] SessionService 註冊完成')

            // 註冊 RecordingService（根據功能開關選擇）
            if (isFeatureEnabled('useSimpleRecordingService')) {
                serviceContainer.registerSingleton(SERVICE_KEYS.RECORDING_SERVICE, () => new SimpleRecordingService())
                console.log('✅ [ServiceRegistry] SimpleRecordingService 註冊完成 (Phase 2)')
            } else {
                serviceContainer.registerSingleton(SERVICE_KEYS.RECORDING_SERVICE, () => new RecordingService())
                console.log('✅ [ServiceRegistry] RecordingService 註冊完成 (Legacy)')
            }

            // 註冊 TranscriptService
            serviceContainer.registerSingleton(SERVICE_KEYS.TRANSCRIPT_SERVICE, () => new TranscriptService())
            console.log('✅ [ServiceRegistry] TranscriptService 註冊完成')

            // 註冊 RecordingFlowService
            serviceContainer.registerSingleton(SERVICE_KEYS.RECORDING_FLOW_SERVICE, () => new RecordingFlowService())
            console.log('✅ [ServiceRegistry] RecordingFlowService 註冊完成')

            ServiceRegistry.isRegistered = true
            console.log('✅ [ServiceRegistry] 所有服務註冊完成')

        } catch (error) {
            console.error('❌ [ServiceRegistry] 服務註冊失敗:', error)
            throw error
        }
    }

    /**
     * 初始化所有服務
     *
     * 啟動所有已註冊的服務
     */
    static async initializeServices(): Promise<void> {
        try {
            console.log('🚀 [ServiceRegistry] 開始初始化服務...')

            // 確保服務已註冊
            await ServiceRegistry.registerServices()

            // 初始化 SessionService
            const sessionService = serviceContainer.resolve<SessionService>(SERVICE_KEYS.SESSION_SERVICE)
            await sessionService.start()

            // 初始化 RecordingService
            const recordingService = serviceContainer.resolve<RecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
            await recordingService.start()

            // 初始化 TranscriptService
            const transcriptService = serviceContainer.resolve<TranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)
            await transcriptService.start()

            // 初始化 RecordingFlowService
            const recordingFlowService = serviceContainer.resolve<RecordingFlowService>(SERVICE_KEYS.RECORDING_FLOW_SERVICE)
            await recordingFlowService.start()

            console.log('✅ [ServiceRegistry] 所有服務初始化完成')

        } catch (error) {
            console.error('❌ [ServiceRegistry] 服務初始化失敗:', error)
            throw error
        }
    }

    /**
     * 停止所有服務
     */
    static async stopServices(): Promise<void> {
        try {
            console.log('🛑 [ServiceRegistry] 開始停止服務...')

            if (!ServiceRegistry.isRegistered) {
                console.log('ℹ️ [ServiceRegistry] 服務未註冊，無需停止')
                return
            }

            // 按相反順序停止服務
            const recordingFlowService = serviceContainer.resolve<RecordingFlowService>(SERVICE_KEYS.RECORDING_FLOW_SERVICE)
            await recordingFlowService.stop()

            const transcriptService = serviceContainer.resolve<TranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)
            await transcriptService.stop()

            const recordingService = serviceContainer.resolve<RecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
            await recordingService.stop()

            const sessionService = serviceContainer.resolve<SessionService>(SERVICE_KEYS.SESSION_SERVICE)
            await sessionService.stop()

            console.log('✅ [ServiceRegistry] 所有服務停止完成')

        } catch (error) {
            console.error('❌ [ServiceRegistry] 服務停止失敗:', error)
            throw error
        }
    }

    /**
     * 取得服務註冊狀態
     */
    static getRegistrationStatus(): {
        isRegistered: boolean
        registeredServices: string[]
    } {
        return {
            isRegistered: ServiceRegistry.isRegistered,
            registeredServices: serviceContainer.getRegisteredServices()
        }
    }
}

// 自動註冊服務（在模組載入時）
ServiceRegistry.registerServices().catch(error => {
    console.error('❌ [ServiceRegistry] 自動註冊失敗:', error)
})
