import { AppData, AppState, SessionStatus, SessionType, TranscriptEntry } from "./app-state"
import { StateTransitionTrigger, StateTransitionResult } from './state-transitions';

// 狀態管理 Actions
export type AppStateAction =
    | { type: "SET_STATE"; payload: AppState }
    | { type: "SET_APP_STATE"; payload: AppState }  // 別名，為了向後相容
    | { type: "SET_RECORDING"; payload: boolean }
    | { type: "SET_RECORDING_TIME"; payload: number }
    | { type: "SET_EDITOR_CONTENT"; payload: string }
    | { type: "SET_TRANSCRIPT_ENTRIES"; payload: TranscriptEntry[] }
    | { type: "ADD_TRANSCRIPT_ENTRY"; payload: TranscriptEntry }
    | { type: "SET_SESSION"; payload: { id: string; status: SessionStatus; type: SessionType } | null }
    | { type: "UPDATE_SESSION_STATUS"; payload: SessionStatus }
    | { type: "RESET_STATE" }
    | { type: "SET_LOADING"; payload: boolean }
    | { type: "SET_ERROR"; payload: string | null }
    | { type: "CLEAR_ERROR" }

// Context 狀態介面
export interface AppStateContextValue {
    // 狀態數據
    appData: AppData
    isLoading: boolean
    error: string | null

    // 狀態更新函數
    dispatch: (action: AppStateAction) => void

    // 便利方法（封裝常用的 dispatch 操作）
    setState: (state: AppState) => void
    setRecording: (isRecording: boolean) => void
    setRecordingTime: (time: number) => void
    setEditorContent: (content: string) => void
    setTranscriptEntries: (entries: TranscriptEntry[]) => void
    addTranscriptEntry: (entry: TranscriptEntry) => void
    setSession: (session: { id: string; status: SessionStatus; type: SessionType } | null) => void
    updateSessionStatus: (status: SessionStatus) => void
    resetState: () => void
    setLoading: (loading: boolean) => void
    setError: (error: string | null) => void
    transition: (trigger: StateTransitionTrigger) => StateTransitionResult | null
}

// 初始狀態
export const initialAppData: AppData = {
    state: "default",
    transcriptEntries: [],
    editorContent: "",
    isRecording: false,
    recordingTime: 0,
    session: null,
}

export const initialContextState = {
    appData: initialAppData,
    isLoading: false,
    error: null,
}
