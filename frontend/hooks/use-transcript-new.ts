"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppStateContext } from './use-app-state-context'
import { isFeatureEnabled } from '../lib/feature-flags'
import { SERVICE_KEYS, serviceContainer } from '../lib/services'
import type { ITranscriptService, TranscriptMessage } from '../lib/services'

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

/**
 * useTranscriptNew - 逐字稿管理 Hook (適配器層)
 *
 * 重構為適配器層：
 * - 內部調用 TranscriptService 而非直接使用 transcriptManager
 * - 保持對外接口完全不變，確保組件層無感知變更
 * - 保持 TranscriptManager 的獨立性和 WebSocket 重連機制
 */
export function useTranscriptNew(): UseTranscriptNewReturn {
    // 使用新的 Context 狀態管理
    const context = useAppStateContext()

    // 本地狀態（保持 TranscriptService 獨立性，避免影響 WebSocket 重連機制）
    const [isConnected, setIsConnected] = useState(false)
    const [isCompleted, setIsCompleted] = useState(false)
    const [localError, setLocalError] = useState<string | null>(null)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

    const containerRef = useRef<HTMLElement | null>(null)
    const currentSessionIdRef = useRef<string | null>(null)
    const transcriptServiceRef = useRef<ITranscriptService | null>(null)

    console.log('🔄 [useTranscriptNew] Hook 初始化 (適配器層)', {
        useNewStateManagement: isFeatureEnabled('useNewStateManagement'),
        useNewTranscriptHook: isFeatureEnabled('useNewTranscriptHook'),
        contextTranscriptCount: context.appData.transcriptEntries.length,
    })

    // 初始化服務實例
    const initializeService = useCallback(() => {
        if (!transcriptServiceRef.current) {
            try {
                transcriptServiceRef.current = serviceContainer.resolve<ITranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)
                console.log('✅ [useTranscriptNew] TranscriptService 初始化成功')
            } catch (error) {
                console.error('❌ [useTranscriptNew] 無法解析 TranscriptService:', error)
                throw new Error('逐字稿服務初始化失敗')
            }
        }
    }, [])

    // 處理逐字稿接收與合併邏輯 - 整合 Context
    const handleTranscript = useCallback((transcript: TranscriptMessage) => {
        if (transcript.type === 'transcript_complete') {
            setIsCompleted(true)
            // 觸發狀態轉換
            context.transition('PROCESSING_COMPLETED')
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

    // 連接 TranscriptService - 使用服務層
    const connect = useCallback(async (sessionId: string): Promise<void> => {
        try {
            setLocalError(null)
            context.setError(null)
            setIsCompleted(false)

            console.log('🔌 [useTranscriptNew] 連接逐字稿服務 (適配器層):', sessionId)

            // 初始化服務
            initializeService()
            const transcriptService = transcriptServiceRef.current!

            // 先移除之前的監聽器
            if (currentSessionIdRef.current) {
                transcriptService.removeTranscriptListener(currentSessionIdRef.current, handleTranscript)
            }

            // 使用服務層連接
            await transcriptService.connect(sessionId)
            transcriptService.addTranscriptListener(sessionId, handleTranscript)

            currentSessionIdRef.current = sessionId
            setIsConnected(transcriptService.isConnected(sessionId))

            console.log('✅ [useTranscriptNew] 逐字稿服務連接成功 (服務層):', sessionId)

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '連接逐字稿服務失敗'
            setLocalError(errorMessage)
            context.setError(errorMessage)
            setIsConnected(false)
            console.error('❌ [useTranscriptNew] 連接逐字稿服務失敗:', err)
        }
    }, [handleTranscript, context, initializeService])

    // 斷開連接 - 使用服務層
    const disconnect = useCallback(() => {
        console.log('🔌 [useTranscriptNew] 斷開逐字稿服務 (適配器層)')

        const transcriptService = transcriptServiceRef.current
        if (currentSessionIdRef.current && transcriptService) {
            transcriptService.removeTranscriptListener(currentSessionIdRef.current, handleTranscript)

            // 使用服務層斷開連接（如果有會話ID）
            transcriptService.disconnect(currentSessionIdRef.current)

            currentSessionIdRef.current = null
        }

        setIsConnected(false)
        console.log('✅ [useTranscriptNew] 逐字稿服務斷開成功 (服務層)')
    }, [handleTranscript])

    // 清空逐字稿 - 使用 Context
    const clearTranscripts = useCallback(() => {
        context.setTranscriptEntries([])
        setIsCompleted(false)
        console.log('🔄 [useTranscriptNew] 逐字稿已清除 (適配器層)')
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
            const transcriptService = transcriptServiceRef.current
            if (currentSessionIdRef.current && transcriptService) {
                transcriptService.removeTranscriptListener(currentSessionIdRef.current, handleTranscript)
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
