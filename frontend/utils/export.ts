import { toast } from '@/hooks/use-toast'

export async function downloadZip(sessionId: string, editorContent: string) {
    try {
        console.log('準備匯出:', {
            sessionId,
            contentLength: editorContent.length,
            url: 'http://localhost:8000/api/notes/export'
        });
        // 先測試後端是否可以連接
        try {
            const healthCheck = await fetch('http://localhost:8000/health');
            console.log('後端健康檢查:', healthCheck.ok);
        } catch (e) {
            console.error('無法連接到後端:', e);
        }
        const response = await fetch('http://localhost:8000/api/notes/export', {
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
        // 處理成功回應...
        const blob = await response.blob();
        console.log('收到檔案:', blob.size, 'bytes');
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `note_${sessionId}_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 100);
        return { success: true };
    } catch (error) {
        console.error('Export error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Export failed'
        };
    }
}
