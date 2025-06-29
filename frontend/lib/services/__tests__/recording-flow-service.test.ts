/**
 * RecordingFlowService 核心功能測試
 *
 * 測試 RecordingFlowService 的核心功能，確保：
 * 1. startRecordingFlow 成功時返回 SessionResponse
 * 2. startRecordingFlow 失敗時拋出錯誤
 * 3. 狀態管理正確
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { RecordingFlowService } from '../recording-flow-service'
import { serviceContainer } from '../service-container'
import { SERVICE_KEYS } from '../interfaces'
import type { ISessionService, IRecordingService, ITranscriptService } from '../interfaces'
import type { SessionResponse } from '../../api'

// Mock 服務容器
vi.mock('../service-container', () => ({
    serviceContainer: {
        resolve: vi.fn()
    }
}))

describe('RecordingFlowService - 核心功能', () => {
    let recordingFlowService: RecordingFlowService
    let mockSessionService: any
    let mockRecordingService: any
    let mockTranscriptService: any
    let mockServiceContainer: any

    // 測試用的會話數據
    const mockSessionResponse: SessionResponse = {
        id: 'test-session-123',
        title: '測試錄音會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }

    beforeEach(async () => {
        // 創建 mock 服務
        mockSessionService = {
            ensureRecordingSession: vi.fn(),
            waitForSessionReady: vi.fn(),
            finishSession: vi.fn()
        } as Partial<ISessionService>

        mockRecordingService = {
            startRecording: vi.fn(),
            stopRecording: vi.fn(),
            isRecording: vi.fn(),
            getRecordingTime: vi.fn()
        } as Partial<IRecordingService>

        mockTranscriptService = {
            connect: vi.fn(),
            disconnect: vi.fn(),
            addTranscriptListener: vi.fn(),
            removeTranscriptListener: vi.fn(),
            isConnected: vi.fn()
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
        await recordingFlowService.initialize()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('startRecordingFlow - 成功情境', () => {
        test('成功啟動錄音流程應該返回 SessionResponse', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            const result = await recordingFlowService.startRecordingFlow('測試標題')

            // Assert
            expect(result).toEqual(mockSessionResponse)
            expect(result.id).toBe(mockSessionResponse.id)
            expect(result.status).toBe('active')
            expect(result.type).toBe('recording')

            // 驗證服務調用
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith('測試標題', undefined)
            expect(mockSessionService.waitForSessionReady).toHaveBeenCalledWith(mockSessionResponse.id, 5000)
            expect(mockTranscriptService.connect).toHaveBeenCalledWith(mockSessionResponse.id)
            expect(mockRecordingService.startRecording).toHaveBeenCalledWith(mockSessionResponse.id)

            // 驗證狀態
            expect(recordingFlowService.isFlowRunning()).toBe(true)
            expect(recordingFlowService.getCurrentSession()).toEqual(mockSessionResponse)
        })

        test('當標題為空時，應該使用預設標題', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            await recordingFlowService.startRecordingFlow()

            // Assert
            expect(mockSessionService.ensureRecordingSession).toHaveBeenCalledWith(
                expect.stringMatching(/錄音筆記 \d{1,2}\/\d{1,2}\/\d{4}/),
                undefined
            )
        })
    })

    describe('startRecordingFlow - 錯誤情境', () => {
        test('當會話創建失敗時，應該拋出錯誤', async () => {
            // Arrange
            const sessionError = new Error('會話創建失敗')
            mockSessionService.ensureRecordingSession.mockRejectedValueOnce(sessionError)

            // Act & Assert
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('會話創建失敗')

            // 驗證其他服務沒有被調用
            expect(mockTranscriptService.connect).not.toHaveBeenCalled()
            expect(mockRecordingService.startRecording).not.toHaveBeenCalled()

            // 驗證狀態重置
            expect(recordingFlowService.isFlowRunning()).toBe(false)
            expect(recordingFlowService.getCurrentSession()).toBeNull()
        })

        test('當會話準備失敗時，應該拋出錯誤', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(false)

            // Act & Assert
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('會話準備超時')

            // 驗證其他服務沒有被調用
            expect(mockTranscriptService.connect).not.toHaveBeenCalled()
            expect(mockRecordingService.startRecording).not.toHaveBeenCalled()
        })

        test('當逐字稿服務連接失敗時，應該拋出錯誤', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            const transcriptError = new Error('逐字稿服務連接失敗')
            mockTranscriptService.connect.mockRejectedValueOnce(transcriptError)

            // Act & Assert
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('逐字稿服務連接失敗')

            // 驗證錄音沒有啟動
            expect(mockRecordingService.startRecording).not.toHaveBeenCalled()
        })

        test('當錄音服務啟動失敗時，應該拋出錯誤', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            const recordingError = new Error('錄音啟動失敗')
            mockRecordingService.startRecording.mockRejectedValueOnce(recordingError)

            // Act & Assert
            await expect(recordingFlowService.startRecordingFlow('測試標題'))
                .rejects.toThrow('錄音啟動失敗')
        })

        test('當流程已在運行時，應該先停止現有流程', async () => {
            // Arrange - 先啟動一個流程
            mockSessionService.ensureRecordingSession.mockResolvedValue(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValue(true)
            mockTranscriptService.connect.mockResolvedValue(undefined)
            mockRecordingService.startRecording.mockResolvedValue(undefined)
            mockRecordingService.stopRecording.mockResolvedValue(undefined)
            mockTranscriptService.disconnect.mockResolvedValue(undefined)
            mockSessionService.finishSession.mockResolvedValue(undefined)

            await recordingFlowService.startRecordingFlow('第一個會話')

            // Act - 啟動第二個流程
            const result = await recordingFlowService.startRecordingFlow('第二個會話')

            // Assert - 驗證第二次啟動成功
            expect(result).toEqual(mockSessionResponse)
            expect(recordingFlowService.isFlowRunning()).toBe(true)
        })
    })

    describe('stopRecordingFlow', () => {
        beforeEach(async () => {
            // 先啟動錄音流程
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)
            mockRecordingService.isRecording.mockReturnValue(true)

            await recordingFlowService.startRecordingFlow('測試標題')
        })

        test('應該正確停止錄音流程', async () => {
            // Arrange
            mockRecordingService.stopRecording.mockResolvedValueOnce(undefined)
            mockTranscriptService.disconnect.mockResolvedValueOnce(undefined)
            mockSessionService.finishSession.mockResolvedValueOnce(undefined)

            // Act
            await recordingFlowService.stopRecordingFlow()

            // Assert - 驗證停止順序
            expect(mockRecordingService.stopRecording).toHaveBeenCalled()
            expect(mockTranscriptService.disconnect).toHaveBeenCalledWith(mockSessionResponse.id)
            expect(mockSessionService.finishSession).toHaveBeenCalledWith(mockSessionResponse.id)

            // 驗證狀態清理
            expect(recordingFlowService.isFlowRunning()).toBe(false)
            expect(recordingFlowService.getCurrentSession()).toBeNull()
        })
    })

    describe('狀態管理', () => {
        test('初始狀態應該正確', () => {
            expect(recordingFlowService.isFlowRunning()).toBe(false)
            expect(recordingFlowService.getCurrentSession()).toBeNull()
            expect(recordingFlowService.getTranscriptEntries()).toEqual([])
        })

        test('啟動後狀態應該正確', async () => {
            // Arrange
            mockSessionService.ensureRecordingSession.mockResolvedValueOnce(mockSessionResponse)
            mockSessionService.waitForSessionReady.mockResolvedValueOnce(true)
            mockTranscriptService.connect.mockResolvedValueOnce(undefined)
            mockRecordingService.startRecording.mockResolvedValueOnce(undefined)

            // Act
            await recordingFlowService.startRecordingFlow('測試標題')

            // Assert
            expect(recordingFlowService.isFlowRunning()).toBe(true)
            expect(recordingFlowService.getCurrentSession()).toEqual(mockSessionResponse)
        })
    })
})


