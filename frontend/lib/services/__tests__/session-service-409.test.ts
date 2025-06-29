/**
 * SessionService 409 衝突處理測試
 *
 * 測試 ensureRecordingSession 方法在遇到會話衝突時的處理邏輯
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionService } from '../session-service'
import { sessionAPI } from '../../api'
import type { SessionResponse } from '../../api'

// Mock sessionAPI
vi.mock('../../api', () => ({
    sessionAPI: {
        createSession: vi.fn(),
        getActiveSession: vi.fn(),
        upgradeToRecording: vi.fn(),
        finishSession: vi.fn(),
        deleteSession: vi.fn()
    }
}))

describe('SessionService - 409 衝突處理', () => {
    let sessionService: SessionService
    const mockSessionAPI = sessionAPI as any

    // 測試用的會話數據
    const mockExistingSession: SessionResponse = {
        id: 'existing-session-123',
        title: '現有錄音會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }

    const mockNewSession: SessionResponse = {
        id: 'new-session-456',
        title: '新錄音會話',
        type: 'recording',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T01:00:00Z',
        updated_at: '2024-01-01T01:00:00Z'
    }

    const mockNoteSession: SessionResponse = {
        id: 'note-session-789',
        title: '現有筆記會話',
        type: 'note_only',
        status: 'active',
        language: 'zh-TW',
        created_at: '2024-01-01T02:00:00Z',
        updated_at: '2024-01-01T02:00:00Z'
    }

    beforeEach(() => {
        sessionService = new SessionService()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('ensureRecordingSession - 成功情境', () => {
        test('當沒有現有會話時，應該成功創建新的錄音會話', async () => {
            // Arrange
            mockSessionAPI.createSession.mockResolvedValueOnce(mockNewSession)

            // Act
            const result = await sessionService.ensureRecordingSession('測試標題')

            // Assert
            expect(result).toEqual(mockNewSession)
            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: '測試標題',
                type: 'recording',
                content: undefined
            })
            expect(mockSessionAPI.getActiveSession).not.toHaveBeenCalled()
        })
    })

    describe('ensureRecordingSession - 409 衝突處理', () => {
        test('當創建會話遇到 409 衝突時，應該獲取現有的錄音會話', async () => {
            // Arrange
            const conflictError = {
                response: {
                    status: 409,
                    data: { detail: '已有活躍會話' }
                },
                isAxiosError: true
            }

            mockSessionAPI.createSession.mockRejectedValueOnce(conflictError)
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockExistingSession)

            // Act
            const result = await sessionService.ensureRecordingSession('測試標題')

            // Assert
            expect(result).toEqual(mockExistingSession)
            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: '測試標題',
                type: 'recording',
                content: undefined
            })
            expect(mockSessionAPI.getActiveSession).toHaveBeenCalledOnce()
        })

        test('當遇到 409 但現有會話是筆記會話時，應該升級為錄音會話', async () => {
            // Arrange
            const conflictError = {
                response: { status: 409 },
                isAxiosError: true
            }

            const upgradedSession: SessionResponse = {
                ...mockNoteSession,
                type: 'recording'
            }

            mockSessionAPI.createSession.mockRejectedValueOnce(conflictError)
            // 第一次調用 - ensureRecordingSession 中檢查現有會話
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockNoteSession)
            // 第二次調用 - upgradeToRecording 中檢查會話狀態
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockNoteSession)
            mockSessionAPI.upgradeToRecording.mockResolvedValueOnce(upgradedSession)

            // Act
            const result = await sessionService.ensureRecordingSession('測試標題')

            // Assert
            expect(result).toEqual(upgradedSession)
            expect(mockSessionAPI.createSession).toHaveBeenCalled()
            expect(mockSessionAPI.getActiveSession).toHaveBeenCalledTimes(2)
            expect(mockSessionAPI.upgradeToRecording).toHaveBeenCalledWith(mockNoteSession.id)
        })

        test('當遇到 409 但無法獲取現有會話時，應該拋出錯誤', async () => {
            // Arrange
            const conflictError = {
                response: { status: 409 },
                isAxiosError: true
            }

            mockSessionAPI.createSession.mockRejectedValueOnce(conflictError)
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(null)

            // Act & Assert
            await expect(
                sessionService.ensureRecordingSession('測試標題')
            ).rejects.toThrow('會話衝突但無法獲取現有活躍會話，請重新整理頁面')

            expect(mockSessionAPI.createSession).toHaveBeenCalled()
            expect(mockSessionAPI.getActiveSession).toHaveBeenCalledOnce()
        })

        test('當遇到非 409 錯誤時，應該直接拋出原錯誤', async () => {
            // Arrange
            const networkError = new Error('網路連接失敗')
            mockSessionAPI.createSession.mockRejectedValueOnce(networkError)

            // Act & Assert
            await expect(
                sessionService.ensureRecordingSession('測試標題')
            ).rejects.toThrow()

            expect(mockSessionAPI.createSession).toHaveBeenCalled()
            expect(mockSessionAPI.getActiveSession).not.toHaveBeenCalled()
        })
    })

    describe('ensureRecordingSession - 邊緣情況', () => {
        test('當標題為空時，應該使用預設標題', async () => {
            // Arrange
            mockSessionAPI.createSession.mockResolvedValueOnce(mockNewSession)

            // Act
            const result = await sessionService.ensureRecordingSession()

            // Assert
            expect(result).toEqual(mockNewSession)
            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: expect.stringMatching(/錄音筆記 \d{1,2}\/\d{1,2}\/\d{4}/),
                type: 'recording',
                content: undefined
            })
        })

        test('當提供內容時，應該正確傳遞給 API', async () => {
            // Arrange
            mockSessionAPI.createSession.mockResolvedValueOnce(mockNewSession)

            // Act
            const result = await sessionService.ensureRecordingSession('測試標題', '測試內容')

            // Assert
            expect(result).toEqual(mockNewSession)
            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: '測試標題',
                type: 'recording',
                content: '測試內容'
            })
        })
    })

    describe('ensureRecordingSession - 整合流程測試', () => {
        test('完整的 409 衝突處理流程：創建失敗 → 獲取現有會話 → 升級會話', async () => {
            // Arrange
            const conflictError = {
                response: { status: 409 },
                isAxiosError: true
            }

            const upgradedSession: SessionResponse = {
                ...mockNoteSession,
                type: 'recording'
            }

            mockSessionAPI.createSession.mockRejectedValueOnce(conflictError)
            // 第一次調用 - ensureRecordingSession 中檢查現有會話
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockNoteSession)
            // 第二次調用 - upgradeToRecording 中檢查會話狀態
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockNoteSession)
            mockSessionAPI.upgradeToRecording.mockResolvedValueOnce(upgradedSession)

            // Act
            const result = await sessionService.ensureRecordingSession('整合測試')

            // Assert - 驗證調用順序和參數
            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: '整合測試',
                type: 'recording',
                content: undefined
            })
            expect(mockSessionAPI.getActiveSession).toHaveBeenCalledAfter(
                mockSessionAPI.createSession as any
            )
            expect(mockSessionAPI.upgradeToRecording).toHaveBeenCalledWith(mockNoteSession.id)
            expect(result).toEqual(upgradedSession)
        })

        test('優雅的錯誤恢復：API 調用順序正確且錯誤處理適當', async () => {
            // Arrange
            const conflictError = {
                response: { status: 409 },
                isAxiosError: true
            }

            mockSessionAPI.createSession.mockRejectedValueOnce(conflictError)
            mockSessionAPI.getActiveSession.mockResolvedValueOnce(mockExistingSession)

            // Act
            const result = await sessionService.ensureRecordingSession('錯誤恢復測試')

            // Assert - 驗證最終結果正確
            expect(result).toEqual(mockExistingSession)
            expect(result.type).toBe('recording')
            expect(result.status).toBe('active')

            // 驗證不需要升級（因為現有會話已經是錄音會話）
            expect(mockSessionAPI.upgradeToRecording).not.toHaveBeenCalled()
        })
    })
})
