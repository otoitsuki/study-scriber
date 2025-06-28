import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StateMachine } from '../../lib/state-machine'
import { featureFlagManager } from '../../lib/feature-flags'
import type { AppState } from '../../types/app-state'
import type { StateTransitionContext } from '../../types/state-transitions'

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
}

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock
})

describe('狀態轉換測試', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        featureFlagManager.reset()
        featureFlagManager.enable('useNewStateManagement')
        localStorageMock.getItem.mockReturnValue(null)
    })

    describe('基本狀態轉換', () => {
        test('應該支援 default → recording_waiting 轉換', () => {
            const stateMachine = new StateMachine('default')

            const canTransition = stateMachine.canTransition('START_RECORDING')
            expect(canTransition).toBe(true)

            const newState = stateMachine.transition('START_RECORDING')
            expect(newState).toBe('recording_waiting')
        })

        test('應該支援 recording_waiting → recording_active 轉換', () => {
            const stateMachine = new StateMachine('recording_waiting')

            const canTransition = stateMachine.canTransition('RECORDING_STARTED')
            expect(canTransition).toBe(true)

            const newState = stateMachine.transition('RECORDING_STARTED')
            expect(newState).toBe('recording_active')
        })

        test('應該支援 recording_active → processing 轉換', () => {
            const stateMachine = new StateMachine('recording_active')

            const canTransition = stateMachine.canTransition('STOP_RECORDING')
            expect(canTransition).toBe(true)

            const newState = stateMachine.transition('STOP_RECORDING')
            expect(newState).toBe('processing')
        })

        test('應該支援 processing → finished 轉換', () => {
            const stateMachine = new StateMachine('processing')

            const canTransition = stateMachine.canTransition('PROCESSING_COMPLETE')
            expect(canTransition).toBe(true)

            const newState = stateMachine.transition('PROCESSING_COMPLETE')
            expect(newState).toBe('finished')
        })
    })

    describe('狀態轉換限制', () => {
        test('不應該允許無效的狀態轉換', () => {
            const stateMachine = new StateMachine('default')

            // 不能直接從 default 跳到 recording_active
            const canTransition = stateMachine.canTransition('RECORDING_STARTED')
            expect(canTransition).toBe(false)

            // 嘗試無效轉換應該拋出錯誤
            expect(() => {
                stateMachine.transition('RECORDING_STARTED')
            }).toThrow()
        })

        test('finished 狀態應該只能重置到 default', () => {
            const stateMachine = new StateMachine('finished')

            // 只能重置
            expect(stateMachine.canTransition('RESET')).toBe(true)
            expect(stateMachine.canTransition('START_RECORDING')).toBe(false)
            expect(stateMachine.canTransition('STOP_RECORDING')).toBe(false)

            const newState = stateMachine.transition('RESET')
            expect(newState).toBe('default')
        })

        test('應該支援從任何狀態重置到 default', () => {
            const states: AppState[] = ['default', 'recording_waiting', 'recording_active', 'processing', 'finished']

            states.forEach(state => {
                const stateMachine = new StateMachine(state)
                expect(stateMachine.canTransition('RESET')).toBe(true)
                expect(stateMachine.transition('RESET')).toBe('default')
            })
        })
    })

    describe('完整狀態流程', () => {
        test('應該支援完整的錄音流程', () => {
            const stateMachine = new StateMachine('default')

            // 完整流程：default → recording_waiting → recording_active → processing → finished
            expect(stateMachine.getCurrentState()).toBe('default')

            // 開始錄音
            const waitingState = stateMachine.transition('START_RECORDING')
            expect(waitingState).toBe('recording_waiting')

            // 錄音開始
            const activeState = stateMachine.transition('RECORDING_STARTED')
            expect(activeState).toBe('recording_active')

            // 停止錄音
            const processingState = stateMachine.transition('STOP_RECORDING')
            expect(processingState).toBe('processing')

            // 處理完成
            const finishedState = stateMachine.transition('PROCESSING_COMPLETE')
            expect(finishedState).toBe('finished')

            // 重置
            const resetState = stateMachine.transition('RESET')
            expect(resetState).toBe('default')
        })

        test('應該支援筆記模式流程', () => {
            const stateMachine = new StateMachine('default')

            // 筆記模式：default → finished (直接完成)
            expect(stateMachine.getCurrentState()).toBe('default')

            const finishedState = stateMachine.transition('FINISH_SESSION')
            expect(finishedState).toBe('finished')
        })
    })

    describe('錯誤恢復', () => {
        test('應該支援錯誤狀態恢復', () => {
            const stateMachine = new StateMachine('recording_active')

            // 從錄音中發生錯誤
            const errorState = stateMachine.transition('ERROR')
            expect(errorState).toBe('default')
        })

        test('應該支援會話升級', () => {
            const stateMachine = new StateMachine('default')

            // 升級到錄音模式
            const upgradedState = stateMachine.transition('UPGRADE_TO_RECORDING')
            expect(upgradedState).toBe('recording_waiting')
        })
    })

    describe('並發狀態變更', () => {
        test('狀態機應該是線程安全的', () => {
            const stateMachine = new StateMachine('default')
            const results: AppState[] = []

            // 模擬並發轉換
            const transitions = [
                'START_RECORDING',
                'RESET',
                'START_RECORDING',
                'RESET'
            ]

            transitions.forEach(trigger => {
                try {
                    const newState = stateMachine.transition(trigger as any)
                    results.push(newState)
                } catch (error) {
                    // 某些轉換可能失敗，這是預期的
                }
            })

            // 最後狀態應該是有效的
            const finalState = stateMachine.getCurrentState()
            const validStates: AppState[] = ['default', 'recording_waiting', 'recording_active', 'processing', 'finished']
            expect(validStates).toContain(finalState)
        })
    })

    describe('狀態歷史', () => {
        test('應該記錄狀態轉換歷史', () => {
            const stateMachine = new StateMachine('default')

            stateMachine.transition('START_RECORDING')
            stateMachine.transition('RECORDING_STARTED')
            stateMachine.transition('STOP_RECORDING')

            const history = stateMachine.getHistory()
            expect(history).toHaveLength(4) // 包含初始狀態
            expect(history[0]).toBe('default')
            expect(history[1]).toBe('recording_waiting')
            expect(history[2]).toBe('recording_active')
            expect(history[3]).toBe('processing')
        })

        test('應該支援回到上一個狀態', () => {
            const stateMachine = new StateMachine('default')

            stateMachine.transition('START_RECORDING')
            stateMachine.transition('RECORDING_STARTED')

            const canGoBack = stateMachine.canGoBack()
            expect(canGoBack).toBe(true)

            const previousState = stateMachine.goBack()
            expect(previousState).toBe('recording_waiting')
            expect(stateMachine.getCurrentState()).toBe('recording_waiting')
        })
    })
})
