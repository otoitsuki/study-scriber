import { AppStateAction, initialAppData } from "../types/app-state-context"
import { AppData } from "../types/app-state"

export interface AppStateReducerState {
  appData: AppData
  isLoading: boolean
  error: string | null
}

export function appStateReducer(
  state: AppStateReducerState,
  action: AppStateAction
): AppStateReducerState {
  console.log('🔄 [AppStateReducer] Action:', action.type, action)

  switch (action.type) {
    case "SET_STATE":
    case "SET_APP_STATE":  // 別名，為了向後相容
      return {
        ...state,
        appData: {
          ...state.appData,
          state: action.payload,
        },
      }

    case "SET_RECORDING":
      return {
        ...state,
        appData: {
          ...state.appData,
          isRecording: action.payload,
        },
      }

    case "SET_RECORDING_TIME":
      console.log('⏰ [AppStateReducer] 更新錄音時間:', action.payload)
      return {
        ...state,
        appData: {
          ...state.appData,
          recordingTime: action.payload,
        },
      }

    case "SET_EDITOR_CONTENT":
      return {
        ...state,
        appData: {
          ...state.appData,
          editorContent: action.payload,
        },
      }

    case "SET_TRANSCRIPT_ENTRIES":
      return {
        ...state,
        appData: {
          ...state.appData,
          transcriptEntries: action.payload,
        },
      }

    case "ADD_TRANSCRIPT_ENTRY":
      return {
        ...state,
        appData: {
          ...state.appData,
          transcriptEntries: [...state.appData.transcriptEntries, action.payload],
        },
      }

    case "SET_SESSION":
      return {
        ...state,
        appData: {
          ...state.appData,
          session: action.payload,
        },
      }

    case "UPDATE_SESSION_STATUS":
      if (!state.appData.session) {
        console.warn('🔄 [AppStateReducer] 試圖更新不存在的 session 狀態')
        return state
      }
      return {
        ...state,
        appData: {
          ...state.appData,
          session: {
            ...state.appData.session,
            status: action.payload,
          },
        },
      }

    case "RESET_STATE":
      return {
        ...state,
        appData: initialAppData,
        error: null,
      }

    case "SET_LOADING":
      return {
        ...state,
        isLoading: action.payload,
      }

    case "SET_ERROR":
      return {
        ...state,
        error: action.payload,
      }

    case "CLEAR_ERROR":
      return {
        ...state,
        error: null,
      }

    default:
      console.warn('🔄 [AppStateReducer] 未知的 action type:', action)
      return state
  }
}
