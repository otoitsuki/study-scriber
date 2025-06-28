"use client"

import React, { createContext, useContext, useReducer, useCallback } from "react"
import { AppStateContextValue, initialContextState } from "../types/app-state-context"
import { appStateReducer, AppStateReducerState } from "../lib/app-state-reducer"
import { AppState, SessionStatus, SessionType, TranscriptEntry } from "../types/app-state"

const AppStateContext = createContext<AppStateContextValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appStateReducer, initialContextState as AppStateReducerState)

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
