"use client"

import { useCallback, useEffect, useState, useRef } from "react"
import { useAppStateContext } from "./use-app-state-context"
import { useSession } from "./use-session-adapter"
import { useRecording } from "./use-recording-adapter"
import { useNotes } from "./use-notes"
import { useTranscript } from "./use-transcript-adapter"
import { useToast } from "@/components/ui/use-toast"
import type { AppData } from "../types/app-state"
import { StateMachineManager } from '../lib/state-machine';

/**
 * 新版本的 useAppState Hook
 * 使用 Context 狀態管理，大幅簡化原本 868 行的複雜邏輯
 * 將狀態管理委託給 AppStateContext，Hook 只負責業務邏輯
 */
export function useAppStateNew() {
  const context = useAppStateContext()
  const { appData, isLoading, error, dispatch, transition } = context
  const session = useSession()
  const recording = useRecording()
  const notes = useNotes()
  const transcript = useTranscript()
  const { toast } = useToast()

  console.log('🔄 [useAppStateNew] Hook 初始化:', {
    currentState: appData.state,
    isRecording: appData.isRecording,
    sessionId: appData.session?.id,
    transcriptCount: appData.transcriptEntries.length
  })

  const [stateMachineManager] = useState(() => {
    const smManager = new StateMachineManager({
      currentState: appData.state,
      isRecording: appData.isRecording,
      transcriptCount: appData.transcriptEntries.length,
      session: appData.session || null,
      error: error,
    });

    // 立即註冊副作用處理器
    smManager.registerSideEffectHandler('CREATE_SESSION', {
      handleSideEffect: async (effect) => {
        console.log('🏗️ [副作用] CREATE_SESSION: 建立會話', effect);
        // 從狀態機上下文獲取標題
        const context = smManager.getStateMachine().getContext();
        const title = context.pendingSessionTitle || 'New Recording';
        const newSession = await session.createRecordingSession(title, appData.editorContent);
        if (newSession) {
          dispatch({ type: 'SET_SESSION', payload: newSession });
          // 更新狀態機上下文
          smManager.getStateMachine().updateContext({
            currentState: appData.state,
            isRecording: appData.isRecording,
            transcriptCount: appData.transcriptEntries.length,
            session: newSession,
            error: error,
            pendingSessionTitle: undefined, // 清除待建立會話標題
          });
          localStorage.removeItem('draft_note');
        } else {
          throw new Error('無法建立錄音會話');
        }
      }
    });
    smManager.registerSideEffectHandler('START_RECORDING', {
      handleSideEffect: async () => {
        // 從狀態機上下文獲取最新的 session 資訊
        const context = smManager.getStateMachine().getContext();
        if (context.session?.id) {
          console.log('🎤 [副作用] START_RECORDING: 開始錄音', context.session.id);
          await recording.startRecording(context.session.id);
        } else {
          console.error('🎤 [副作用] START_RECORDING: 沒有可用的 session');
        }
      }
    });
    smManager.registerSideEffectHandler('STOP_RECORDING', {
      handleSideEffect: async () => {
        await stopRecording();
      }
    });
    smManager.registerSideEffectHandler('CONNECT_WEBSOCKET', {
      handleSideEffect: async () => {
        // 從狀態機上下文獲取最新的 session 資訊
        const context = smManager.getStateMachine().getContext();
        if (context.session?.id) {
          console.log('🔌 [副作用] CONNECT_WEBSOCKET: 連接 WebSocket', context.session.id);
          await transcript.connect(context.session.id);
        } else {
          console.error('🔌 [副作用] CONNECT_WEBSOCKET: 沒有可用的 session');
        }
      }
    });
    smManager.registerSideEffectHandler('DISCONNECT_WEBSOCKET', {
      handleSideEffect: () => {
        transcript.disconnect();
      }
    });
    smManager.registerSideEffectHandler('FINISH_SESSION', {
      handleSideEffect: async () => {
        await finishSession();
      }
    });

    return smManager;
  });

  useEffect(() => {
    stateMachineManager.getStateMachine().updateContext({
      currentState: appData.state,
      isRecording: appData.isRecording,
      transcriptCount: appData.transcriptEntries.length,
      session: appData.session,
      error: error,
    });
  }, [appData, error, stateMachineManager]);

  // 建立純筆記會話
  const createNoteSession = useCallback(async (title: string) => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      const newSession = await session.createNoteSession(title)
      if (newSession) {
        dispatch({ type: 'SET_SESSION', payload: newSession })

        // 載入筆記內容
        await notes.loadNote(newSession.id)

        // 清除本地草稿
        localStorage.removeItem('draft_note')

        console.log('✅ [useAppStateNew] 純筆記會話建立成功')

        toast({
          title: '筆記會話已建立',
          description: `會話 "${title}" 建立成功`,
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '建立筆記會話失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 建立筆記會話失敗:', err)

      toast({
        title: '建立失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, notes, toast, dispatch])

  // 建立錄音會話
  const createRecordingSession = useCallback(async (title: string) => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      const newSession = await session.createRecordingSession(title, appData.editorContent)
      if (newSession) {
        dispatch({ type: 'SET_SESSION', payload: newSession })

        // 載入筆記內容
        await notes.loadNote(newSession.id)

        // 清除本地草稿
        localStorage.removeItem('draft_note')

        console.log('✅ [useAppStateNew] 錄音會話建立成功')

        toast({
          title: '錄音會話已建立',
          description: `會話 "${title}" 建立成功`,
        })
      }
    } catch (err) {
      // 特別處理會話衝突錯誤
      if (err instanceof Error && err.message.includes('檢測到活躍會話衝突')) {
        const conflictMsg = '偵測到會話衝突，請重新整理頁面後再試'
        dispatch({ type: 'SET_ERROR', payload: conflictMsg })

        toast({
          title: '會話衝突',
          description: '目前已有活躍會話，請重新整理頁面後再試，或等待當前會話結束',
          variant: 'destructive'
        })
        return
      }

      const errorMessage = err instanceof Error ? err.message : '建立錄音會話失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 建立錄音會話失敗:', err)

      toast({
        title: '建立失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, notes, toast, dispatch, appData.editorContent])

  // 開始錄音 - 完全委託給狀態機
  const startRecording = useCallback(async (title: string) => {
    console.log("🎤 [useAppStateNew] startRecording: 觸發狀態機")
    dispatch({ type: 'SET_LOADING', payload: true })

    try {
      // 檢查是否有現有會話需要處理
      const latestActiveSession = await session.checkActiveSession()
      const currentSession = latestActiveSession || session.currentSession

      // 更新狀態機上下文，包含待建立會話的標題
      stateMachineManager.getStateMachine().updateContext({
        currentState: appData.state,
        isRecording: appData.isRecording,
        transcriptCount: appData.transcriptEntries.length,
        session: currentSession,
        error: error,
        pendingSessionTitle: title,  // 傳遞標題給狀態機
      });

      if (currentSession?.type === 'note_only') {
        // 升級現有會話
        console.log("🎤 [useAppStateNew] 升級現有會話為錄音模式")
        const upgradedSession = await session.upgradeToRecording()
        if (upgradedSession) {
          dispatch({ type: 'SET_SESSION', payload: upgradedSession })
          // 再次更新狀態機上下文
          stateMachineManager.getStateMachine().updateContext({
            currentState: appData.state,
            isRecording: appData.isRecording,
            transcriptCount: appData.transcriptEntries.length,
            session: upgradedSession,
            error: error,
            pendingSessionTitle: title,
          });
        }
      }

      // 觸發狀態轉換 - 讓狀態機處理所有邏輯
      const result = transition('USER_START_RECORDING');

      if (!result?.success) {
        throw new Error(result?.error || '狀態轉換失敗');
      }

      console.log("🎤 [useAppStateNew] 狀態機處理完成")
      toast({ title: '錄音開始' })

    } catch (err) {
      const msg = err instanceof Error ? err.message : '開始錄音失敗'
      dispatch({ type: 'SET_ERROR', payload: msg })

      console.error("🎤 [useAppStateNew] 錄音失敗:", msg)
      toast({ title: '錄音失敗', description: msg, variant: 'destructive' })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, toast, dispatch, transition, stateMachineManager, appData.state, appData.isRecording, appData.transcriptEntries, error])

  // 升級會話為錄音模式
  const upgradeToRecording = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      const updatedSession = await session.upgradeToRecording()
      if (updatedSession) {
        dispatch({ type: 'SET_SESSION', payload: updatedSession })

        console.log('✅ [useAppStateNew] 會話升級為錄音模式成功')

        toast({
          title: '升級成功',
          description: '會話已升級為錄音模式',
        })
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '升級會話失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 升級會話失敗:', err)

      toast({
        title: '升級失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, toast, dispatch])

  // 停止錄音
  const stopRecording = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      await recording.stopRecording()
      transcript.disconnect()

      // 觸發狀態轉換
      transition('USER_STOP_RECORDING');

      console.log('✅ [useAppStateNew] 錄音停止，開始處理逐字稿')

      toast({
        title: '處理中',
        description: '正在處理錄音內容，請稍候...',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '停止錄音失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 停止錄音失敗:', err)

      toast({
        title: '停止失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [recording, transcript, toast, dispatch, transition])

  // 完成會話
  const finishSession = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      await session.finishSession()
      // 在這裡不需要觸發狀態轉換，因為 stopRecording 已經處理了
      // dispatch({ type: 'SET_APP_STATE', payload: 'finished' })

      console.log('✅ [useAppStateNew] 會話完成')

      toast({
        title: '會話完成',
        description: '您可以匯出筆記或開始新的筆記',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '完成會話失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 完成會話失敗:', err)

      toast({
        title: '完成失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, toast, dispatch])

  // 開新筆記
  const newNote = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true })
    dispatch({ type: 'CLEAR_ERROR' })

    try {
      // 如果有活躍會話，先刪除它
      if (session.currentSession) {
        console.log('🗑️ [useAppStateNew] 刪除當前活躍會話:', session.currentSession.id)
        await session.deleteSession()
      }

      // 觸發狀態轉換
      transition('USER_NEW_NOTE');

      // 重置所有狀態
      dispatch({ type: 'RESET_STATE' })

      // 清除相關狀態
      recording.clearTranscripts()
      transcript.clearTranscripts()
      notes.clearNote()

      // 清除本地草稿
      localStorage.removeItem('draft_note')

      console.log('🔄 [useAppStateNew] 已開始新筆記')

      toast({
        title: '新筆記',
        description: '已清空內容，可以開始新的筆記',
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '開始新筆記失敗'
      dispatch({ type: 'SET_ERROR', payload: errorMessage })

      console.error('❌ [useAppStateNew] 開始新筆記失敗:', err)

      toast({
        title: '操作失敗',
        description: errorMessage,
        variant: 'destructive',
      })
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false })
    }
  }, [session, recording, transcript, notes, toast, dispatch, transition])

  // 自動儲存筆記內容到本地草稿
  const saveLocalDraft = useCallback((content: string) => {
    if (!session.currentSession && content.trim()) {
      localStorage.setItem('draft_note', content)
    }
    dispatch({ type: 'SET_EDITOR_CONTENT', payload: content })
  }, [session.currentSession, dispatch])

  // 使用 useCallback 來記憶函數
  const createRecordingSessionCallback = useCallback(createRecordingSession, [session, notes, toast, dispatch, appData.editorContent]);
  const startRecordingCallback = useCallback(startRecording, [session, recording, toast, dispatch, appData.editorContent, transition]);
  const stopRecordingCallback = useCallback(stopRecording, [recording, transcript, toast, dispatch, transition]);
  const finishSessionCallback = useCallback(finishSession, [session, toast, dispatch]);
  const connectTranscriptCallback = useCallback(transcript.connect, [transcript]);
  const disconnectTranscriptCallback = useCallback(transcript.disconnect, [transcript]);

  return {
    // 應用狀態（向後相容）
    appData,
    isLoading,
    error,

    // 會話管理
    createNoteSession,
    createRecordingSession,
    upgradeToRecording,
    finishSession,
    newNote,

    // 錄音控制
    startRecording,
    stopRecording,

    // 本地草稿
    saveLocalDraft,

    // 外部狀態（向後相容）
    session: session.currentSession,
    sessionLoading: session.isLoading,
    sessionError: session.error,

    // 錄音狀態
    recordingError: recording.error,

    // 逐字稿狀態
    transcriptConnected: transcript.isConnected,
    transcriptError: transcript.error,
    transcriptAutoScroll: transcript.autoScrollEnabled,
    enableAutoScroll: transcript.enableAutoScroll,
    disableAutoScroll: transcript.disableAutoScroll,
    scrollToLatest: transcript.scrollToLatest,
  }
}
