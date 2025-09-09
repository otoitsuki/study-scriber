"use client"

import { useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { useAppState, useAppActions } from '../lib/app-store-zustand'

/**
 * 逐字稿除錯工具 - 專門用於診斷逐字稿顯示問題
 * 使用白色背景確保對比度
 */
export function TranscriptDebugger() {
    const [wsStatus, setWsStatus] = useState<string>('未知')
    const [backendHealth, setBackendHealth] = useState<any>(null)
    const [sttConfig, setSttConfig] = useState<any>(null)
    const appState = useAppState()
    const { addTranscriptEntry } = useAppActions()

    // 檢查 WebSocket 狀態
    const checkWebSocketStatus = () => {
        console.log('🔍 檢查 WebSocket 狀態...')
        
        // 檢查是否有錄音服務實例
        const recordingService = (window as any).currentRecordingFlowService
        if (recordingService) {
            console.log('✅ 找到 RecordingFlowService')
            const session = recordingService.getCurrentSession?.()
            if (session) {
                console.log('✅ 找到當前會話:', session.id)
                
                // 檢查 transcript service 連接狀態
                const transcriptService = (window as any).transcriptService
                if (transcriptService) {
                    const isConnected = transcriptService.isConnected?.(session.id)
                    setWsStatus(isConnected ? '已連接' : '未連接')
                    console.log('🔌 Transcript WebSocket 狀態:', isConnected ? '已連接' : '未連接')
                } else {
                    setWsStatus('TranscriptService 不存在')
                    console.log('❌ TranscriptService 不存在')
                }
            } else {
                setWsStatus('無活躍會話')
                console.log('❌ 無活躍會話')
            }
        } else {
            setWsStatus('RecordingFlowService 不存在')
            console.log('❌ RecordingFlowService 不存在')
        }
    }

    // 檢查後端健康狀態
    const checkBackendHealth = async () => {
        try {
            const response = await fetch('/api/proxy/health')
            const health = await response.json()
            setBackendHealth(health)
            console.log('🩺 後端健康狀態:', health)
        } catch (error) {
            console.error('❌ 後端健康檢查失敗:', error)
            setBackendHealth({ error: String(error) })
        }
    }

    // 檢查 STT 配置
    const checkSTTConfig = async () => {
        try {
            // 檢查前端配置
            const frontendConfig = {
                defaultProvider: 'breeze-asr-25',
                currentAppState: appState.appState,
                isRecording: appState.isRecording
            }
            
            // 嘗試檢查後端配置
            try {
                const response = await fetch('/api/proxy/config')
                const backendConfig = await response.json()
                setSttConfig({
                    frontend: frontendConfig,
                    backend: backendConfig
                })
                console.log('⚙️ STT 配置:', { frontend: frontendConfig, backend: backendConfig })
            } catch {
                setSttConfig({
                    frontend: frontendConfig,
                    backend: '無法獲取'
                })
                console.log('⚙️ STT 配置 (僅前端):', frontendConfig)
            }
        } catch (error) {
            console.error('❌ STT 配置檢查失敗:', error)
        }
    }

    // 模擬逐字稿數據
    const simulateTranscriptData = () => {
        const mockTranscript = {
            startTime: Math.floor(Date.now() / 1000),
            time: new Date().toLocaleTimeString(),
            text: `測試逐字稿數據 - ${new Date().toLocaleTimeString()}`
        }
        
        console.log('🎯 添加模擬逐字稿:', mockTranscript)
        addTranscriptEntry(mockTranscript)
    }

    // 測試與本地 STT 服務的連接
    const testLocalSTTConnection = async () => {
        try {
            console.log('🎙️ 測試本地 STT 服務連接...')
            
            // 檢查模型列表
            const modelsResponse = await fetch('http://localhost:8001/v1/models')
            const models = await modelsResponse.json()
            console.log('✅ 本地 STT 模型:', models)
            
            // 檢查健康狀態
            const healthResponse = await fetch('http://localhost:8001/health')
            const health = await healthResponse.json()
            console.log('✅ 本地 STT 健康狀態:', health)
            
            alert(`本地 STT 連接成功！\n可用模型: ${models.data?.map((m: any) => m.id).join(', ')}\n狀態: ${health.status}`)
        } catch (error) {
            console.error('❌ 本地 STT 連接失敗:', error)
            alert(`本地 STT 連接失敗: ${error}`)
        }
    }

    // 自動檢查狀態
    useEffect(() => {
        checkWebSocketStatus()
        checkBackendHealth()
        checkSTTConfig()
    }, [appState.appState, appState.isRecording])

    return (
        <div className="w-full bg-white text-gray-900">
            <div className="space-y-6">
                {/* 應用狀態 */}
                <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        📊 應用狀態
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-600">App State:</span>
                            <span className="font-medium text-gray-900 bg-white px-2 py-1 rounded border">{appState.appState}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">錄音中:</span>
                            <span className={`font-medium px-2 py-1 rounded border ${appState.isRecording ? 'text-green-700 bg-green-50' : 'text-gray-700 bg-white'}`}>
                                {appState.isRecording ? '是' : '否'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">逐字稿條目:</span>
                            <span className="font-medium text-gray-900 bg-white px-2 py-1 rounded border">{appState.transcriptEntries.length}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-600">WebSocket:</span>
                            <span className={`font-medium px-2 py-1 rounded border ${wsStatus === '已連接' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                                {wsStatus}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 逐字稿預覽 */}
                {appState.transcriptEntries.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                        <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                            📝 最新逐字稿
                        </h3>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                            {appState.transcriptEntries.slice(-5).map((entry, idx) => (
                                <div key={idx} className="bg-white border border-blue-200 p-3 rounded">
                                    <div className="flex items-start gap-2">
                                        <span className="text-blue-600 font-mono text-xs bg-blue-100 px-2 py-1 rounded">{entry.time}</span>
                                        <span className="text-blue-900 text-sm flex-1">{entry.text}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 診斷操作 */}
                <div className="bg-gray-50 border border-gray-200 p-4 rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        🔧 診斷操作
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        <Button onClick={checkWebSocketStatus} size="sm" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">
                            檢查 WebSocket
                        </Button>
                        <Button onClick={checkBackendHealth} size="sm" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">
                            檢查後端
                        </Button>
                        <Button onClick={checkSTTConfig} size="sm" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">
                            檢查 STT 配置
                        </Button>
                        <Button onClick={testLocalSTTConnection} size="sm" className="bg-white text-gray-700 border border-gray-300 hover:bg-gray-50">
                            測試本地 STT
                        </Button>
                    </div>
                </div>

                {/* 測試功能 */}
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                    <h3 className="font-semibold text-yellow-900 mb-3 flex items-center gap-2">
                        🧪 測試功能
                    </h3>
                    <Button 
                        onClick={simulateTranscriptData} 
                        className="w-full bg-yellow-100 text-yellow-800 border border-yellow-300 hover:bg-yellow-200"
                        size="sm"
                    >
                        🎯 添加測試逐字稿
                    </Button>
                </div>

                {/* 後端狀態 */}
                {backendHealth && (
                    <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                        <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                            🩺 後端狀態
                        </h3>
                        <pre className="bg-white border border-green-200 p-3 rounded text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {JSON.stringify(backendHealth, null, 2)}
                        </pre>
                    </div>
                )}

                {/* STT 配置 */}
                {sttConfig && (
                    <div className="bg-purple-50 border border-purple-200 p-4 rounded-lg">
                        <h3 className="font-semibold text-purple-900 mb-3 flex items-center gap-2">
                            ⚙️ STT 配置
                        </h3>
                        <pre className="bg-white border border-purple-200 p-3 rounded text-xs text-gray-800 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                            {JSON.stringify(sttConfig, null, 2)}
                        </pre>
                    </div>
                )}

                {/* 錯誤信息 */}
                {appState.error && (
                    <div className="bg-red-50 border border-red-300 p-4 rounded-lg">
                        <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                            ⚠️ 錯誤信息
                        </h3>
                        <div className="bg-white border border-red-200 p-3 rounded text-red-700 text-sm">{appState.error}</div>
                    </div>
                )}
            </div>
        </div>
    )
}