import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { useAppStateNew } from '../use-app-state-new'
import { AppStateProvider } from '../use-app-state-context'
import type { ReactNode } from 'react'

// Mock 相關 hooks
vi.mock('../use-session-adapter', () => ({
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

vi.mock('../use-recording-adapter', () => ({
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

vi.mock('../use-notes', () => ({
    useNotes: vi.fn(() => ({
        noteContent: '',
        loadNote: vi.fn(),
        clearNote: vi.fn(),
    }))
}))

vi.mock('../use-transcript-adapter', () => ({
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

// 測試包裝器
function TestWrapper({ children }: { children: ReactNode }) {
    return createElement(AppStateProvider, null, children)
}

describe('useAppStateNew', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 清除 localStorage
        localStorage.clear()
    })

    test('應該正確初始化預設狀態', () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        expect(result.current.appData).toEqual({
            state: 'default',
            transcriptEntries: [],
            editorContent: '',
            isRecording: false,
            recordingTime: 0,
            session: null,
        })
        expect(result.current.isLoading).toBe(false)
        expect(result.current.error).toBe(null)
    })

    test('應該提供所有必要的方法', () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        // 檢查會話管理方法
        expect(typeof result.current.createNoteSession).toBe('function')
        expect(typeof result.current.createRecordingSession).toBe('function')
        expect(typeof result.current.upgradeToRecording).toBe('function')
        expect(typeof result.current.finishSession).toBe('function')
        expect(typeof result.current.newNote).toBe('function')

        // 檢查錄音控制方法
        expect(typeof result.current.startRecording).toBe('function')
        expect(typeof result.current.stopRecording).toBe('function')

        // 檢查本地草稿方法
        expect(typeof result.current.saveLocalDraft).toBe('function')

        // 檢查逐字稿方法
        expect(typeof result.current.enableAutoScroll).toBe('function')
        expect(typeof result.current.disableAutoScroll).toBe('function')
        expect(typeof result.current.scrollToLatest).toBe('function')
    })

    test('saveLocalDraft 應該更新編輯器內容', async () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        const testContent = '測試筆記內容'

        await act(async () => {
            result.current.saveLocalDraft(testContent)
        })

        expect(result.current.appData.editorContent).toBe(testContent)
    })

    test('saveLocalDraft 應該在沒有活躍會話時儲存到 localStorage', async () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        const testContent = '測試本地草稿'

        await act(async () => {
            result.current.saveLocalDraft(testContent)
        })

        expect(localStorage.getItem('draft_note')).toBe(testContent)
    })

    test('newNote 應該重置狀態並清除本地草稿', async () => {
        // 先設置一些初始內容
        localStorage.setItem('draft_note', '舊的草稿')

        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        // 先設置一些狀態
        await act(async () => {
            result.current.saveLocalDraft('一些內容')
        })

        // 執行 newNote
        await act(async () => {
            await result.current.newNote()
        })

        // 檢查狀態已重置
        expect(result.current.appData).toEqual({
            state: 'default',
            transcriptEntries: [],
            editorContent: '',
            isRecording: false,
            recordingTime: 0,
            session: null,
        })

        // 檢查本地草稿已清除
        expect(localStorage.getItem('draft_note')).toBe(null)
    })

    test('應該正確暴露外部狀態', () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        // 檢查外部狀態屬性存在
        expect(result.current.session).toBe(null)
        expect(result.current.sessionLoading).toBe(false)
        expect(result.current.sessionError).toBe(null)
        expect(result.current.recordingError).toBe(null)
        expect(result.current.transcriptConnected).toBe(false)
        expect(result.current.transcriptError).toBe(null)
        expect(result.current.transcriptAutoScroll).toBe(true)
    })

    test('應該使用 Context 管理狀態', async () => {
        const { result } = renderHook(() => useAppStateNew(), {
            wrapper: TestWrapper,
        })

        // 測試狀態更新通過 Context 進行
        const initialState = result.current.appData.state

        await act(async () => {
            result.current.saveLocalDraft('新內容')
        })

        // 狀態應該通過 Context 更新
        expect(result.current.appData.editorContent).toBe('新內容')
        expect(result.current.appData.state).toBe(initialState) // 其他狀態保持不變
    })
})
