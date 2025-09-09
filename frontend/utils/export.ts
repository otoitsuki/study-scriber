import { toast } from '@/hooks/use-toast'

export async function downloadZip(sessionId: string, editorContent: string) {
    try {
        const exportUrl = '/api/notes/export'
        console.log('準備匯出:', { sessionId, contentLength: editorContent.length, url: exportUrl });
        // 先測試後端是否可以連接
        try {
            const healthCheck = await fetch('/health');
            console.log('後端健康檢查:', healthCheck.ok);
        } catch (e) {
            console.error('無法連接到後端:', e);
        }
        const response = await fetch(exportUrl, {
            method: 'POST',
            mode: 'cors',  // 明確指定 CORS 模式
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                session_id: sessionId,
                note_content: editorContent,
            }),
        });
        console.log('API 回應狀態:', response.status);
        if (!response.ok) {
            let errorMessage = 'Export failed';
            try {
                const errorData = await response.json();
                console.error('API 錯誤詳情:', errorData);
                errorMessage = errorData.detail || errorMessage;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        // ---- 處理成功回應 ----
        // 1️⃣ 取得檔名：先讀取後端 Content-Disposition，如果沒有就回退舊格式
        const disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition');
        let filename = `note_${sessionId}_${new Date().toISOString().split('T')[0]}.zip`;
        if (disposition) {
            const match = disposition.match(/filename\s*=\s*"?([^";]+)"?/i);
            if (match && match[1]) {
                filename = match[1];
            }
        }

        const blob = await response.blob();
        console.log('收到檔案:', blob.size, 'bytes', 'filename:', filename);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
        return { success: true };
    } catch (error) {
        console.error('Export error:', error);
        toast({ title: '匯出失敗，請稍後重試', variant: 'destructive' });
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Export failed'
        };
    }
}
