import { toast } from '@/hooks/use-toast'

export async function downloadZip(sid: string) {
    try {
        const res = await fetch(`/api/export/${sid}?type=zip`)
        if (!res.ok) {
            toast({ title: `Export failed: ${res.statusText}`, variant: 'destructive' })
            return
        }
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)

        const a = document.createElement('a')
        a.href = url
        a.download = `${sid}.zip`
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1_000)
        toast({ title: 'Export started', variant: 'default' })
    } catch (err) {
        console.error(err)
        toast({ title: 'Network error when exporting', variant: 'destructive' })
    }
}
