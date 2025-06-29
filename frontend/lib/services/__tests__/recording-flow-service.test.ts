/**
 * RecordingFlowService 409 衝突處理測試
 *
 * 測試 RecordingFlowService 在使用 ensureRecordingSession 時的 409 衝突處理邏輯
 * 確保 UI 狀態能正確從 default → recording_waiting → recording_active
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingFlowService, RecordingFlowResult } from '../recording-flow-service'
import { serviceContainer } from '../service-container'
import { SERVICE_KEYS } from '../interfaces'
import type { ISessionService, IRecordingService, ITranscriptService, SessionResponse } from '../interfaces'

// Mock 服務容器
vi.mock('../service-container', () => ({
    serviceContainer: {
        resolve: vi.fn()
    }
}))

describe('RecordingFlowService - 409 衝突處理', () => {
    let recordingFlowService: RecordingFlowService
    let mockSessionService: any
    let mockRecordingService: any
    let mockTranscriptService: any
    let mockServiceContainer: any

    // 測試用的會話數據
    const mockExistingRecordingSession: SessionResponse = {
        id: 'existing-recording-session-123',
        title: '現有錄音會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }

    const mockNewRecordingSession: SessionResponse = {
        id: 'new-recording-session-456',
        title: '新錄音會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T01:00:00Z',
        updated_at: '2024-01-01T01:00:00Z'
    }

    const mockUpgradedSession: SessionResponse = {
        id: 'note-session-789',
        title: '升級的筆記會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T02:00:00Z',
        updated_at: '2024-01-01T02:00:00Z'
    }

    beforeEach(() => {
        // 創建 mock 服務
        mockSessionService = {
            ensureRecordingSession: vi.fn(),
            finishSession: vi.fn()
        } as Partial<ISessionService>

        mockRecordingService = {
            startRecording: vi.fn(),
            stopRecording: vi.fn()
        } as Partial<IRecordingService>

        mockTranscriptService = {
            connect: vi.fn(),
            disconnect: vi.fn(),
            addTranscriptListener: vi.fn(),
            removeTranscriptListener: vi.fn()
        } as Partial<ITranscriptService>

        // 設置服務容器 mock
        mockServiceContainer = serviceContainer as any
        mockServiceContainer.resolve.mockImplementation((key: string) => {
            switch (key) {
                case SERVICE_KEYS.SESSION_SERVICE:
                    return mockSessionService
                case SERVICE_KEYS.RECORDING_SERVICE:
                    return mockRecordingService
                case SERVICE_KEYS.TRANSCRIPT_SERVICE:
                    return mockTranscriptService
                default:
                    throw new Error(`Unknown service key: ${key}`)
            }
        })

        recordingFlowService = new RecordingFlowService()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('startRecordingFlow - 成功情境', () => {
        test('當沒有現有會話時，應該成功創建新的錄音會話並啟動流程', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            const result: RecordingFlowResult = await recordingFlowService.startRecordingFlow('測試標題')

            // Assert
            expect(result.success).toBe(true)
            expect(result.sessionId).toBe(mockNewRecordingSession.id)
            expect(result.error).toBeUndefined()

            // 驗證方法調用順序
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith('測試標題')
            expect(mockTranscriptService.connect).toHaveBeenCalledWith(mockNewRecordingSession.id)
            expect(mockRecordingService.startRecording).toHaveBeenCalledWith(mockNewRecordingSession.id)

            // 驗證服務狀態
            expect(recordingFlowService.isActive()).toBe(true)
            expect(recordingFlowService.getCurrentSessionId()).toBe(mockNewRecordingSession.id)
        })

        test('當標題為空時，應該使用預設標題', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            await recordingFlowService.startRecordingFlow()

            // Assert
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith(
                expect.stringMatching(/錄音筆記 \d{1,2}\/\d{1,2}\/\d{4}/)
            )
        })
    })

    describe('startRecordingFlow - 409 衝突處理', () => {
        test('當 ensureRecordingSession 處理 409 衝突並返回現有錄音會話時，流程應該正常啟動', async () => {
            // Arrange - ensureRecordingSession 自動處理 409 並返回現有會話
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockExistingRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            const result: RecordingFlowResult = await recordingFlowService.startRecordingFlow('新標題')

            // Assert - 驗證流程成功使用現有會話
            expect(result.success).toBe(true)
            expect(result.sessionId).toBe(mockExistingRecordingSession.id)
            expect(result.error).toBeUndefined()

            // 驗證使用現有會話啟動錄音流程
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith('新標題')
            expect(mockTranscriptService.connect).toHaveBeenCalledWith(mockExistingRecordingSession.id)
            expect(mockRecordingService.startRecording).toHaveBeenCalledWith(mockExistingRecordingSession.id)

            // 驗證狀態正確設置
            expect(recordingFlowService.isActive()).toBe(true)
            expect(recordingFlowService.getCurrentSessionId()).toBe(mockExistingRecordingSession.id)
        })

        test('當 ensureRecordingSession 處理 409 衝突並升級筆記會話時，流程應該正常啟動', async () => {
            // Arrange - ensureRecordingSession 自動處理 409，升級筆記會話並返回
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockUpgradedSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            const result: RecordingFlowResult = await recordingFlowService.startRecordingFlow('測試標題')

            // Assert - 驗證流程成功使用升級後的會話
            expect(result.success).toBe(true)
            expect(result.sessionId).toBe(mockUpgradedSession.id)
            expect(result.error).toBeUndefined()

            // 驗證使用升級後的會話啟動錄音流程
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith('測試標題')
            expect(mockTranscriptService.connect).toHaveBeenCalledWith(mockUpgradedSession.id)
            expect(mockRecordingService.startRecording).toHaveBeenCalledWith(mockUpgradedSession.id)

            // 驗證狀態正確設置
            expect(recordingFlowService.isActive()).toBe(true)
            expect(recordingFlowService.getCurrentSessionId()).toBe(mockUpgradedSession.id)
        })

        test('當 ensureRecordingSession 拋出錯誤時，應該正確處理並返回錯誤結果', async () => {
            // Arrange
            const sessionError = new Error('會話創建失敗')
            mockSessionService.ensureRecordingSession.mockRejectedValueOnce(sessionError)

            // Act & Assert - 驗證拋出 ServiceError
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('RecordingFlowService 錄音流程啟動失敗 失敗: 會話創建失敗')

            // 驗證錄音流程沒有啟動
            expect(mockTranscriptService.connect).not.toHaveBeenCalled()
            expect(mockRecordingService.startRecording).not.toHaveBeenCalled()

            // 驗證狀態重置
            expect(recordingFlowService.isActive()).toBe(false)
            expect(recordingFlowService.getCurrentSessionId()).toBeNull()
        })
    })

    describe('startRecordingFlow - 錯誤處理', () => {
        test('當逐字稿服務連接失敗時，應該正確處理錯誤', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            const transcriptError = new Error('逐字稿服務連接失敗')
            mockTranscriptService.connect.mockRejectedValueOnce(transcriptError)

            // Act & Assert - 驗證拋出 ServiceError
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('RecordingFlowService 錄音流程啟動失敗 失敗: 逐字稿服務連接失敗')

            // 驗證錄音沒有啟動
            expect(mockRecordingService.startRecording).not.toHaveBeenCalled()

            // 驗證狀態重置
            expect(recordingFlowService.isActive()).toBe(false)
            expect(recordingFlowService.getCurrentSessionId()).toBeNull()
        })

        test('當錄音服務啟動失敗時，應該正確處理錯誤', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            const recordingError = new Error('錄音啟動失敗')
            mockRecordingService.startRecording.mockRejectedValueOnce(recordingError)

            // Act & Assert - 驗證拋出 ServiceError
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('RecordingFlowService 錄音流程啟動失敗 失敗: 錄音啟動失敗')

            // 驗證狀態重置
            expect(recordingFlowService.isActive()).toBe(false)
            expect(recordingFlowService.getCurrentSessionId()).toBeNull()
        })

        test('當錄音流程已在進行中時，應該拋出錯誤', async () => {
            // Arrange - 先啟動一個錄音流程
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            await recordingFlowService.startRecordingFlow('第一個會話')

            // Act & Assert - 嘗試啟動第二個錄音流程
            await expect(recordingFlowService.startRecordingFlow('第二個會話'))
                .rejects.toThrow('錄音流程已在進行中')
        })
    })

    describe('監聽器事件觸發', () => {
        test('應該正確觸發監聽器事件', async () => {
            // Arrange
            const mockListener = {
                onRecordingStatusChange: vi.fn(),
                onError: vi.fn()
            }

            recordingFlowService.addListener(mockListener)

            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            await recordingFlowService.startRecordingFlow('測試標題')

            // Assert - 驗證錄音狀態變更事件被觸發
            expect(mockListener.onRecordingStatusChange).toHaveBeenCalledWith(true)
            expect(mockListener.onError).not.toHaveBeenCalled()
        })

        test('當錄音流程失敗時，應該觸發錯誤事件', async () => {
            // Arrange
            const mockListener = {
                onRecordingStatusChange: vi.fn(),
                onError: vi.fn()
            }

            recordingFlowService.addListener(mockListener)

            const sessionError = new Error('會話創建失敗')
            mockSessionService.ensureRecordingSession.mockRejectedValueOnce(sessionError)

            // Act & Assert - 期望拋出錯誤但捕獲以驗證事件
            try {
                await recordingFlowService.startRecordingFlow('測試標題')
            } catch (error) {
                // 預期的錯誤，繼續驗證事件
            }

            // Assert - 驗證錯誤事件被觸發
            expect(mockListener.onError).toHaveBeenCalledWith('會話創建失敗')
            expect(mockListener.onRecordingStatusChange).not.toHaveBeenCalled()
        })

        test('應該能正確添加和移除監聽器', () => {
            // Arrange
            const mockListener = {
                onRecordingStatusChange: vi.fn()
            }

            // Act & Assert - 添加監聽器
            recordingFlowService.addListener(mockListener)
            expect(recordingFlowService['listeners']).toContain(mockListener)

            // Act & Assert - 移除監聽器
            recordingFlowService.removeListener(mockListener)
            expect(recordingFlowService['listeners']).not.toContain(mockListener)
        })
    })

    describe('stopRecordingFlow - 正常停止流程', () => {
        beforeEach(async () => {
            // 啟動錄音流程
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            await recordingFlowService.startRecordingFlow('測試標題')
        })

        test('應該正確停止錄音流程並清理資源', async () => {
            // Arrange
            mockRecordingService.stopRecording.mockResolvedValueOnce(undefined)
            mockTranscriptService.disconnect.mockResolvedValueOnce(undefined)
            mockSessionService.finishSession.mockResolvedValueOnce(undefined)

            const mockListener = {
                onRecordingStatusChange: vi.fn()
            }
            recordingFlowService.addListener(mockListener)

            // Act
            await recordingFlowService.stopRecordingFlow()

            // Assert - 驗證停止順序
            expect(mockRecordingService.stopRecording).toHaveBeenCalled()
            expect(mockTranscriptService.disconnect).toHaveBeenCalledWith(mockNewRecordingSession.id)
            expect(mockSessionService.finishSession).toHaveBeenCalledWith(mockNewRecordingSession.id)

            // 驗證監聽器事件
            expect(mockListener.onRecordingStatusChange).toHaveBeenCalledWith(false)

            // 驗證狀態清理
            expect(recordingFlowService.isActive()).toBe(false)
            expect(recordingFlowService.getCurrentSessionId()).toBeNull()
        })

        test('當沒有活躍流程時，停止操作應該安全執行', async () => {
            // Arrange - 先停止一次
            mockRecordingService.stopRecording.mockResolvedValueOnce(undefined)
            mockTranscriptService.disconnect.mockResolvedValueOnce(undefined)
            mockSessionService.finishSession.mockResolvedValueOnce(undefined)

            await recordingFlowService.stopRecordingFlow()

            // Act - 再次停止
            await expect(recordingFlowService.stopRecordingFlow()).resolves.not.toThrow()

            // Assert - 驗證服務方法不會被重複調用
            expect(mockRecordingService.stopRecording).toHaveBeenCalledTimes(1)
        })
    })

    describe('整合流程測試', () => {
        test('完整的 409 衝突處理 + 錄音流程：ensureRecordingSession → 連接逐字稿 → 啟動錄音', async () => {
            // Arrange
            const mockListener = {
                onRecordingStatusChange: vi.fn(),
                onTranscriptReceived: vi.fn(),
                onError: vi.fn()
            }

            recordingFlowService.addListener(mockListener)

            // 模擬 ensureRecordingSession 成功處理 409 並返回現有會話
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockExistingRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act - 完整流程
            const result = await recordingFlowService.startRecordingFlow('整合測試標題')

            // Assert - 驗證完整流程成功
            expect(result.success).toBe(true)
            expect(result.sessionId).toBe(mockExistingRecordingSession.id)

            // 驗證調用順序正確
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledBefore(
                mockTranscriptService.connect as any
            )
            expect(mockTranscriptService.connect).toHaveBeenCalledBefore(
                mockRecordingService.startRecording as any
            )

            // 驗證參數傳遞正確
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith('整合測試標題')
            expect(mockTranscriptService.connect).toHaveBeenCalledWith(mockExistingRecordingSession.id)
            expect(mockRecordingService.startRecording).toHaveBeenCalledWith(mockExistingRecordingSession.id)

            // 驗證狀態正確
            expect(recordingFlowService.isActive()).toBe(true)
            expect(recordingFlowService.getCurrentSessionId()).toBe(mockExistingRecordingSession.id)

            // 驗證監聽器事件
            expect(mockListener.onRecordingStatusChange).toHaveBeenCalledWith(true)
            expect(mockListener.onError).not.toHaveBeenCalled()
        })

        test('錯誤恢復：會話創建失敗後狀態正確重置，下次調用能正常工作', async () => {
            // Arrange
            const sessionError = new Error('首次會話創建失敗')
            mockSessionService.ensureRecordingSession.mockRejectedValueOnce(sessionError)

            // Act 1 - 首次失敗
            try {
                await recordingFlowService.startRecordingFlow('首次嘗試')
            } catch (error) {
                // 預期的錯誤
            }

            // Assert 1 - 驗證首次失敗後狀態重置
            expect(recordingFlowService.isActive()).toBe(false)

            // Arrange 2 - 設置第二次成功
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockNewRecordingSession)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act 2 - 第二次成功
            const secondResult = await recordingFlowService.startRecordingFlow('第二次嘗試')

            // Assert 2 - 驗證第二次成功
            expect(secondResult.success).toBe(true)
            expect(secondResult.sessionId).toBe(mockNewRecordingSession.id)
            expect(recordingFlowService.isActive()).toBe(true)
            expect(recordingFlowService.getCurrentSessionId()).toBe(mockNewRecordingSession.id)
        })
    })
})
