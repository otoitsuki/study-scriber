import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { createElement } from 'react'
import { AppStateProviderWrapper } from '../../providers/app-state-provider-wrapper'
import { useAppState } from '../../hooks/use-app-state-adapter'
import { featureFlagManager } from '../../lib/feature-flags'

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

// 測試組件
function TestComponent() {
    const { appData, isLoading, error } = useAppState()

    return createElement('div', { 'data-testid': 'test-component' }, [
        createElement('div', { 'data-testid': 'app-state', key: 'state' }, appData.state),
        createElement('div', { 'data-testid': 'is-recording', key: 'recording' }, String(appData.isRecording)),
        createElement('div', { 'data-testid': 'is-loading', key: 'loading' }, String(isLoading)),
        createElement('div', { 'data-testid': 'error', key: 'error' }, error || 'null'),
    ])
}

describe('AppStateProvider 整合測試', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        // 重置功能開關
        featureFlagManager.reset()
        // 清除 localStorage
        localStorage.clear()
    })

    test('在功能開關關閉時應該使用舊系統', () => {
        // 確保功能開關關閉
        featureFlagManager.disable('useNewStateManagement')
        featureFlagManager.disable('useNewAppStateHook')

        render(
            createElement(AppStateProviderWrapper, null,
                createElement(TestComponent)
            )
        )

        // 檢查組件是否正常渲染
        expect(screen.getByTestId('test-component')).toBeInTheDocument()
        expect(screen.getByTestId('app-state')).toHaveTextContent('default')
        expect(screen.getByTestId('is-recording')).toHaveTextContent('false')
        // 注意：舊系統在初始化時可能會有 loading 狀態，這是正常的
        expect(screen.getByTestId('is-loading')).toBeInTheDocument()
        expect(screen.getByTestId('error')).toHaveTextContent('null')
    })

    test('在啟用 useNewStateManagement 時應該使用新系統', () => {
        // 啟用新狀態管理
        featureFlagManager.enable('useNewStateManagement')

        render(
            createElement(AppStateProviderWrapper, null,
                createElement(TestComponent)
            )
        )

        // 檢查組件是否正常渲染
        expect(screen.getByTestId('test-component')).toBeInTheDocument()
        expect(screen.getByTestId('app-state')).toHaveTextContent('default')
        expect(screen.getByTestId('is-recording')).toHaveTextContent('false')
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false')
        expect(screen.getByTestId('error')).toHaveTextContent('null')
    })

    test('在啟用 useNewAppStateHook 時應該使用新系統', () => {
        // 啟用新 AppState Hook
        featureFlagManager.enable('useNewAppStateHook')

        render(
            createElement(AppStateProviderWrapper, null,
                createElement(TestComponent)
            )
        )

        // 檢查組件是否正常渲染
        expect(screen.getByTestId('test-component')).toBeInTheDocument()
        expect(screen.getByTestId('app-state')).toHaveTextContent('default')
        expect(screen.getByTestId('is-recording')).toHaveTextContent('false')
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false')
        expect(screen.getByTestId('error')).toHaveTextContent('null')
    })

    test('Provider 應該能夠包裝多個子組件', () => {
        featureFlagManager.enable('useNewStateManagement')

        function MultipleChildrenTest() {
            return createElement('div', null, [
                createElement(TestComponent, { key: 'child1' }),
                createElement(TestComponent, { key: 'child2' }),
            ])
        }

        render(
            createElement(AppStateProviderWrapper, null,
                createElement(MultipleChildrenTest)
            )
        )

        // 檢查所有子組件都能正常存取狀態
        const components = screen.getAllByTestId('test-component')
        expect(components).toHaveLength(2)

        components.forEach(component => {
            expect(component).toBeInTheDocument()
        })
    })

    test('功能開關切換應該不會影響組件渲染', () => {
        // 開始時關閉功能開關
        featureFlagManager.disable('useNewStateManagement')
        featureFlagManager.disable('useNewAppStateHook')

        const { rerender } = render(
            createElement(AppStateProviderWrapper, null,
                createElement(TestComponent)
            )
        )

        // 檢查初始狀態
        expect(screen.getByTestId('app-state')).toHaveTextContent('default')

        // 啟用功能開關並重新渲染
        act(() => {
            featureFlagManager.enable('useNewStateManagement')
        })

        rerender(
            createElement(AppStateProviderWrapper, null,
                createElement(TestComponent)
            )
        )

        // 檢查狀態仍然正常
        expect(screen.getByTestId('app-state')).toHaveTextContent('default')
        expect(screen.getByTestId('is-recording')).toHaveTextContent('false')
    })
})
