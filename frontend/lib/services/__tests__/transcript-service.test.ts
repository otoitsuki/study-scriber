"use client"

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TranscriptService } from '../transcript-service'
import { transcriptManager } from '../../transcript-manager'
import type { TranscriptMessage } from '../interfaces'

// Mock transcriptManager
const mockTranscriptManager = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    isConnected: vi.fn(),
    getCurrentTranscripts: vi.fn(),
    clearTranscripts: vi.fn(),
    getConnectionCount: vi.fn(),
}

vi.mock('../../transcript-manager', () => ({
    transcriptManager: mockTranscriptManager
}))

describe('TranscriptService', () => {
    let transcriptService: TranscriptService

    beforeEach(() => {
        transcriptService = new TranscriptService()
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    describe('服務初始化', () => {
        it('應該正確初始化 TranscriptService', () => {
            expect(transcriptService).toBeDefined()
            expect(transcriptService['serviceName']).toBe('TranscriptService')
        })

        it('應該正確啟動和停止服務', async () => {
            await transcriptService.start()
            expect(transcriptService['isRunning']).toBe(true)

            await transcriptService.stop()
            expect(transcriptService['isRunning']).toBe(false)
        })
    })

    describe('connect', () => {
        const sessionId = 'test-session-id'

        it('應該成功連接逐字稿服務', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            await transcriptService.connect(sessionId)

            expect(mockTranscriptManager.connect).toHaveBeenCalledWith(sessionId)
            expect(transcriptService['connectedSessions'].has(sessionId)).toBe(true)
        })

        it('應該處理連接失敗', async () => {
            const connectError = new Error('Connection failed')
            mockTranscriptManager.connect.mockRejectedValue(connectError)

            await expect(transcriptService.connect(sessionId))
                .rejects.toThrow('Connection failed')

            expect(transcriptService['connectedSessions'].has(sessionId)).toBe(false)
        })

        it('應該處理重複連接請求', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            // 首次連接
            await transcriptService.connect(sessionId)

            // 重複連接（應該被忽略）
            await transcriptService.connect(sessionId)

            expect(mockTranscriptManager.connect).toHaveBeenCalledTimes(1)
        })

        it('應該支援多個會話同時連接', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            await transcriptService.connect('session-1')
            await transcriptService.connect('session-2')

            expect(transcriptService['connectedSessions'].has('session-1')).toBe(true)
            expect(transcriptService['connectedSessions'].has('session-2')).toBe(true)
            expect(mockTranscriptManager.connect).toHaveBeenCalledTimes(2)
        })
    })

    describe('disconnect', () => {
        const sessionId = 'test-session-id'

        beforeEach(async () => {
            // Setup connected state
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            await transcriptService.connect(sessionId)
        })

        it('應該成功斷開特定會話', async () => {
            mockTranscriptManager.disconnect.mockResolvedValue(undefined)

            await transcriptService.disconnect(sessionId)

            expect(mockTranscriptManager.disconnect).toHaveBeenCalledWith(sessionId)
            expect(transcriptService['connectedSessions'].has(sessionId)).toBe(false)
        })

        it('應該斷開所有會話（當不指定 sessionId 時）', async () => {
            // 連接多個會話
            await transcriptService.connect('session-2')
            mockTranscriptManager.disconnect.mockResolvedValue(undefined)

            await transcriptService.disconnect()

            expect(mockTranscriptManager.disconnect).toHaveBeenCalledTimes(2)
            expect(transcriptService['connectedSessions'].size).toBe(0)
        })

        it('應該清理對應的監聽器', async () => {
            const callback = vi.fn()

            // 添加監聽器
            transcriptService.addTranscriptListener(sessionId, callback)

            mockTranscriptManager.disconnect.mockResolvedValue(undefined)
            await transcriptService.disconnect(sessionId)

            expect(mockTranscriptManager.removeListener).toHaveBeenCalledWith(sessionId, callback)
            expect(transcriptService['sessionListeners'].has(sessionId)).toBe(false)
        })

        it('應該處理斷開不存在的會話', async () => {
            await expect(transcriptService.disconnect('non-existent'))
                .resolves.not.toThrow()
        })

        it('應該處理斷開失敗', async () => {
            const disconnectError = new Error('Disconnect failed')
            mockTranscriptManager.disconnect.mockRejectedValue(disconnectError)

            await expect(transcriptService.disconnect(sessionId))
                .rejects.toThrow('Disconnect failed')
        })
    })

    describe('addTranscriptListener', () => {
        const sessionId = 'test-session-id'
        const callback = vi.fn()

        it('應該成功添加逐字稿監聽器', () => {
            transcriptService.addTranscriptListener(sessionId, callback)

            expect(mockTranscriptManager.addListener).toHaveBeenCalledWith(sessionId, callback)
            expect(transcriptService['sessionListeners'].get(sessionId)?.has(callback)).toBe(true)
        })

        it('應該支援同一會話多個監聽器', () => {
            const callback2 = vi.fn()

            transcriptService.addTranscriptListener(sessionId, callback)
            transcriptService.addTranscriptListener(sessionId, callback2)

            const listeners = transcriptService['sessionListeners'].get(sessionId)
            expect(listeners?.has(callback)).toBe(true)
            expect(listeners?.has(callback2)).toBe(true)
            expect(listeners?.size).toBe(2)
        })

        it('應該防止重複添加相同監聽器', () => {
            transcriptService.addTranscriptListener(sessionId, callback)
            transcriptService.addTranscriptListener(sessionId, callback)

            expect(mockTranscriptManager.addListener).toHaveBeenCalledTimes(1)
            expect(transcriptService['sessionListeners'].get(sessionId)?.size).toBe(1)
        })

        it('應該處理不同會話的監聽器', () => {
            const callback2 = vi.fn()

            transcriptService.addTranscriptListener('session-1', callback)
            transcriptService.addTranscriptListener('session-2', callback2)

            expect(transcriptService['sessionListeners'].get('session-1')?.has(callback)).toBe(true)
            expect(transcriptService['sessionListeners'].get('session-2')?.has(callback2)).toBe(true)
        })
    })

    describe('removeTranscriptListener', () => {
        const sessionId = 'test-session-id'
        const callback = vi.fn()

        beforeEach(() => {
            transcriptService.addTranscriptListener(sessionId, callback)
        })

        it('應該成功移除逐字稿監聽器', () => {
            transcriptService.removeTranscriptListener(sessionId, callback)

            expect(mockTranscriptManager.removeListener).toHaveBeenCalledWith(sessionId, callback)
            expect(transcriptService['sessionListeners'].get(sessionId)?.has(callback)).toBe(false)
        })

        it('應該處理移除不存在的監聽器', () => {
            const nonExistentCallback = vi.fn()

            expect(() => transcriptService.removeTranscriptListener(sessionId, nonExistentCallback))
                .not.toThrow()
        })

        it('應該處理移除不存在會話的監聽器', () => {
            expect(() => transcriptService.removeTranscriptListener('non-existent', callback))
                .not.toThrow()
        })

        it('應該在移除最後一個監聽器時清理會話記錄', () => {
            transcriptService.removeTranscriptListener(sessionId, callback)

            expect(transcriptService['sessionListeners'].has(sessionId)).toBe(false)
        })
    })

    describe('isConnected', () => {
        const sessionId = 'test-session-id'

        it('應該報告正確的連接狀態', async () => {
            expect(transcriptService.isConnected(sessionId)).toBe(false)

            mockTranscriptManager.connect.mockResolvedValue(undefined)
            await transcriptService.connect(sessionId)

            expect(transcriptService.isConnected(sessionId)).toBe(true)

            mockTranscriptManager.disconnect.mockResolvedValue(undefined)
            await transcriptService.disconnect(sessionId)

            expect(transcriptService.isConnected(sessionId)).toBe(false)
        })

        it('應該處理不存在的會話', () => {
            expect(transcriptService.isConnected('non-existent')).toBe(false)
        })
    })

    describe('逐字稿數據處理', () => {
        const sessionId = 'test-session-id'
        const mockTranscript: TranscriptMessage = {
            id: 'transcript-1',
            text: 'Hello world',
            timestamp: '2024-01-01T00:00:00Z',
            confidence: 0.95,
            isPartial: false,
            sessionId
        }

        it('應該正確處理逐字稿訊息', () => {
            const callback = vi.fn()
            transcriptService.addTranscriptListener(sessionId, callback)

            // 模擬收到逐字稿訊息
            const listenerCall = mockTranscriptManager.addListener.mock.calls.find(
                call => call[0] === sessionId
            )
            const transcriptCallback = listenerCall?.[1]

            if (transcriptCallback) {
                transcriptCallback(mockTranscript)
            }

            expect(callback).toHaveBeenCalledWith(mockTranscript)
        })

        it('應該處理部分逐字稿', () => {
            const callback = vi.fn()
            const partialTranscript: TranscriptMessage = {
                ...mockTranscript,
                text: 'Hello wor...',
                isPartial: true,
                confidence: 0.7
            }

            transcriptService.addTranscriptListener(sessionId, callback)

            // 模擬收到部分逐字稿
            const listenerCall = mockTranscriptManager.addListener.mock.calls.find(
                call => call[0] === sessionId
            )
            const transcriptCallback = listenerCall?.[1]

            if (transcriptCallback) {
                transcriptCallback(partialTranscript)
            }

            expect(callback).toHaveBeenCalledWith(partialTranscript)
        })

        it('應該支援多個監聽器同時接收訊息', () => {
            const callback1 = vi.fn()
            const callback2 = vi.fn()

            transcriptService.addTranscriptListener(sessionId, callback1)
            transcriptService.addTranscriptListener(sessionId, callback2)

            // 模擬收到逐字稿訊息
            const listenerCalls = mockTranscriptManager.addListener.mock.calls.filter(
                call => call[0] === sessionId
            )

            listenerCalls.forEach(call => {
                const transcriptCallback = call[1]
                if (transcriptCallback) {
                    transcriptCallback(mockTranscript)
                }
            })

            expect(callback1).toHaveBeenCalledWith(mockTranscript)
            expect(callback2).toHaveBeenCalledWith(mockTranscript)
        })
    })

    describe('錯誤處理', () => {
        const sessionId = 'test-session-id'

        it('應該處理 TranscriptManager 連接錯誤', async () => {
            const connectionError = new Error('WebSocket connection failed')
            mockTranscriptManager.connect.mockRejectedValue(connectionError)

            await expect(transcriptService.connect(sessionId))
                .rejects.toThrow('WebSocket connection failed')

            expect(transcriptService.isConnected(sessionId)).toBe(false)
        })

        it('應該處理 TranscriptManager 斷開錯誤', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            await transcriptService.connect(sessionId)

            const disconnectError = new Error('Disconnect failed')
            mockTranscriptManager.disconnect.mockRejectedValue(disconnectError)

            await expect(transcriptService.disconnect(sessionId))
                .rejects.toThrow('Disconnect failed')
        })

        it('應該在連接失敗時清理狀態', async () => {
            const connectionError = new Error('Connection failed')
            mockTranscriptManager.connect.mockRejectedValue(connectionError)

            try {
                await transcriptService.connect(sessionId)
            } catch {
                // 預期的錯誤
            }

            expect(transcriptService['connectedSessions'].has(sessionId)).toBe(false)
        })
    })

    describe('並發場景測試', () => {
        it('應該處理並發連接請求', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            const promises = [
                transcriptService.connect('session-1'),
                transcriptService.connect('session-2'),
                transcriptService.connect('session-3')
            ]

            await Promise.all(promises)

            expect(transcriptService['connectedSessions'].size).toBe(3)
            expect(mockTranscriptManager.connect).toHaveBeenCalledTimes(3)
        })

        it('應該處理並發的連接和斷開操作', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.disconnect.mockResolvedValue(undefined)

            // 連接會話
            await transcriptService.connect('session-1')

            const promises = [
                transcriptService.connect('session-2'),
                transcriptService.disconnect('session-1'),
                transcriptService.connect('session-3')
            ]

            await Promise.all(promises)

            expect(transcriptService['connectedSessions'].has('session-1')).toBe(false)
            expect(transcriptService['connectedSessions'].has('session-2')).toBe(true)
            expect(transcriptService['connectedSessions'].has('session-3')).toBe(true)
        })

        it('應該處理快速的添加和移除監聽器操作', () => {
            const callbacks = Array.from({ length: 5 }, () => vi.fn())
            const sessionId = 'test-session'

            // 快速添加多個監聽器
            callbacks.forEach(callback => {
                transcriptService.addTranscriptListener(sessionId, callback)
            })

            expect(transcriptService['sessionListeners'].get(sessionId)?.size).toBe(5)

            // 快速移除監聽器
            callbacks.forEach(callback => {
                transcriptService.removeTranscriptListener(sessionId, callback)
            })

            expect(transcriptService['sessionListeners'].has(sessionId)).toBe(false)
        })
    })

    describe('資源清理', () => {
        it('應該在服務停止時清理所有資源', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            mockTranscriptManager.disconnect.mockResolvedValue(undefined)

            // 連接多個會話
            await transcriptService.connect('session-1')
            await transcriptService.connect('session-2')

            // 添加監聽器
            const callback1 = vi.fn()
            const callback2 = vi.fn()
            transcriptService.addTranscriptListener('session-1', callback1)
            transcriptService.addTranscriptListener('session-2', callback2)

            // 停止服務
            await transcriptService.stop()

            // 驗證資源清理
            expect(transcriptService['connectedSessions'].size).toBe(0)
            expect(transcriptService['sessionListeners'].size).toBe(0)
        })

        it('應該處理清理過程中的錯誤', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)
            await transcriptService.connect('session-1')

            // 模擬斷開時發生錯誤
            mockTranscriptManager.disconnect.mockRejectedValue(new Error('Cleanup error'))

            // 服務停止應該不會拋出錯誤
            await expect(transcriptService.stop()).resolves.not.toThrow()
        })
    })

    describe('服務狀態報告', () => {
        it('應該報告正確的服務資訊', () => {
            const info = transcriptService.getServiceInfo()

            expect(info).toMatchObject({
                serviceName: 'TranscriptService',
                isInitialized: expect.any(Boolean),
                isRunning: expect.any(Boolean),
                connectedSessions: expect.any(Array),
                activeListeners: expect.any(Object),
                totalConnections: expect.any(Number)
            })
        })

        it('應該正確報告連接數量', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            await transcriptService.connect('session-1')
            await transcriptService.connect('session-2')

            const info = transcriptService.getServiceInfo()

            expect(info.connectedSessions).toHaveLength(2)
            expect(info.totalConnections).toBe(2)
        })

        it('應該正確報告監聽器數量', () => {
            const callback1 = vi.fn()
            const callback2 = vi.fn()

            transcriptService.addTranscriptListener('session-1', callback1)
            transcriptService.addTranscriptListener('session-1', callback2)
            transcriptService.addTranscriptListener('session-2', callback1)

            const info = transcriptService.getServiceInfo()

            expect(info.activeListeners['session-1']).toBe(2)
            expect(info.activeListeners['session-2']).toBe(1)
        })
    })

    describe('邊界條件測試', () => {
        it('應該處理空字符串會話 ID', async () => {
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            await expect(transcriptService.connect('')).resolves.not.toThrow()
            expect(transcriptService.isConnected('')).toBe(true)
        })

        it('應該處理特殊字符的會話 ID', async () => {
            const specialSessionId = 'session-123!@#$%^&*()'
            mockTranscriptManager.connect.mockResolvedValue(undefined)

            await transcriptService.connect(specialSessionId)
            expect(transcriptService.isConnected(specialSessionId)).toBe(true)
        })

        it('應該處理 null/undefined 回調函數', () => {
            expect(() => transcriptService.addTranscriptListener('session', null as any))
                .not.toThrow()

            expect(() => transcriptService.addTranscriptListener('session', undefined as any))
                .not.toThrow()
        })
    })
})
