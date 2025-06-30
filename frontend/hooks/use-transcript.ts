"use client"

import { useState, useCallback, useRef, useEffect } from 'react'
import { transcriptManager, TranscriptMessage } from '../lib/transcript-manager'

interface UseTranscriptReturn {
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

export function useTranscript(): UseTranscriptReturn {
    const [transcripts, setTranscripts] = useState<TranscriptMessage[]>([])
    const [isConnected, setIsConnected] = useState(false)
    const [isCompleted, setIsCompleted] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)

    const containerRef = useRef<HTMLElement | null>(null)
    const currentSessionIdRef = useRef<string | null>(null)

    // 處理逐字稿接收與合併邏輯
    const handleTranscript = useCallback((transcript: TranscriptMessage) => {
        console.log('📝 [useTranscript] 收到逐字稿訊息:', {
            type: transcript.type,
            text: transcript.text,
            textLength: transcript.text?.length || 0,
            start_time: transcript.start_time,
            end_time: transcript.end_time,
            confidence: transcript.confidence,
            sessionId: currentSessionIdRef.current,
            currentTranscriptCount: transcripts.length,
            timestamp: new Date().toISOString()
        })

        // 處理轉錄完成通知
        if (transcript.type === 'transcript_complete' || transcript.message === 'transcription_complete') {
            console.log('✅ [useTranscript] 逐字稿轉錄完成，設定 isCompleted=true')
            setIsCompleted(true)
            return
        }

        // 處理轉錄錯誤 (需要類型轉換因為 TranscriptMessage 不包含錯誤類型)
        const anyMessage = transcript as any
        if (anyMessage.type === 'error' || anyMessage.type === 'transcription_error') {
            console.error('🚨 [useTranscript] 收到轉錄錯誤:', transcript)
            const errorMessage = anyMessage.error_message || anyMessage.details || '轉錄過程中發生錯誤'
            setError(errorMessage)
            return
        }

        // 只處理逐字稿片段類型的訊息
        if (transcript.type !== 'transcript_segment') {
            console.log('⚠️ [useTranscript] 跳過非逐字稿片段訊息:', transcript.type)
            return
        }

        if (!transcript.text) {
            console.log('⚠️ [useTranscript] 跳過空文字逐字稿')
            return
        }

        console.log('🔄 [useTranscript] 開始處理逐字稿片段...')

        setTranscripts((prev) => {
            console.log('📊 [useTranscript] 合併前狀態:', {
                existingCount: prev.length,
                newSegmentText: transcript.text,
                newSegmentTime: transcript.start_time
            })

            const newTranscripts = mergeSegments(prev, transcript)

            console.log('📊 [useTranscript] 合併後狀態:', {
                newCount: newTranscripts.length,
                countChange: newTranscripts.length - prev.length,
                lastSegmentText: newTranscripts[newTranscripts.length - 1]?.text?.substring(0, 50) + '...'
            })

            console.log(`✅ [useTranscript] 逐字稿更新完成: ${prev.length} → ${newTranscripts.length} 個片段`)
            return newTranscripts
        })
    }, [transcripts.length])

    // 逐字稿片段合併邏輯 - 禁用合併，確保每句話都有獨立時間戳
    const mergeSegments = useCallback((
        existingSegments: TranscriptMessage[],
        newSegment: TranscriptMessage
    ): TranscriptMessage[] => {
        // 禁用合併邏輯，直接添加新片段
        // 用戶要求：「一句話一個時間戳」，不要將逐字稿合併
        return [...existingSegments, newSegment]
    }, [])

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

    // 連接 TranscriptManager
    const connect = useCallback(async (sessionId: string): Promise<void> => {
        try {
            setError(null)
            setIsCompleted(false)

            // 移除舊的監聽器
            if (currentSessionIdRef.current) {
                transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
            }

            // 連接到新的 session
            await transcriptManager.connect(sessionId)
            transcriptManager.addListener(sessionId, handleTranscript)

            currentSessionIdRef.current = sessionId
            setIsConnected(transcriptManager.isConnected(sessionId))

            console.log('✅ use-transcript 連接成功，Session ID:', sessionId)

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '連接逐字稿服務失敗'
            setError(errorMessage)
            setIsConnected(false)
            console.error('❌ use-transcript 連接失敗:', err)
        }
    }, [handleTranscript])

    // 斷開連接
    const disconnect = useCallback(() => {
        if (currentSessionIdRef.current) {
            transcriptManager.removeListener(currentSessionIdRef.current, handleTranscript)
            // 注意：不呼叫 transcriptManager.disconnect，因為其他組件可能還在使用
            currentSessionIdRef.current = null
        }

        setIsConnected(false)
        console.log('🔌 use-transcript 斷開連接')
    }, [handleTranscript])

    // 清空逐字稿
    const clearTranscripts = useCallback(() => {
        setTranscripts([])
        setIsCompleted(false)
        console.log('🔄 use-transcript 逐字稿已清除')
    }, [])

    // 自動捲動效果
    useEffect(() => {
        if (transcripts.length > 0) {
            scrollToLatest()
        }
    }, [transcripts, scrollToLatest])

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

    return {
        transcripts,
        isConnected,
        isCompleted,
        error,
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
