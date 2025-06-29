"use client"

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionService } from '../session-service'
import { sessionAPI } from '../../api'
import type { SessionResponse } from '../../api'

// Mock sessionAPI
vi.mock('../../api', () => ({
    sessionAPI: {
        createSession: vi.fn(),
        upgradeToRecording: vi.fn(),
        finishSession: vi.fn(),
        deleteSession: vi.fn(),
        getActiveSession: vi.fn(),
    }
}))

describe('SessionService', () => {
    let sessionService: SessionService
    const mockSessionAPI = sessionAPI as any

    beforeEach(() => {
        sessionService = new SessionService()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('服務初始化', () => {
        it('應該正確初始化 SessionService', () => {
            expect(sessionService).toBeDefined()
            expect(sessionService['serviceName']).toBe('SessionService')
        })

        it('應該正確啟動和停止服務', async () => {
            await sessionService.start()
            expect(sessionService['isRunning']).toBe(true)

            await sessionService.stop()
            expect(sessionService['isRunning']).toBe(false)
        })
    })

    describe('createRecordingSession', () => {
        const mockSession: SessionResponse = {
            id: 'test-session-id',
            title: 'Test Recording Session',
            type: 'recording',
            status: 'active',
            language: 'zh-TW',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        it('應該成功創建錄音會話', async () => {
            mockSessionAPI.createSession.mockResolvedValue(mockSession)

            const result = await sessionService.createRecordingSession('Test Title', 'Test Content')

            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: 'Test Title',
                type: 'recording',
                content: 'Test Content'
            })
            expect(result).toEqual(mockSession)
        })

        it('應該處理可選內容參數', async () => {
            mockSessionAPI.createSession.mockResolvedValue(mockSession)

            await sessionService.createRecordingSession('Test Title')

            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: 'Test Title',
                type: 'recording',
                content: undefined
            })
        })

        it('應該處理 API 錯誤', async () => {
            const apiError = new Error('API Error')
            mockSessionAPI.createSession.mockRejectedValue(apiError)

            await expect(sessionService.createRecordingSession('Test Title'))
                .rejects.toThrow('API Error')
        })

        it('應該處理 409 衝突錯誤', async () => {
            const conflictError = new Error('409 Conflict')
            conflictError.message = '409'
            mockSessionAPI.createSession.mockRejectedValue(conflictError)

            await expect(sessionService.createRecordingSession('Test Title'))
                .rejects.toThrow('409')
        })
    })

    describe('createNoteSession', () => {
        const mockSession: SessionResponse = {
            id: 'test-note-session',
            title: 'Test Note Session',
            type: 'note_only',
            status: 'active',
            language: 'zh-TW',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        it('應該成功創建純筆記會話', async () => {
            mockSessionAPI.createSession.mockResolvedValue(mockSession)

            const result = await sessionService.createNoteSession('Note Title', 'Note Content')

            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: 'Note Title',
                type: 'note_only',
                content: 'Note Content'
            })
            expect(result).toEqual(mockSession)
        })

        it('應該處理可選內容參數', async () => {
            mockSessionAPI.createSession.mockResolvedValue(mockSession)

            await sessionService.createNoteSession('Note Title')

            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: 'Note Title',
                type: 'note_only',
                content: undefined
            })
        })
    })

    describe('upgradeToRecording', () => {
        const mockUpgradedSession: SessionResponse = {
            id: 'upgraded-session',
            title: 'Upgraded Session',
            type: 'recording',
            status: 'active',
            language: 'zh-TW',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        it('應該成功升級會話至錄音模式', async () => {
            mockSessionAPI.upgradeToRecording.mockResolvedValue(mockUpgradedSession)

            const result = await sessionService.upgradeToRecording('session-id')

            expect(mockSessionAPI.upgradeToRecording).toHaveBeenCalledWith('session-id')
            expect(result).toEqual(mockUpgradedSession)
        })

        it('應該處理升級失敗', async () => {
            const upgradeError = new Error('Upgrade failed')
            mockSessionAPI.upgradeToRecording.mockRejectedValue(upgradeError)

            await expect(sessionService.upgradeToRecording('session-id'))
                .rejects.toThrow('Upgrade failed')
        })
    })

    describe('finishSession', () => {
        it('應該成功完成會話', async () => {
            mockSessionAPI.finishSession.mockResolvedValue(undefined)

            await sessionService.finishSession('session-id')

            expect(mockSessionAPI.finishSession).toHaveBeenCalledWith('session-id')
        })

        it('應該處理完成會話失敗', async () => {
            const finishError = new Error('Finish failed')
            mockSessionAPI.finishSession.mockRejectedValue(finishError)

            await expect(sessionService.finishSession('session-id'))
                .rejects.toThrow('Finish failed')
        })
    })

    describe('deleteSession', () => {
        it('應該成功刪除會話', async () => {
            mockSessionAPI.deleteSession.mockResolvedValue(undefined)

            await sessionService.deleteSession('session-id')

            expect(mockSessionAPI.deleteSession).toHaveBeenCalledWith('session-id')
        })

        it('應該處理刪除會話失敗', async () => {
            const deleteError = new Error('Delete failed')
            mockSessionAPI.deleteSession.mockRejectedValue(deleteError)

            await expect(sessionService.deleteSession('session-id'))
                .rejects.toThrow('Delete failed')
        })
    })

    describe('checkActiveSession', () => {
        const mockActiveSession: SessionResponse = {
            id: 'active-session',
            title: 'Active Session',
            type: 'recording',
            status: 'active',
            language: 'zh-TW',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        it('應該返回活躍會話', async () => {
            mockSessionAPI.getActiveSession.mockResolvedValue(mockActiveSession)

            const result = await sessionService.checkActiveSession()

            expect(mockSessionAPI.getActiveSession).toHaveBeenCalled()
            expect(result).toEqual(mockActiveSession)
        })

        it('應該在沒有活躍會話時返回 null', async () => {
            mockSessionAPI.getActiveSession.mockResolvedValue(null)

            const result = await sessionService.checkActiveSession()

            expect(result).toBeNull()
        })

        it('應該處理檢查活躍會話失敗', async () => {
            const checkError = new Error('Check failed')
            mockSessionAPI.getActiveSession.mockRejectedValue(checkError)

            await expect(sessionService.checkActiveSession())
                .rejects.toThrow('Check failed')
        })
    })

    describe('錯誤處理和邊界條件', () => {
        it('應該處理空字符串參數', async () => {
            mockSessionAPI.createSession.mockResolvedValue({
                id: 'test-session',
                title: '',
                type: 'recording',
                status: 'active',
                language: 'zh-TW',
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-01T00:00:00Z'
            })

            await sessionService.createRecordingSession('')

            expect(mockSessionAPI.createSession).toHaveBeenCalledWith({
                title: '',
                type: 'recording',
                content: undefined
            })
        })

        it('應該處理網路錯誤', async () => {
            const networkError = new Error('Network Error')
            mockSessionAPI.createSession.mockRejectedValue(networkError)

            await expect(sessionService.createRecordingSession('Test'))
                .rejects.toThrow('Network Error')
        })

        it('應該處理超時錯誤', async () => {
            const timeoutError = new Error('Request timeout')
            mockSessionAPI.createSession.mockRejectedValue(timeoutError)

            await expect(sessionService.createRecordingSession('Test'))
                .rejects.toThrow('Request timeout')
        })
    })

    describe('並發場景測試', () => {
        it('應該處理並發的會話創建請求', async () => {
            const mockSession1 = { ...mockSessionAPI, id: 'session-1' }
            const mockSession2 = { ...mockSessionAPI, id: 'session-2' }

            mockSessionAPI.createSession
                .mockResolvedValueOnce(mockSession1)
                .mockResolvedValueOnce(mockSession2)

            const promises = [
                sessionService.createRecordingSession('Session 1'),
                sessionService.createRecordingSession('Session 2')
            ]

            const results = await Promise.all(promises)

            expect(results).toHaveLength(2)
            expect(mockSessionAPI.createSession).toHaveBeenCalledTimes(2)
        })

        it('應該處理一個成功一個失敗的並發請求', async () => {
            const mockSession = { id: 'success-session' }
            const error = new Error('Failed')

            mockSessionAPI.createSession
                .mockResolvedValueOnce(mockSession)
                .mockRejectedValueOnce(error)

            const promises = [
                sessionService.createRecordingSession('Success'),
                sessionService.createRecordingSession('Fail')
            ]

            const results = await Promise.allSettled(promises)

            expect(results[0].status).toBe('fulfilled')
            expect(results[1].status).toBe('rejected')
        })
    })

    describe('服務狀態管理', () => {
        it('應該報告正確的服務狀態', () => {
            const info = sessionService.getServiceInfo()

            expect(info).toMatchObject({
                serviceName: 'SessionService',
                isInitialized: expect.any(Boolean),
                isRunning: expect.any(Boolean)
            })
        })

        it('應該在多次啟動時保持穩定', async () => {
            await sessionService.start()
            await sessionService.start()
            await sessionService.start()

            expect(sessionService['isRunning']).toBe(true)
        })

        it('應該在多次停止時保持穩定', async () => {
            await sessionService.start()
            await sessionService.stop()
            await sessionService.stop()
            await sessionService.stop()

            expect(sessionService['isRunning']).toBe(false)
        })
    })
})
