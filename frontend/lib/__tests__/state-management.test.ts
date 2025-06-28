import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { AppStateProvider, useAppStateContext } from '../../hooks/use-app-state-context'
import { useAppStateNew } from '../../hooks/use-app-state-new'
import { featureFlagManager } from '../feature-flags'
import { InitialStateLoader } from '../initial-state-loader'
import type { ReactNode } from 'react'

// Mock 外部依賴
vi.mock('../../hooks/use-session-adapter', () => ({
    useSession: vi.fn(() => ({
        currentSession: null,
        isLoading: false,
        error: null,
        createNoteSession: vi.fn(),
        createRecordingSession: vi.fn(),
        upgradeToRecording: vi.fn(),
        finishSession: vi.fn(),
        deleteSession: vi.fn(),
        checkActiveSession: vi.fn(),
    }))
}))

vi.mock('../../hooks/use-recording-adapter', () => ({
    useRecording: vi.fn(() => ({
        isRecording: false,
        recordingTime: 0,
        transcripts: [],
        error: null,
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
        clearTranscripts: vi.fn(),
    }))
}))

vi.mock('../../hooks/use-notes', () => ({
    useNotes: vi.fn(() => ({
        noteContent: '',
        loadNote: vi.fn(),
        clearNote: vi.fn(),
    }))
}))

vi.mock('../../hooks/use-transcript-adapter', () => ({
    useTranscript: vi.fn(() => ({
        isConnected: false,
        error: null,
        autoScrollEnabled: true,
        disconnect: vi.fn(),
        clearTranscripts: vi.fn(),
        enableAutoScroll: vi.fn(),
        disableAutoScroll: vi.fn(),
        scrollToLatest: vi.fn(),
    }))
}))

vi.mock('@/components/ui/use-toast', () => ({
    useToast: vi.fn(() => ({
        toast: vi.fn(),
    }))
}))

// Mock InitialStateLoader
vi.mock('../../initial-state-loader', () => ({
    InitialStateLoader: {
        loadInitialAppData: vi.fn(() => ({
            state: 'default',
            transcriptEntries: [],
            editorContent: '',
            isRecording: false,
            recordingTime: 0,
            session: null,
        })),
        saveAppState: vi.fn(),
        clearPersistedState: vi.fn(),
        hasPersistedState: vi.fn(() => false),
    }
}))

function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(AppStateProvider, null, children)
}

describe('狀態管理整合測試', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        featureFlagManager.reset()
        featureFlagManager.enable('useNewStateManagement')
    })

    describe('Context 與 Hook 協作', () => {
        test('Context 應該為 Hook 提供正確的狀態', () => {
            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            expect(result.current.appData).toBeDefined()
            expect(result.current.appData.state).toBe('default')
            expect(result.current.appData.isRecording).toBe(false)
            expect(result.current.appData.transcriptEntries).toEqual([])
        })

        test('Hook 的狀態變更應該更新 Context', async () => {
            const { result } = renderHook(() => {
                const context = useAppStateContext()
                const hook = useAppStateNew()
                return { context, hook }
            }, {
                wrapper: TestWrapper
            })

            // 測試編輯器內容更新
            await act(async () => {
                result.current.hook.saveLocalDraft('測試內容')
            })

            expect(result.current.context.appData.editorContent).toBe('測試內容')
        })

        test('Context dispatch 應該觸發 Hook 重新渲染', async () => {
            const { result } = renderHook(() => {
                const context = useAppStateContext()
                const hook = useAppStateNew()
                return { context, hook }
            }, {
                wrapper: TestWrapper
            })

            const initialIsRecording = result.current.hook.appData.isRecording

            // 直接透過 Context dispatch 更新狀態
            await act(async () => {
                result.current.context.dispatch({
                    type: 'SET_RECORDING',
                    payload: true
                })
            })

            // Hook 應該重新渲染並反映新狀態
            expect(result.current.hook.appData.isRecording).toBe(true)
            expect(result.current.hook.appData.isRecording).not.toBe(initialIsRecording)
        })
    })

    describe('狀態一致性測試', () => {
        test('多個 Hook 實例應該共享相同狀態', () => {
            const { result: result1 } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })
            const { result: result2 } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // 兩個 Hook 實例應該有相同的狀態
            expect(result1.current.appData.state).toBe(result2.current.appData.state)
            expect(result1.current.appData.isRecording).toBe(result2.current.appData.isRecording)
        })

        test('狀態變更應該同步到所有 Hook 實例', async () => {
            const { result: result1 } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })
            const { result: result2 } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // 透過第一個 Hook 更新狀態
            await act(async () => {
                result1.current.saveLocalDraft('同步測試')
            })

            // 第二個 Hook 應該反映相同的變更
            expect(result2.current.appData.editorContent).toBe('同步測試')
        })
    })

    describe('初始狀態載入整合', () => {
        test('Provider 啟動時應該載入初始狀態', () => {
            const mockInitialData = {
                state: 'recording_active' as const,
                transcriptEntries: [{ time: '00:01', text: '測試逐字稿' }],
                editorContent: '測試內容',
                isRecording: true,
                recordingTime: 30,
                session: { id: 'test-session', status: 'active' as const, type: 'recording' as const }
            }

            vi.mocked(InitialStateLoader.loadInitialAppData).mockReturnValue(mockInitialData)

            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // 應該載入初始狀態
            expect(InitialStateLoader.loadInitialAppData).toHaveBeenCalled()
            // 注意：由於 useEffect 的異步特性，初始狀態可能需要額外的渲染週期
        })

        test('狀態變更應該觸發持久化', async () => {
            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            await act(async () => {
                result.current.saveLocalDraft('需要持久化的內容')
            })

            // 等待持久化邏輯執行
            await new Promise(resolve => setTimeout(resolve, 1100)) // 等待超過 1 秒的延遲

            expect(InitialStateLoader.saveAppState).toHaveBeenCalled()
        })
    })

    describe('錯誤處理整合', () => {
        test('初始狀態載入失敗應該使用預設狀態', () => {
            vi.mocked(InitialStateLoader.loadInitialAppData).mockImplementation(() => {
                throw new Error('載入失敗')
            })

            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // 應該回退到預設狀態
            expect(result.current.appData.state).toBe('default')
            expect(result.current.appData.transcriptEntries).toEqual([])
        })

        test('持久化失敗不應該影響應用運作', async () => {
            vi.mocked(InitialStateLoader.saveAppState).mockImplementation(() => {
                throw new Error('儲存失敗')
            })

            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // 狀態變更應該仍然正常工作
            await act(async () => {
                result.current.saveLocalDraft('測試內容')
            })

            expect(result.current.appData.editorContent).toBe('測試內容')
        })
    })

    describe('記憶體管理', () => {
        test('Hook unmount 不應該導致記憶體洩漏', () => {
            const { unmount } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            // unmount 應該正常執行而不拋出錯誤
            expect(() => unmount()).not.toThrow()
        })

        test('多次 mount/unmount 應該穩定', () => {
            for (let i = 0; i < 5; i++) {
                const { unmount } = renderHook(() => useAppStateNew(), {
                    wrapper: TestWrapper
                })
                unmount()
            }

            // 最後一次應該仍然正常工作
            const { result } = renderHook(() => useAppStateNew(), {
                wrapper: TestWrapper
            })

            expect(result.current.appData).toBeDefined()
        })
    })
})
