import { beforeEach, describe, expect, test, vi } from 'vitest'
import { InitialStateLoader } from '../initial-state-loader'
import type { AppData } from '../../types/app-state'

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
}

// 在測試環境中設置 localStorage mock
Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
})

describe('InitialStateLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorageMock.getItem.mockReturnValue(null)
    })

    describe('loadInitialAppData', () => {
        test('應該返回預設狀態當沒有持久化資料時', () => {
            const result = InitialStateLoader.loadInitialAppData()

            expect(result).toEqual({
                state: 'default',
                transcriptEntries: [],
                editorContent: '',
                isRecording: false,
                recordingTime: 0,
                session: null,
            })
        })

        test('應該載入草稿筆記內容', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'draft_note') return '測試草稿內容'
                return null
            })

            const result = InitialStateLoader.loadInitialAppData()

            expect(result.editorContent).toBe('測試草稿內容')
            expect(localStorageMock.getItem).toHaveBeenCalledWith('draft_note')
        })

        test('應該載入上次會話資訊', () => {
            const mockSession = {
                id: 'test-session-id',
                status: 'active',
                type: 'recording'
            }

            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'last_session') return JSON.stringify(mockSession)
                return null
            })

            const result = InitialStateLoader.loadInitialAppData()

            expect(result.session).toEqual(mockSession)
            expect(localStorageMock.getItem).toHaveBeenCalledWith('last_session')
        })

        test('應該忽略已完成的會話', () => {
            const completedSession = {
                id: 'test-session-id',
                status: 'completed',
                type: 'recording'
            }

            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'last_session') return JSON.stringify(completedSession)
                return null
            })

            const result = InitialStateLoader.loadInitialAppData()

            expect(result.session).toBeNull()
        })

        test('應該載入完整的應用狀態', () => {
            const mockAppState = {
                state: 'recording_active',
                transcriptEntries: [
                    { time: '00:01', text: '測試逐字稿' }
                ]
            }

            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'app_state_v1') return JSON.stringify(mockAppState)
                return null
            })

            const result = InitialStateLoader.loadInitialAppData()

            expect(result.state).toBe('recording_active')
            expect(result.transcriptEntries).toEqual(mockAppState.transcriptEntries)
        })

        test('應該處理無效的 JSON 資料', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'last_session') return 'invalid json'
                return null
            })

            const result = InitialStateLoader.loadInitialAppData()

            // 應該返回預設狀態而不是拋出錯誤
            expect(result.session).toBeNull()
        })
    })

    describe('saveAppState', () => {
        test('應該儲存應用狀態到 localStorage', () => {
            const mockAppData: AppData = {
                state: 'recording_active',
                transcriptEntries: [{ time: '00:01', text: '測試' }],
                editorContent: '測試內容',
                isRecording: true,
                recordingTime: 30,
                session: {
                    id: 'test-session',
                    status: 'active',
                    type: 'recording'
                }
            }

            InitialStateLoader.saveAppState(mockAppData)

            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'app_state_v1',
                JSON.stringify({
                    state: 'recording_active',
                    transcriptEntries: [{ time: '00:01', text: '測試' }]
                })
            )

            expect(localStorageMock.setItem).toHaveBeenCalledWith(
                'last_session',
                JSON.stringify(mockAppData.session)
            )
        })

        test('應該移除會話資訊當 session 為 null', () => {
            const mockAppData: AppData = {
                state: 'default',
                transcriptEntries: [],
                editorContent: '',
                isRecording: false,
                recordingTime: 0,
                session: null
            }

            InitialStateLoader.saveAppState(mockAppData)

            expect(localStorageMock.removeItem).toHaveBeenCalledWith('last_session')
        })
    })

    describe('clearPersistedState', () => {
        test('應該清除持久化狀態', () => {
            InitialStateLoader.clearPersistedState()

            expect(localStorageMock.removeItem).toHaveBeenCalledWith('app_state_v1')
            expect(localStorageMock.removeItem).toHaveBeenCalledWith('last_session')
            // 不應該清除 draft_note
            expect(localStorageMock.removeItem).not.toHaveBeenCalledWith('draft_note')
        })
    })

    describe('hasPersistedState', () => {
        test('當有持久化狀態時應該返回 true', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'app_state_v1') return '{"state":"default"}'
                return null
            })

            expect(InitialStateLoader.hasPersistedState()).toBe(true)
        })

        test('當沒有持久化狀態時應該返回 false', () => {
            expect(InitialStateLoader.hasPersistedState()).toBe(false)
        })

        test('當有會話資訊時應該返回 true', () => {
            localStorageMock.getItem.mockImplementation((key) => {
                if (key === 'last_session') return '{"id":"test"}'
                return null
            })

            expect(InitialStateLoader.hasPersistedState()).toBe(true)
        })
    })
})
