"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'

interface DraftData {
    content: string;
}

interface UseLocalDraftReturn {
    draft: DraftData;
    hasDraft: boolean
    lastDraftTime: Date | null
    saveDraft: (data: Partial<DraftData>) => void
    loadDraft: () => DraftData | null
    clearDraft: () => void
    isDraftNewer: (serverTimestamp: Date) => boolean
}

const DRAFT_KEY = 'studyscriber_draft'

export function useLocalDraft(sessionId?: string): UseLocalDraftReturn {
    const [draft, setDraft] = useState<DraftData>({ content: '' })
    const [hasDraft, setHasDraft] = useState(false)
    const [lastDraftTime, setLastDraftTime] = useState<Date | null>(null)

    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const currentSessionRef = useRef<string | undefined>(sessionId)

    // 更新 session ID
    useEffect(() => {
        currentSessionRef.current = sessionId
    }, [sessionId])

    // 清除自動儲存計時器
    const clearAutoSaveTimeout = useCallback(() => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current)
            autoSaveTimeoutRef.current = null
        }
    }, [])

    // 從 localStorage 載入草稿
    const loadDraft = useCallback((): DraftData | null => {
        try {
            const draftJson = localStorage.getItem(DRAFT_KEY)
            if (!draftJson) {
                setHasDraft(false)
                return null
            }

            const parsed = JSON.parse(draftJson)
            const draftData: DraftData = {
                content: parsed.content || ''
            }
            const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : new Date()
            const storedSessionId = parsed.sessionId

            // 檢查草稿是否屬於當前會話（如果有指定會話）
            if (currentSessionRef.current && storedSessionId !== currentSessionRef.current) {
                console.log('📝 草稿屬於其他會話，不載入')
                return null
            }

            setDraft(draftData)
            setHasDraft(!!draftData.content.trim())
            setLastDraftTime(timestamp)

            console.log('📖 草稿已從本地載入')
            return draftData
        } catch (err) {
            console.error('❌ 載入草稿失敗:', err)
            return null
        }
    }, [])

    // 儲存草稿到 localStorage
    const saveDraft = useCallback((data: Partial<DraftData>) => {
        const now = new Date()

        // 取得目前的草稿內容，並與新的內容合併
        const currentDraft = { ...draft, ...data }

        if (!currentDraft.content.trim()) {
            // 空內容時清除草稿
            clearDraft()
            return
        }

        const draftDataToStore = {
            ...currentDraft,
            timestamp: now.toISOString(),
            sessionId: currentSessionRef.current || null,
        }

        try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draftDataToStore))
            setDraft(currentDraft)
            setHasDraft(true)
            setLastDraftTime(now)

            console.log('💾 草稿已儲存到本地:', currentDraft)
        } catch (err) {
            console.error('❌ 儲存草稿失敗:', err)
        }
    }, [draft]) // 依賴 draft 狀態

    // 清除草稿
    const clearDraft = useCallback(() => {
        clearAutoSaveTimeout()
        try {
            localStorage.removeItem(DRAFT_KEY)

            const clearedDraft = { content: '' }
            setDraft(clearedDraft)
            setHasDraft(false)
            setLastDraftTime(null)

            console.log('🗑️ 草稿已清除')
        } catch (err) {
            console.error('❌ 清除草稿失敗:', err)
        }
    }, [clearAutoSaveTimeout])

    // 判斷草稿是否比伺服器版本更新
    const isDraftNewer = useCallback((serverTimestamp: Date): boolean => {
        if (!lastDraftTime || !hasDraft) {
            return false
        }
        return lastDraftTime > serverTimestamp
    }, [lastDraftTime, hasDraft])

    // 自動儲存草稿（使用防抖動）
    const autoSaveDraft = useCallback((data: Partial<DraftData>) => {
        clearAutoSaveTimeout()

        // 500ms 防抖動，避免過於頻繁的儲存
        autoSaveTimeoutRef.current = setTimeout(() => {
            saveDraft(data)
        }, 500)
    }, [saveDraft, clearAutoSaveTimeout])

    // 初始化時載入草稿
    useEffect(() => {
        loadDraft()
    }, [loadDraft])

    // 組件卸載時清理
    useEffect(() => {
        return () => {
            clearAutoSaveTimeout()
        }
    }, [clearAutoSaveTimeout])

    return useMemo(() => ({
        draft,
        hasDraft,
        lastDraftTime,
        saveDraft: autoSaveDraft, // 使用防抖版本
        loadDraft,
        clearDraft,
        isDraftNewer,
    }), [
        draft,
        hasDraft,
        lastDraftTime,
        autoSaveDraft,
        loadDraft,
        clearDraft,
        isDraftNewer,
    ])
}
