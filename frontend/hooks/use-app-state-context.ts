"use client"

import React, { createContext, useContext, useReducer, useCallback, useEffect, useState } from "react"
import { AppStateContextValue, initialContextState } from "../types/app-state-context"
import { appStateReducer, AppStateReducerState } from "../lib/app-state-reducer"
import { InitialStateLoader } from "../lib/initial-state-loader"
import { AppState, SessionStatus, SessionType, TranscriptEntry } from "../types/app-state"
import { StateMachineManager } from '../lib/state-machine';
import { StateTransitionTrigger } from "../types/state-transitions";

const AppStateContext = createContext<AppStateContextValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appStateReducer, initialContextState as AppStateReducerState)
  const [stateMachineManager, setStateMachineManager] = useState<StateMachineManager | null>(null);

  // 載入初始狀態並初始化狀態機
  useEffect(() => {
    console.log('🔄 [AppStateProvider] 載入初始狀態...')

    // 檢查是否在瀏覽器環境
    if (typeof window !== 'undefined') {
      try {
        const initialAppData = InitialStateLoader.loadInitialAppData()

        // 更新 Context 狀態
        dispatch({ type: "SET_APP_STATE", payload: initialAppData.state })
        dispatch({ type: "SET_EDITOR_CONTENT", payload: initialAppData.editorContent })
        dispatch({ type: "SET_TRANSCRIPT_ENTRIES", payload: initialAppData.transcriptEntries })

        if (initialAppData.session) {
          dispatch({ type: "SET_SESSION", payload: initialAppData.session })
        }

        // 初始化狀態機
        const smManager = new StateMachineManager({
          currentState: initialAppData.state,
          isRecording: initialAppData.isRecording,
          transcriptCount: initialAppData.transcriptEntries.length,
          session: initialAppData.session || null,
          error: null
        });
        setStateMachineManager(smManager);

        console.log('✅ [AppStateProvider] 初始狀態載入完成:', {
          state: initialAppData.state,
          hasSession: !!initialAppData.session,
          transcriptCount: initialAppData.transcriptEntries.length,
          contentLength: initialAppData.editorContent.length
        })
      } catch (error) {
        console.error('❌ [AppStateProvider] 載入初始狀態失敗:', error)
      }
    }
  }, [])

  // 狀態持久化
  useEffect(() => {
    // 檢查是否在瀏覽器環境且狀態已初始化
    if (typeof window !== 'undefined' && state.appData) {
      try {
        // 延遲儲存，避免在初始載入時立即儲存
        const timeoutId = setTimeout(() => {
          InitialStateLoader.saveAppState(state.appData)
        }, 1000) // 1秒延遲

        return () => clearTimeout(timeoutId)
      } catch (error) {
        console.error('❌ [AppStateProvider] 狀態持久化失敗:', error)
      }
    }
  }, [state.appData])

  // 將狀態變更同步到狀態機
  useEffect(() => {
    if (stateMachineManager) {
      stateMachineManager.getStateMachine().updateContext({
        currentState: state.appData.state,
        isRecording: state.appData.isRecording,
        transcriptCount: state.appData.transcriptEntries.length,
        session: state.appData.session,
        error: state.error
      });
    }
  }, [state, stateMachineManager]);

  const transition = useCallback((trigger: StateTransitionTrigger) => {
    if (!stateMachineManager) {
      console.error("狀態機尚未初始化");
      return null;
    }
    const result = stateMachineManager.getStateMachine().transition(trigger);
    if (result.success) {
      dispatch({ type: 'SET_APP_STATE', payload: result.newState });
    }
    return result;
  }, [stateMachineManager]);

  const setState = useCallback((newState: AppState) => {
    dispatch({ type: "SET_STATE", payload: newState })
  }, [])

  const setRecording = useCallback((isRecording: boolean) => {
    dispatch({ type: "SET_RECORDING", payload: isRecording })
  }, [])

  const setRecordingTime = useCallback((time: number) => {
    dispatch({ type: "SET_RECORDING_TIME", payload: time })
  }, [])

  const setEditorContent = useCallback((content: string) => {
    dispatch({ type: "SET_EDITOR_CONTENT", payload: content })
  }, [])

  const setTranscriptEntries = useCallback((entries: TranscriptEntry[]) => {
    dispatch({ type: "SET_TRANSCRIPT_ENTRIES", payload: entries })
  }, [])

  const addTranscriptEntry = useCallback((entry: TranscriptEntry) => {
    dispatch({ type: "ADD_TRANSCRIPT_ENTRY", payload: entry })
  }, [])

  const setSession = useCallback((session: { id: string; status: SessionStatus; type: SessionType } | null) => {
    dispatch({ type: "SET_SESSION", payload: session })
  }, [])

  const updateSessionStatus = useCallback((status: SessionStatus) => {
    dispatch({ type: "UPDATE_SESSION_STATUS", payload: status })
  }, [])

  const resetState = useCallback(() => {
    dispatch({ type: "RESET_STATE" })
  }, [])

  const setLoading = useCallback((loading: boolean) => {
    dispatch({ type: "SET_LOADING", payload: loading })
  }, [])

  const setError = useCallback((error: string | null) => {
    dispatch({ type: "SET_ERROR", payload: error })
  }, [])

  const contextValue: AppStateContextValue = {
    appData: state.appData,
    isLoading: state.isLoading,
    error: state.error,
    dispatch,
    setState,
    setRecording,
    setRecordingTime,
    setEditorContent,
    setTranscriptEntries,
    addTranscriptEntry,
    setSession,
    updateSessionStatus,
    resetState,
    setLoading,
    setError,
    transition,
  }

  return React.createElement(
    AppStateContext.Provider,
    { value: contextValue },
    children
  )
}

export function useAppStateContext(): AppStateContextValue {
  const context = useContext(AppStateContext)
  if (!context) {
    throw new Error("useAppStateContext 必須在 AppStateProvider 內使用")
  }
  return context
}

export { AppStateContext }
