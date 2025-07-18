"use client"

import { useState } from 'react'
import { downloadZip } from '@/utils/export'
import { notesAPI } from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

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
        <Button
            onClick={handleExport}
            disabled={busy}
            className="flex items-center gap-2"
        >
            {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <Download className="w-4 h-4" />
            )}
            Export&nbsp;ZIP
        </Button>
    )
}
