"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { transcriptManager, TranscriptMessage } from '../lib/transcript-manager'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'

interface UseTranscriptNewReturn {
    transcripts: TranscriptMessage[]
    isConnected: boolean
    isCompleted: boolean
    error: string | null
    connect: (sessionId: string) => Promise<void>
    disconnect: () => void
    clearTranscripts: () => void
    // 自動捲動功能
    autoScrollEnabled: boolean
    enableAutoScroll: () => void
    disableAutoScroll: () => void
    scrollToLatest: () => void
    setScrollContainer: (element: HTMLElement | null) => void
}

export function useTranscriptNew(): UseTranscriptNewReturn {
    // 使用新的 Context 狀態管理
    const context = useAppStateContext()

    // 本地狀態（保持 TranscriptManager 獨立性，避免影響 WebSocket 重連機制）
    const [isConnected, setIsConnected] = useState(false)
    const [isCompleted, setIsCompleted] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

    const containerRef = useRef<HTMLElement | null>(null)
    const currentSessionIdRef = useRef<string | null>(null)

    console.log('🔄 [useTranscriptNew] Hook 初始化', {
        useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
        useNewTranscriptHook: isFeatureEnabled('useNewTranscriptHook'),
        contextTranscriptCount: context.appData.transcriptEntries.length,
    })

    // 處理逐字稿接收與合併邏輯 - 整合 Context
    const handleTranscript = useCallback((transcript: TranscriptMessage) => {
        if (transcript.type === 'transcript_complete') {
            setIsCompleted(true)
            return
        }

        const anyMessage = transcript as any
        if (anyMessage.type === 'error') {
            const errorMessage = anyMessage.error_message || '轉錄過程中發生錯誤'
            setLocalError(errorMessage)
            context.setError(errorMessage)
            return
        }

        if (transcript.type === 'transcript_segment' && transcript.text) {
            const startTime = transcript.start_time ?? 0
            const minutes = Math.floor(startTime / 60)
            const seconds = Math.floor(startTime % 60)
            const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

            context.addTranscriptEntry({
                time: timeStr,
                text: transcript.text,
            })
        }
    }, [context])

    // 自動捲動功能
    const scrollToLatest = useCallback(() => {
        if (containerRef.current && autoScrollEnabled) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight
        }
    }, [autoScrollEnabled])

    // 檢測使用者滾動 - 離底部 >60px 時禁用自動捲動
    const handleScroll = useCallback((event: Event) => {
        const container = event.target as HTMLElement
        if (!container) return

        const { scrollTop, scrollHeight, clientHeight } = container
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight

        if (distanceFromBottom > 60) {
            setAutoScrollEnabled(false)
        } else if (distanceFromBottom <= 10) {
            setAutoScrollEnabled(true)
        }
    }, [])

    // 設定自動捲動容器
    const setScrollContainer = useCallback((element: HTMLElement | null) => {
        if (containerRef.current) {
            containerRef.current.removeEventListener('scroll', handleScroll)
        }

        containerRef.current = element

        if (element) {
            element.addEventListener('scroll', handleScroll)
        }
    }, [handleScroll])

    // 啟用自動捲動
    const enableAutoScroll = useCallback(() => {
        setAutoScrollEnabled(true)
        scrollToLatest()
    }, [scrollToLatest])

    // 禁用自動捲動
    const disableAutoScroll = useCallback(() => {
        setAutoScrollEnabled(false)
    }, [])

    // 連接 TranscriptManager - 保持原有重連機制
    const connect = useCallback(async (sessionId: string): Promise<void> => {
        try {
            setLocalError(null)
            context.setError(null)
            setIsCompleted(false)

            if (currentSessionIdRef.current) {
                transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
            }

            await transcriptManager.connect(sessionId)
            transcriptManager.addListener(sessionId, handleTranscript)

            currentSessionIdRef.current = sessionId
            setIsConnected(transcriptManager.isConnected(sessionId))

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '連接逐字稿服務失敗'
            setLocalError(errorMessage)
            context.setError(errorMessage)
            setIsConnected(false)
        }
    }, [handleTranscript, context])

    // 斷開連接 - 保持 TranscriptManager 的獨立性
    const disconnect = useCallback(() => {
        if (currentSessionIdRef.current) {
            transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
            // 注意：不呼叫 transcriptManager.disconnect，因為其他組件可能還在使用
            currentSessionIdRef.current = null
        }

        setIsConnected(false)
    }, [handleTranscript])

    // 清空逐字稿 - 使用 Context
    const clearTranscripts = useCallback(() => {
        context.setTranscriptEntries([])
        setIsCompleted(false)
    }, [context])

    // 自動捲動效果
    useEffect(() => {
        if (context.appData.transcriptEntries.length > 0) {
            scrollToLatest()
        }
    }, [context.appData.transcriptEntries, scrollToLatest])

    // 清理資源
    useEffect(() => {
        return () => {
            if (currentSessionIdRef.current) {
                transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
            }

            if (containerRef.current) {
                containerRef.current.removeEventListener('scroll', handleScroll)
            }
        }
    }, [handleTranscript, handleScroll])

    // 轉換 Context 中的 transcriptEntries 為 TranscriptMessage 格式（向後相容）
    const compatibleTranscripts: TranscriptMessage[] = context.appData.transcriptEntries.map((entry, index) => ({
        type: 'transcript_segment',
        text: entry.text,
        start_time: 0,
        end_time: 0,
        start_sequence: index,
        confidence: 1.0,
        timestamp: Date.now(),
    }))

    return {
        transcripts: compatibleTranscripts,
        isConnected,
        isCompleted,
        error: context.error || localError,
        connect,
        disconnect,
        clearTranscripts,
        autoScrollEnabled,
        enableAutoScroll,
        disableAutoScroll,
        scrollToLatest,
        setScrollContainer,
    }
}
