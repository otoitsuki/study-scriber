"use client"

import { useState } from 'react'
import { downloadZip } from '@/utils/export'
import { notesAPI } from '@/lib/api'
import { toast } from '@/hooks/use-toast'

interface Props {
    noteId: string
    noteContent: string
}

export default function ExportButton({ noteId, noteContent }: Props) {
    const [busy, setBusy] = useState(false)

    const handleExport = async () => {
        if (busy) return
        setBusy(true)

        try {
            // 1️⃣ 儲存筆記
            await notesAPI.updateNote(noteId, { content: noteContent })
            // 2️⃣ 下載 ZIP
            await downloadZip(noteId, noteContent)
        } catch (err) {
            console.error(err)
            toast({ title: '匯出失敗，請稍後重試', variant: 'destructive' })
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            className="btn btn-primary flex items-center gap-2"
            disabled={busy}
            onClick={handleExport}
        >
            {busy && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                        className="opacity-25"
                        cx="12" cy="12" r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4l3-3-3-3v4A8 8 8 0 104 12z"
                    />
                </svg>
            )}
            Export&nbsp;ZIP
        </button>
    )
}
