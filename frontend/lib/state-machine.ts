"use client"

import { AppState } from "../types/app-state"
import {
    StateTransitionTrigger,
    StateTransitionCondition,
    StateTransitionContext,
    StateTransitionResult,
    StateTransitionSideEffect,
    STATE_TRANSITION_RULES,
    STATE_TRANSITION_SIDE_EFFECTS
} from "../types/state-transitions"

// 狀態機類別
export class StateMachine {
    private currentState: AppState = "default"
    private context: StateTransitionContext
    private listeners: Set<(newState: AppState, sideEffects: StateTransitionSideEffect[]) => void> = new Set()

    constructor(initialContext: StateTransitionContext) {
        this.context = initialContext
        this.currentState = initialContext.currentState
        this.exposeToWindow()
    }

    // 更新上下文
    updateContext(newContext: Partial<StateTransitionContext>): void {
        this.context = { ...this.context, ...newContext }
        console.log('🔄 [StateMachine] 上下文已更新:', this.context)
    }

    // 嘗試狀態轉換
    transition(trigger: StateTransitionTrigger): StateTransitionResult {
        const transitionKey = `${this.currentState}->${trigger}`
        console.log(`🔄 [StateMachine] 嘗試狀態轉換: ${transitionKey}`)

        // 尋找符合的轉換規則
        const matchingRules = this.findMatchingRules(trigger)

        if (matchingRules.length === 0) {
            const error = `沒有找到符合的轉換規則: ${transitionKey}`
            console.warn(`⚠️ [StateMachine] ${error}`)
            return {
                success: false,
                newState: this.currentState,
                error
            }
        }

        // 驗證轉換條件
        const validRule = this.validateTransitionRules(matchingRules)

        if (!validRule) {
            const error = `轉換條件不符合: ${transitionKey}`
            console.warn(`⚠️ [StateMachine] ${error}`)
            return {
                success: false,
                newState: this.currentState,
                error
            }
        }

        // 執行狀態轉換
        const result = this.executeTransition(validRule, trigger)

        if (result.success) {
            this.currentState = result.newState
            console.log(`✅ [StateMachine] 狀態轉換成功: ${this.context.currentState} -> ${result.newState}`)

            // 更新上下文中的當前狀態
            this.context.currentState = result.newState

            // 通知監聽器
            this.notifyListeners(result.newState, result.sideEffects || [])
        }

        return result
    }

    // 尋找匹配的轉換規則
    private findMatchingRules(trigger: StateTransitionTrigger): StateTransitionCondition[] {
        return STATE_TRANSITION_RULES.filter(rule =>
            rule.currentState === this.currentState && rule.trigger === trigger
        )
    }

    // 驗證轉換規則
    private validateTransitionRules(rules: StateTransitionCondition[]): StateTransitionCondition | null {
        for (const rule of rules) {
            if (this.isRuleValid(rule)) {
                return rule
            }
        }
        return null
    }

    // 檢查單一規則是否有效
    private isRuleValid(rule: StateTransitionCondition): boolean {
        const context = this.context

        // 檢查 session 存在性
        if (rule.sessionExists !== undefined) {
            const hasSession = context.session !== null
            if (rule.sessionExists !== hasSession) {
                console.log(`🔍 [StateMachine] Session 存在性檢查失敗: 期望 ${rule.sessionExists}, 實際 ${hasSession}`)
                return false
            }
        }

        // 檢查 session 狀態
        if (rule.sessionStatus !== undefined) {
            if (!context.session || context.session.status !== rule.sessionStatus) {
                console.log(`🔍 [StateMachine] Session 狀態檢查失敗: 期望 ${rule.sessionStatus}, 實際 ${context.session?.status}`)
                return false
            }
        }

        // 檢查 session 類型
        if (rule.sessionType !== undefined) {
            if (!context.session || context.session.type !== rule.sessionType) {
                console.log(`🔍 [StateMachine] Session 類型檢查失敗: 期望 ${rule.sessionType}, 實際 ${context.session?.type}`)
                return false
            }
        }

        // 檢查錄音狀態
        if (rule.isRecording !== undefined) {
            if (context.isRecording !== rule.isRecording) {
                console.log(`🔍 [StateMachine] 錄音狀態檢查失敗: 期望 ${rule.isRecording}, 實際 ${context.isRecording}`)
                return false
            }
        }

        // 檢查逐字稿存在性
        if (rule.hasTranscripts !== undefined) {
            const hasTranscripts = context.transcriptCount > 0
            if (rule.hasTranscripts !== hasTranscripts) {
                console.log(`🔍 [StateMachine] 逐字稿存在性檢查失敗: 期望 ${rule.hasTranscripts}, 實際 ${hasTranscripts}`)
                return false
            }
        }

        // 執行自定義驗證
        if (rule.customValidator) {
            const isValid = rule.customValidator(context)
            if (!isValid) {
                console.log(`🔍 [StateMachine] 自定義驗證失敗`)
                return false
            }
        }

        console.log(`✅ [StateMachine] 規則驗證通過: ${rule.currentState} -> ${rule.targetState}`)
        return true
    }

    // 執行狀態轉換
    private executeTransition(rule: StateTransitionCondition, trigger: StateTransitionTrigger): StateTransitionResult {
        const sideEffectKey = `${rule.currentState}->${rule.targetState}->${trigger}`
        const sideEffects = STATE_TRANSITION_SIDE_EFFECTS[sideEffectKey] || []

        console.log(`🔄 [StateMachine] 執行轉換: ${sideEffectKey}`)
        console.log(`🔄 [StateMachine] 副作用:`, sideEffects)

        return {
            success: true,
            newState: rule.targetState,
            sideEffects
        }
    }

    // 添加狀態變更監聽器
    addListener(listener: (newState: AppState, sideEffects: StateTransitionSideEffect[]) => void): void {
        this.listeners.add(listener)
    }

    // 移除狀態變更監聽器
    removeListener(listener: (newState: AppState, sideEffects: StateTransitionSideEffect[]) => void): void {
        this.listeners.delete(listener)
    }

    // 通知所有監聽器
    private notifyListeners(newState: AppState, sideEffects: StateTransitionSideEffect[]): void {
        this.listeners.forEach(listener => {
            try {
                listener(newState, sideEffects)
            } catch (error) {
                console.error('🔄 [StateMachine] 監聽器執行失敗:', error)
            }
        })
    }

    // 取得當前狀態
    getCurrentState(): AppState {
        return this.currentState
    }

    // 取得當前上下文
    getContext(): StateTransitionContext {
        return { ...this.context }
    }

    // 檢查是否可以執行特定轉換
    canTransition(trigger: StateTransitionTrigger): boolean {
        const matchingRules = this.findMatchingRules(trigger)
        return matchingRules.some(rule => this.isRuleValid(rule))
    }

    // 取得可用的轉換
    getAvailableTransitions(): StateTransitionTrigger[] {
        const availableTransitions: StateTransitionTrigger[] = []

        // 檢查所有可能的觸發器
        const allTriggers: StateTransitionTrigger[] = [
            "USER_START_RECORDING",
            "USER_STOP_RECORDING",
            "FIRST_TRANSCRIPT_RECEIVED",
            "SESSION_CREATED",
            "SESSION_UPGRADED",
            "PROCESSING_STARTED",
            "PROCESSING_COMPLETED",
            "ERROR_OCCURRED",
            "USER_NEW_NOTE",
            "TRANSCRIPT_COMPLETED"
        ]

        for (const trigger of allTriggers) {
            if (this.canTransition(trigger)) {
                availableTransitions.push(trigger)
            }
        }

        return availableTransitions
    }

    // 重置狀態機
    reset(newContext?: StateTransitionContext): void {
        this.currentState = "default"
        if (newContext) {
            this.context = newContext
        } else {
            this.context = {
                currentState: "default",
                isRecording: false,
                transcriptCount: 0,
                session: null,
                error: null
            }
        }
        console.log('🔄 [StateMachine] 狀態機已重置')
    }

    // 暴露到 window 供調試使用
    private exposeToWindow(): void {
        if (typeof window !== 'undefined') {
            (window as any).stateMachine = {
                getCurrentState: () => this.getCurrentState(),
                getContext: () => this.getContext(),
                canTransition: (trigger: StateTransitionTrigger) => this.canTransition(trigger),
                getAvailableTransitions: () => this.getAvailableTransitions(),
                transition: (trigger: StateTransitionTrigger) => this.transition(trigger),
                reset: () => this.reset(),

                // 便利方法
                startRecording: () => this.transition("USER_START_RECORDING"),
                stopRecording: () => this.transition("USER_STOP_RECORDING"),
                newNote: () => this.transition("USER_NEW_NOTE"),
                firstTranscript: () => this.transition("FIRST_TRANSCRIPT_RECEIVED"),
                processingComplete: () => this.transition("PROCESSING_COMPLETED"),
                error: () => this.transition("ERROR_OCCURRED"),
            }

            console.log('🔄 [StateMachine] 調試介面已暴露到 window.stateMachine')
            console.log('   使用方法: window.stateMachine.startRecording()')
            console.log('   查看狀態: window.stateMachine.getCurrentState()')
            console.log('   可用轉換: window.stateMachine.getAvailableTransitions()')
        }
    }
}

// 副作用處理器介面
export interface SideEffectHandler {
    handleSideEffect(effect: StateTransitionSideEffect): Promise<void> | void
}

// 狀態機管理器
export class StateMachineManager {
    private stateMachine: StateMachine
    private sideEffectHandlers: Map<string, SideEffectHandler> = new Map()

    constructor(initialContext: StateTransitionContext) {
        this.stateMachine = new StateMachine(initialContext)

        // 監聽狀態變更並處理副作用
        this.stateMachine.addListener((newState, sideEffects) => {
            this.handleSideEffects(sideEffects)
        })
    }

    // 註冊副作用處理器
    registerSideEffectHandler(effectType: string, handler: SideEffectHandler): void {
        this.sideEffectHandlers.set(effectType, handler)
        console.log(`🔄 [StateMachineManager] 副作用處理器已註冊: ${effectType}`)
    }

    // 處理副作用
    private async handleSideEffects(sideEffects: StateTransitionSideEffect[]): Promise<void> {
        for (const effect of sideEffects) {
            const handler = this.sideEffectHandlers.get(effect.type)
            if (handler) {
                try {
                    await handler.handleSideEffect(effect)
                    console.log(`✅ [StateMachineManager] 副作用處理完成: ${effect.type}`)
                } catch (error) {
                    console.error(`❌ [StateMachineManager] 副作用處理失敗: ${effect.type}`, error)
                }
            } else {
                console.warn(`⚠️ [StateMachineManager] 未找到副作用處理器: ${effect.type}`)
            }
        }
    }

    // 取得狀態機實例
    getStateMachine(): StateMachine {
        return this.stateMachine
    }

    // 更新上下文並觸發自動轉換
    updateContextAndTransition(
        newContext: Partial<StateTransitionContext>,
        autoTrigger?: StateTransitionTrigger
    ): StateTransitionResult | null {
        this.stateMachine.updateContext(newContext)

        if (autoTrigger && this.stateMachine.canTransition(autoTrigger)) {
            return this.stateMachine.transition(autoTrigger)
        }

        return null
    }
}

// 便利函數：建立狀態機實例
export function createStateMachine(initialContext: StateTransitionContext): StateMachineManager {
    return new StateMachineManager(initialContext)
}
