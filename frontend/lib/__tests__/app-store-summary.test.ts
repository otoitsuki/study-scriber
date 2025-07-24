/**
 * Tests for summary functionality in app store
 */
import { renderHook, act } from '@testing-library/react'
import { useAppStore, useAppState, useAppActions } from '../app-store-zustand'

describe('App Store Summary Functionality', () => {
    beforeEach(() => {
        // Reset store before each test
        useAppStore.getState().resetState()
    })

    describe('Summary State Management', () => {
        it('should initialize with empty summary and not ready', () => {
            const { result } = renderHook(() => useAppState())

            expect(result.current.summary).toBe('')
            expect(result.current.isSummaryReady).toBe(false)
            expect(result.current.currentTab).toBe('transcript')
        })

        it('should update summary content', () => {
            const { result } = renderHook(() => useAppActions())

            act(() => {
                result.current.setSummary('這是測試摘要內容')
            })

            const state = useAppState()
            expect(state.getState().summary).toBe('這是測試摘要內容')
        })

        it('should update summary ready status', () => {
            const { result } = renderHook(() => useAppActions())

            act(() => {
                result.current.setSummaryReady(true)
            })

            const state = useAppState()
            expect(state.getState().isSummaryReady).toBe(true)
        })

        it('should switch tabs', () => {
            const { result } = renderHook(() => useAppActions())

            act(() => {
                result.current.setCurrentTab('summary')
            })

            const state = useAppState()
            expect(state.getState().currentTab).toBe('summary')
        })
    })

    describe('Finish State Logic', () => {
        it('should transition to finished when both transcript and summary are ready', () => {
            const store = useAppStore.getState()

            // Set initial processing state
            act(() => {
                store.setState('processing')
            })

            // Set transcript ready first
            act(() => {
                store.setTranscriptReady(true)
            })

            expect(store.appState).toBe('processing') // Should still be processing

            // Set summary ready - should trigger finished
            act(() => {
                store.setSummaryReady(true)
            })

            expect(store.appState).toBe('finished')
        })

        it('should transition to finished when summary ready first', () => {
            const store = useAppStore.getState()

            // Set initial processing state
            act(() => {
                store.setState('processing')
            })

            // Set summary ready first
            act(() => {
                store.setSummaryReady(true)
            })

            expect(store.appState).toBe('processing') // Should still be processing

            // Set transcript ready - should trigger finished
            act(() => {
                store.setTranscriptReady(true)
            })

            expect(store.appState).toBe('finished')
        })

        it('should not transition to finished if only one flag is ready', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setState('processing')
                store.setTranscriptReady(true)
            })

            expect(store.appState).toBe('processing')
            expect(store.isTranscriptReady).toBe(true)
            expect(store.isSummaryReady).toBe(false)
        })
    })

    describe('State Reset', () => {
        it('should reset all summary-related state', () => {
            const store = useAppStore.getState()

            // Set some summary state
            act(() => {
                store.setSummary('測試摘要')
                store.setSummaryReady(true)
                store.setTranscriptReady(true)
                store.setCurrentTab('summary')
            })

            // Reset state
            act(() => {
                store.resetState()
            })

            expect(store.summary).toBe('')
            expect(store.isSummaryReady).toBe(false)
            expect(store.isTranscriptReady).toBe(false)
            expect(store.currentTab).toBe('transcript')
        })
    })

    describe('Edge Cases', () => {
        it('should handle setting summary ready multiple times', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setState('processing')
                store.setTranscriptReady(true)
                store.setSummaryReady(true)
            })

            expect(store.appState).toBe('finished')

            // Setting ready again should not cause issues
            act(() => {
                store.setSummaryReady(true)
            })

            expect(store.appState).toBe('finished')
            expect(store.isSummaryReady).toBe(true)
        })

        it('should handle empty summary content', () => {
            const store = useAppStore.getState()

            act(() => {
                store.setSummary('')
                store.setSummaryReady(true)
            })

            expect(store.summary).toBe('')
            expect(store.isSummaryReady).toBe(true)
        })
    })
})
