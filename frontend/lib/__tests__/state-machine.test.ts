import { describe, test, expect, beforeEach, vi } from 'vitest'
import { StateMachine, StateMachineManager, createStateMachine } from '../state-machine'
import { StateTransitionContext } from '../../types/state-transitions'

describe('StateMachine', () => {
    let stateMachine: StateMachine
    let initialContext: StateTransitionContext

    beforeEach(() => {
        initialContext = {
            currentState: 'default',
            isRecording: false,
            transcriptCount: 0,
            session: null,
            error: null,
        }
        stateMachine = new StateMachine(initialContext)
    })

    test('should initialize with correct state', () => {
        expect(stateMachine.getCurrentState()).toBe('default')
        expect(stateMachine.getContext()).toEqual(initialContext)
    })

    test('should update context correctly', () => {
        const newContext = {
            isRecording: true,
            session: { id: 'test-id', status: 'active' as const, type: 'recording' as const }
        }

        stateMachine.updateContext(newContext)
        const updatedContext = stateMachine.getContext()

        expect(updatedContext.isRecording).toBe(true)
        expect(updatedContext.session).toEqual(newContext.session)
    })

    test('should validate USER_START_RECORDING transition from default', () => {
        const canTransition = stateMachine.canTransition('USER_START_RECORDING')
        expect(canTransition).toBe(true)
    })

    test('should not allow invalid transitions', () => {
        const canTransition = stateMachine.canTransition('USER_STOP_RECORDING')
        expect(canTransition).toBe(false)
    })

    test('should execute valid state transition', () => {
        const result = stateMachine.transition('USER_START_RECORDING')

        expect(result.success).toBe(true)
        expect(result.newState).toBe('recording_waiting')
        expect(result.sideEffects).toBeDefined()
        expect(stateMachine.getCurrentState()).toBe('recording_waiting')
    })

    test('should reject invalid state transition', () => {
        const result = stateMachine.transition('USER_STOP_RECORDING')

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(stateMachine.getCurrentState()).toBe('default')
    })

    test('should handle FIRST_TRANSCRIPT_RECEIVED transition', () => {
        // 先轉換到 recording_waiting 狀態
        stateMachine.transition('USER_START_RECORDING')

        // 更新上下文以符合轉換條件
        stateMachine.updateContext({
            currentState: 'recording_waiting',
            isRecording: true,
            transcriptCount: 1,
            session: { id: 'test-id', status: 'active', type: 'recording' }
        })

        const result = stateMachine.transition('FIRST_TRANSCRIPT_RECEIVED')
        expect(result.success).toBe(true)
        expect(result.newState).toBe('recording_active')
    })

    test('should get available transitions correctly', () => {
        const transitions = stateMachine.getAvailableTransitions()
        expect(transitions).toContain('USER_START_RECORDING')
        expect(transitions).not.toContain('USER_STOP_RECORDING')
    })

    test('should reset state machine', () => {
        stateMachine.transition('USER_START_RECORDING')
        expect(stateMachine.getCurrentState()).toBe('recording_waiting')

        stateMachine.reset()
        expect(stateMachine.getCurrentState()).toBe('default')
        expect(stateMachine.getContext().isRecording).toBe(false)
    })

    test('should handle listeners correctly', () => {
        const mockListener = vi.fn()
        stateMachine.addListener(mockListener)

        stateMachine.transition('USER_START_RECORDING')

        expect(mockListener).toHaveBeenCalledWith(
            'recording_waiting',
            expect.any(Array)
        )

        stateMachine.removeListener(mockListener)
    })
})

describe('StateMachineManager', () => {
    let manager: StateMachineManager
    let initialContext: StateTransitionContext

    beforeEach(() => {
        initialContext = {
            currentState: 'default',
            isRecording: false,
            transcriptCount: 0,
            session: null,
            error: null,
        }
        manager = new StateMachineManager(initialContext)
    })

    test('should create manager with state machine', () => {
        const stateMachine = manager.getStateMachine()
        expect(stateMachine).toBeInstanceOf(StateMachine)
        expect(stateMachine.getCurrentState()).toBe('default')
    })

    test('should register side effect handlers', () => {
        const mockHandler = {
            handleSideEffect: vi.fn()
        }

        manager.registerSideEffectHandler('CREATE_SESSION', mockHandler)

        // 觸發會產生 CREATE_SESSION 副作用的轉換
        const stateMachine = manager.getStateMachine()
        stateMachine.transition('USER_START_RECORDING')

        // 等待副作用處理
        setTimeout(() => {
            expect(mockHandler.handleSideEffect).toHaveBeenCalled()
        }, 0)
    })

    test('should update context and trigger auto transition', () => {
        const result = manager.updateContextAndTransition(
            { isRecording: false },
            'USER_START_RECORDING'
        )

        expect(result).toBeDefined()
        expect(result?.success).toBe(true)
        expect(result?.newState).toBe('recording_waiting')
    })
})

describe('createStateMachine', () => {
    test('should create state machine manager', () => {
        const initialContext: StateTransitionContext = {
            currentState: 'default',
            isRecording: false,
            transcriptCount: 0,
            session: null,
            error: null,
        }

        const manager = createStateMachine(initialContext)
        expect(manager).toBeInstanceOf(StateMachineManager)

        const stateMachine = manager.getStateMachine()
        expect(stateMachine.getCurrentState()).toBe('default')
    })
})
