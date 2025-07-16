import React from 'react'

export default function SessionLoadingOverlay() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-white/60 z-50">
            <div className="animate-spin rounded-full h-12 w-12 border-y-4 border-gray-400"></div>
            <p className="ml-4 text-gray-700">準備錄音會話中…</p>
        </div>
    )
}
