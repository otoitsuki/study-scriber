"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { notesAPI, type NoteUpdateRequest, type NoteResponse } from '../lib/api'
import { useLocalDraft } from './use-local-draft'

interface UseNotesReturn {
    noteContent: string
    lastSaved: Date | null
    isSaving: boolean
    error: string | null
    updateNote: (content: string) => void
    saveNote: (sessionId: string) => Promise<void>
    loadNote: (sessionId: string) => Promise<void>
    clearNote: () => void
    // 本地草稿相關
    hasDraft: boolean
    lastDraftTime: Date | null
    restoreDraft: () => void
    clearDraft: () => void
}

export function useNotes(): UseNotesReturn {
    const [noteContent, setNoteContent] = useState('')
    const [lastSaved, setLastSaved] = useState<Date | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const lastContentRef = useRef('')
    const currentSessionIdRef = useRef<string | null>(null)

    // 使用本地草稿功能
    const localDraft = useLocalDraft(currentSessionIdRef.current || undefined)

    // 清除自動儲存計時器
    const clearAutoSaveTimeout = useCallback(() => {
        if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current)
            autoSaveTimeoutRef.current = null
        }
    }, [])

    // 執行儲存操作
    const performSave = useCallback(async (sessionId: string, content: string): Promise<void> => {
        if (!content.trim() || content === lastContentRef.current) {
            return // 沒有變更，不需要儲存
        }

        setIsSaving(true)
        setError(null)

        try {
            const updateData: NoteUpdateRequest = {
                content,
                client_ts: new Date().toISOString()
            }

            await notesAPI.updateNote(sessionId, updateData)

            setLastSaved(new Date())
            lastContentRef.current = content
            console.log('✅ 筆記儲存成功')

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '儲存筆記失敗'
            setError(errorMessage)
            console.error('❌ 儲存筆記失敗:', err)
        } finally {
            setIsSaving(false)
        }
    }, [])

    // 手動儲存筆記
    const saveNote = useCallback(async (sessionId: string): Promise<void> => {
        clearAutoSaveTimeout()
        await performSave(sessionId, noteContent)
    }, [noteContent, performSave, clearAutoSaveTimeout])

    // 更新筆記內容（觸發自動儲存）
    const updateNote = useCallback((content: string): void => {
        setNoteContent(content)

        // 立即儲存本地草稿
        localDraft.saveDraft(content)

        // 如果有 session ID，設定自動儲存到伺服器
        if (currentSessionIdRef.current) {
            clearAutoSaveTimeout()

            // 10 秒後自動儲存到伺服器
            autoSaveTimeoutRef.current = setTimeout(() => {
                performSave(currentSessionIdRef.current!, content)
            }, 10000)
        }
    }, [performSave, clearAutoSaveTimeout, localDraft])

    // 載入筆記
    const loadNote = useCallback(async (sessionId: string): Promise<void> => {
        currentSessionIdRef.current = sessionId
        setError(null)

        try {
            const note = await notesAPI.getNote(sessionId)
            const serverContent = note.content
            const serverTimestamp = new Date(note.updated_at)

            // 檢查是否有較新的本地草稿
            if (localDraft.hasDraft && localDraft.isDraftNewer(serverTimestamp)) {
                console.log('⚠️ 發現較新的本地草稿，使用草稿內容')
                setNoteContent(localDraft.draftContent)
                lastContentRef.current = localDraft.draftContent
                // 不設定 lastSaved，因為草稿內容尚未同步到伺服器
            } else {
                setNoteContent(serverContent)
                lastContentRef.current = serverContent
                setLastSaved(serverTimestamp)
                // 清除過時的本地草稿
                localDraft.clearDraft()
            }

            console.log('✅ 筆記載入成功')

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : '載入筆記失敗'
            setError(errorMessage)
            console.error('❌ 載入筆記失敗:', err)

            // 如果筆記不存在，檢查是否有本地草稿
            if (errorMessage.includes('404') || errorMessage.includes('not found')) {
                if (localDraft.hasDraft) {
                    console.log('📝 使用本地草稿內容')
                    setNoteContent(localDraft.draftContent)
                } else {
                    setNoteContent('')
                }
                lastContentRef.current = ''
                console.log('🔄 初始化空筆記')
            }
        }
    }, [localDraft])

    // 清除筆記
    const clearNote = useCallback(() => {
        clearAutoSaveTimeout()
        setNoteContent('')
        setLastSaved(null)
        setError(null)
        lastContentRef.current = ''
        currentSessionIdRef.current = null
        localDraft.clearDraft()
        console.log('🔄 筆記已清除')
    }, [clearAutoSaveTimeout, localDraft])

    // 還原本地草稿
    const restoreDraft = useCallback(() => {
        const draftContent = localDraft.loadDraft()
        if (draftContent) {
            setNoteContent(draftContent)
            console.log('🔄 已還原本地草稿')
        }
    }, [localDraft])

    // 組件卸載時清理
    useEffect(() => {
        return () => {
            clearAutoSaveTimeout()
        }
    }, [clearAutoSaveTimeout])

    return useMemo(() => ({
        noteContent,
        lastSaved,
        isSaving,
        error,
        updateNote,
        saveNote,
        loadNote,
        clearNote,
        hasDraft: localDraft.hasDraft,
        lastDraftTime: localDraft.lastDraftTime,
        restoreDraft,
        clearDraft: localDraft.clearDraft,
    }), [
        noteContent,
        lastSaved,
        isSaving,
        error,
        updateNote,
        saveNote,
        loadNote,
        clearNote,
        localDraft.hasDraft,
        localDraft.lastDraftTime,
        restoreDraft,
        localDraft.clearDraft,
    ])
}
