"use client"

import React, { createContext, useContext, useReducer, useCallback, useEffect, useState } from "react"
import { AppStateContextValue, initialContextState } from "../types/app-state-context"
import { appStateReducer, AppStateReducerState } from "../lib/app-state-reducer"
import { InitialStateLoader } from "../lib/initial-state-loader"
import { AppState, SessionStatus, SessionType, TranscriptEntry } from "../types/app-state"
import { StateMachineManager } from '../lib/state-machine';
import { StateTransitionTrigger } from "../types/state-transitions";
import { ServiceRegistry, SERVICE_KEYS, serviceContainer } from "../lib/services";
import type { ISessionService, IRecordingService, ITranscriptService, TranscriptMessage } from "../lib/services";

const AppStateContext = createContext<AppStateContextValue | null>(null)

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appStateReducer, initialContextState as AppStateReducerState)
  const [stateMachineManager, setStateMachineManager] = useState<StateMachineManager | null>(null);
  const [servicesInitialized, setServicesInitialized] = useState(false);

  // 初始化服務層
  useEffect(() => {
    async function initializeServices() {
      try {
        console.log('🚀 [AppStateProvider] 初始化服務層...')

        // 註冊並初始化所有服務
        await ServiceRegistry.initializeServices()

        setServicesInitialized(true)
        console.log('✅ [AppStateProvider] 服務層初始化完成')
      } catch (error) {
        console.error('❌ [AppStateProvider] 服務層初始化失敗:', error)
      }
    }

    initializeServices()
  }, [])

  // 載入初始狀態並初始化狀態機
  useEffect(() => {
    if (!servicesInitialized) {
      console.log('⏳ [AppStateProvider] 等待服務層初始化...')
      return
    }

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

        // 初始化狀態機並註冊副作用處理器
        const smManager = new StateMachineManager({
          currentState: initialAppData.state,
          isRecording: initialAppData.isRecording,
          transcriptCount: initialAppData.transcriptEntries.length,
          session: initialAppData.session || null,
          error: null
        });

        // 取得服務實例
        const sessionService = serviceContainer.resolve<ISessionService>(SERVICE_KEYS.SESSION_SERVICE)
        const recordingService = serviceContainer.resolve<IRecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
        const transcriptService = serviceContainer.resolve<ITranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)

        // 註冊副作用處理器 - CREATE_SESSION
        smManager.registerSideEffectHandler('CREATE_SESSION', {
          handleSideEffect: async (effect) => {
            console.log('🏗️ [副作用] CREATE_SESSION: 建立會話', effect);

            try {
              if (effect.type === 'CREATE_SESSION') {
                // 修復：建立會話前先檢查現有活躍會話
                console.log('🔍 [副作用] CREATE_SESSION: 檢查現有活躍會話')
                const existingSession = await sessionService.checkActiveSession()

                if (existingSession) {
                  console.log('⚠️ [副作用] CREATE_SESSION: 發現現有活躍會話，嘗試自動清理', {
                    existingSessionId: existingSession.id,
                    status: existingSession.status,
                    type: existingSession.type
                  })

                  try {
                    // 嘗試刪除現有活躍會話
                    await sessionService.deleteSession(existingSession.id)
                    console.log('✅ [副作用] CREATE_SESSION: 成功清理現有會話', existingSession.id)
                  } catch (cleanupError) {
                    console.warn('⚠️ [副作用] CREATE_SESSION: 清理現有會話失敗，繼續嘗試創建', cleanupError)
                  }
                }

                const sessionData = await sessionService.createRecordingSession(
                  effect.title || `錄音筆記 ${new Date().toLocaleString()}`
                )

                // 新增：等待會話在資料庫中完全可見
                const isReady = await sessionService.waitForSessionReady(sessionData.id)

                if (!isReady) {
                  throw new Error('會話創建超時，無法確認會話狀態')
                }

                // 更新 Context 狀態
                dispatch({
                  type: "SET_SESSION",
                  payload: {
                    id: sessionData.id,
                    status: sessionData.status as SessionStatus,
                    type: effect.sessionType
                  }
                })

                console.log('✅ [副作用] CREATE_SESSION 完成:', sessionData.id)

                // 移除 setTimeout，改為同步觸發 SESSION_CREATED 轉換
                if (stateMachineManager) {
                  stateMachineManager.getStateMachine().transition('SESSION_CREATED')
                }
              }
            } catch (error) {
              console.error('❌ [副作用] CREATE_SESSION 失敗:', error)

              // 修復：提供更明確的錯誤訊息
              let errorMessage = '建立會話失敗'
              if (error instanceof Error) {
                if (error.message.includes('409') || error.message.includes('衝突')) {
                  errorMessage = '會話衝突：請重新整理頁面後再試，或聯繫技術支援'
                } else if (error.message.includes('超時')) {
                  errorMessage = '會話創建超時：請檢查網路連接後重試'
                }
              }

              dispatch({ type: "SET_ERROR", payload: errorMessage })

              // 修復：確保清理 session 狀態
              dispatch({ type: "SET_SESSION", payload: null })

              // 移除 setTimeout，改為同步觸發錯誤轉換
              if (stateMachineManager) {
                stateMachineManager.getStateMachine().transition('ERROR_OCCURRED')
              }
            }
          }
        });



        // 註冊副作用處理器 - START_RECORDING
        smManager.registerSideEffectHandler('START_RECORDING', {
          handleSideEffect: async (effect) => {
            console.log('🎤 [副作用] START_RECORDING: 開始錄音', effect);

            try {
              const currentSession = smManager.getStateMachine().getContext().session
              if (!currentSession) {
                throw new Error('沒有活躍的會話')
              }

              await recordingService.startRecording(currentSession.id)

              // 更新錄音狀態
              dispatch({ type: "SET_RECORDING", payload: true })

              console.log('✅ [副作用] START_RECORDING 完成')
            } catch (error) {
              console.error('❌ [副作用] START_RECORDING 失敗:', error)
              dispatch({ type: "SET_ERROR", payload: '開始錄音失敗' })

              // 觸發錯誤轉換
              setTimeout(() => {
                if (stateMachineManager) {
                  stateMachineManager.getStateMachine().transition('ERROR_OCCURRED')
                }
              }, 100)
            }
          }
        });

        // 註冊副作用處理器 - CONNECT_WEBSOCKET
        smManager.registerSideEffectHandler('CONNECT_WEBSOCKET', {
          handleSideEffect: async (effect) => {
            console.log('🔌 [副作用] CONNECT_WEBSOCKET: 連接 WebSocket', effect);

            try {
              const currentSession = smManager.getStateMachine().getContext().session
              if (!currentSession) {
                throw new Error('沒有活躍的會話')
              }

              // 修復：添加連接超時處理
              const WEBSOCKET_TIMEOUT = 10000; // 10秒超時

              const connectionPromise = async () => {
                // 新增：WebSocket 連接前會話狀態預檢
                console.log('🔍 [副作用] CONNECT_WEBSOCKET: 開始會話狀態預檢', currentSession.id)

                const activeSession = await sessionService.checkActiveSession()
                if (!activeSession) {
                  throw new Error(`會話狀態預檢失敗：沒有活躍的會話`)
                }

                if (activeSession.id !== currentSession.id) {
                  throw new Error(`會話狀態預檢失敗：活躍會話 ${activeSession.id} 與期望的會話 ${currentSession.id} 不匹配`)
                }

                if (activeSession.status !== 'active') {
                  throw new Error(`會話狀態預檢失敗：會話 ${activeSession.id} 狀態為 ${activeSession.status}，期望為 active`)
                }

                if (activeSession.type !== 'recording') {
                  throw new Error(`會話狀態預檢失敗：會話 ${activeSession.id} 類型為 ${activeSession.type}，期望為 recording`)
                }

                console.log('✅ [副作用] CONNECT_WEBSOCKET: 會話狀態預檢通過', {
                  sessionId: activeSession.id,
                  status: activeSession.status,
                  type: activeSession.type
                })

                // 連接並添加監聽器 - 使用預檢通過的會話 ID
                await transcriptService.connect(activeSession.id)

                return activeSession
              }

              // 修復：使用 Promise.race 實現超時機制
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('WebSocket 連接超時')), WEBSOCKET_TIMEOUT)
              })

              const activeSession = await Promise.race([connectionPromise(), timeoutPromise])

              // 添加逐字稿監聽器
              const handleTranscript = (message: TranscriptMessage) => {
                if (message.type === 'transcript_segment' && message.text) {
                  const startTime = message.start_time ?? 0
                  const hours = Math.floor(startTime / 3600)
                  const minutes = Math.floor((startTime % 3600) / 60)
                  const seconds = Math.floor(startTime % 60)
                  const timeStr = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

                  // 添加逐字稿到 Context
                  dispatch({
                    type: "ADD_TRANSCRIPT_ENTRY",
                    payload: {
                      time: timeStr,
                      text: message.text
                    }
                  })

                  // 如果是第一個逐字稿，觸發轉換
                  const currentContext = smManager.getStateMachine().getContext()
                  if (currentContext.transcriptCount === 0) {
                    setTimeout(() => {
                      smManager.getStateMachine().transition('FIRST_TRANSCRIPT_RECEIVED')
                    }, 100)
                  }
                } else if (message.type === 'transcript_complete') {
                  // 轉錄完成
                  setTimeout(() => {
                    smManager.getStateMachine().transition('PROCESSING_COMPLETED')
                  }, 100)
                } else if (message.type === 'error') {
                  console.error('🚨 [副作用] 逐字稿錯誤:', message)
                  dispatch({ type: "SET_ERROR", payload: '逐字稿處理錯誤' })

                  setTimeout(() => {
                    smManager.getStateMachine().transition('ERROR_OCCURRED')
                  }, 100)
                }
              }

              transcriptService.addTranscriptListener(activeSession.id, handleTranscript)

              console.log('✅ [副作用] CONNECT_WEBSOCKET 完成')
            } catch (error: unknown) {
              console.error('❌ [副作用] CONNECT_WEBSOCKET 失敗:', error)

              // 區分不同類型的錯誤提供明確的錯誤訊息
              let errorMessage = '連接逐字稿服務失敗'
              if (error instanceof Error) {
                if (error.message.includes('會話狀態預檢失敗')) {
                  errorMessage = '會話狀態驗證失敗'
                } else if (error.message.includes('沒有活躍的會話')) {
                  errorMessage = '沒有可用的會話'
                } else if (error.message.includes('WebSocket 連接超時')) {
                  errorMessage = 'WebSocket 連接超時，請檢查網路連接'
                }
              }

              dispatch({ type: "SET_ERROR", payload: errorMessage })

              setTimeout(() => {
                if (stateMachineManager) {
                  stateMachineManager.getStateMachine().transition('ERROR_OCCURRED')
                }
              }, 100)
            }
          }
        });



        // 註冊副作用處理器 - STOP_RECORDING
        smManager.registerSideEffectHandler('STOP_RECORDING', {
          handleSideEffect: async (effect) => {
            console.log('🛑 [副作用] STOP_RECORDING: 停止錄音', effect);

            try {
              await recordingService.stopRecording()

              // 更新錄音狀態
              dispatch({ type: "SET_RECORDING", payload: false })
              dispatch({ type: "SET_RECORDING_TIME", payload: 0 })

              console.log('✅ [副作用] STOP_RECORDING 完成')
            } catch (error) {
              console.error('❌ [副作用] STOP_RECORDING 失敗:', error)
              dispatch({ type: "SET_ERROR", payload: '停止錄音失敗' })
            }
          }
        });

        // 註冊副作用處理器 - DISCONNECT_WEBSOCKET
        smManager.registerSideEffectHandler('DISCONNECT_WEBSOCKET', {
          handleSideEffect: async (effect) => {
            console.log('🔌 [副作用] DISCONNECT_WEBSOCKET: 斷開 WebSocket', effect);

            try {
              const currentSession = smManager.getStateMachine().getContext().session
              if (currentSession) {
                await transcriptService.disconnect(currentSession.id)
              }

              console.log('✅ [副作用] DISCONNECT_WEBSOCKET 完成')
            } catch (error) {
              console.error('❌ [副作用] DISCONNECT_WEBSOCKET 失敗:', error)
            }
          }
        });

        // 註冊副作用處理器 - FINISH_SESSION
        smManager.registerSideEffectHandler('FINISH_SESSION', {
          handleSideEffect: async (effect) => {
            console.log('✅ [副作用] FINISH_SESSION: 完成會話', effect);

            try {
              const currentSession = smManager.getStateMachine().getContext().session
              if (currentSession) {
                await sessionService.finishSession(currentSession.id)

                // 更新會話狀態
                dispatch({
                  type: "UPDATE_SESSION_STATUS",
                  payload: "completed" as SessionStatus
                })
              }

              console.log('✅ [副作用] FINISH_SESSION 完成')
            } catch (error) {
              console.error('❌ [副作用] FINISH_SESSION 失敗:', error)
              dispatch({ type: "SET_ERROR", payload: '完成會話失敗' })
            }
          }
        });

        // 註冊副作用處理器 - CLEAR_TRANSCRIPTS
        smManager.registerSideEffectHandler('CLEAR_TRANSCRIPTS', {
          handleSideEffect: (effect) => {
            console.log('🧹 [副作用] CLEAR_TRANSCRIPTS: 清除逐字稿', effect);
            dispatch({ type: "SET_TRANSCRIPT_ENTRIES", payload: [] })
          }
        });

        // 註冊副作用處理器 - SAVE_DRAFT
        smManager.registerSideEffectHandler('SAVE_DRAFT', {
          handleSideEffect: (effect) => {
            console.log('💾 [副作用] SAVE_DRAFT: 儲存草稿', effect);
            // 當前已有自動儲存機制，這裡可以觸發立即儲存
          }
        });

        // 註冊副作用處理器 - SHOW_ERROR
        smManager.registerSideEffectHandler('SHOW_ERROR', {
          handleSideEffect: (effect) => {
            console.log('🚨 [副作用] SHOW_ERROR: 顯示錯誤', effect);
            if (effect.type === 'SHOW_ERROR') {
              dispatch({ type: "SET_ERROR", payload: effect.message })
            }
          }
        });

        // 修復：新增 ERROR_CLEANUP 副作用處理器，確保錯誤時狀態完全重置
        smManager.registerSideEffectHandler('ERROR_CLEANUP', {
          handleSideEffect: (effect) => {
            console.log('🧹 [副作用] ERROR_CLEANUP: 清理錯誤狀態', effect);

            // 清理所有相關狀態
            dispatch({ type: "SET_SESSION", payload: null })
            dispatch({ type: "SET_RECORDING", payload: false })
            dispatch({ type: "SET_RECORDING_TIME", payload: 0 })

            console.log('✅ [副作用] ERROR_CLEANUP: 狀態清理完成')
          }
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
  }, [servicesInitialized])

  // 錄音時間追蹤
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null

    if (state.appData.isRecording && servicesInitialized) {
      intervalId = setInterval(() => {
        const recordingService = serviceContainer.resolve<IRecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
        console.log('Context instance', recordingService)
        const recordingTime = recordingService.getRecordingTime()
        dispatch({ type: "SET_RECORDING_TIME", payload: recordingTime })
      }, 1000)
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [state.appData.isRecording, servicesInitialized])

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
