"use client"

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useAppState } from '../lib/app-store-zustand'

/**
 * 診斷面板 - 用於檢查逐字稿和錄音狀態
 */
export function DebugPanel() {
    const [isVisible, setIsVisible] = useState(false)
    const appState = useAppState()

    const checkBackendHealth = async () => {
        try {
            const response = await fetch('/api/proxy/health')
            const data = await response.json()
            console.log('🩺 後端健康狀態:', data)
            
            // 檢查 STT Provider 狀態
            if (data.services?.provider) {
                console.log('🎤 STT Provider:', data.services.provider)
            }
            
            return data
        } catch (error) {
            console.error('❌ 無法檢查後端健康狀態:', error)
            return null
        }
    }

    const checkWebSocketConnection = () => {
        console.log('🔌 檢查 WebSocket 連接狀態...')
        
        // 檢查全域 WebSocket 連接
        const globalWS = (window as any).transcriptWebSocket
        if (globalWS) {
            console.log('🔌 TranscriptWebSocket 狀態:', {
                readyState: globalWS.readyState,
                url: globalWS.url,
                readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][globalWS.readyState]
            })
        } else {
            console.log('❌ 未找到 TranscriptWebSocket')
        }

        // 檢查錄音相關服務
        const recordingFlowService = (window as any).currentRecordingFlowService
        if (recordingFlowService) {
            console.log('🎤 RecordingFlowService 存在')
            console.log('🎤 錄音狀態:', recordingFlowService.getRecordingState?.())
        } else {
            console.log('❌ 未找到 RecordingFlowService')
        }
    }

    const simulateTranscript = () => {
        console.log('🎯 模擬逐字稿數據...')
        
        const store = (window as any).useAppStore?.getState?.()
        if (store && store.addTranscriptEntry) {
            const mockEntry = {
                startTime: Date.now() / 1000,
                time: new Date().toLocaleTimeString(),
                text: `測試逐字稿 - ${new Date().toLocaleTimeString()}`
            }
            
            store.addTranscriptEntry(mockEntry)
            console.log('✅ 已添加模擬逐字稿:', mockEntry)
        } else {
            console.error('❌ 無法訪問 App Store')
        }
    }

    if (!isVisible) {
        return (
            <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setIsVisible(true)}
                className="fixed top-4 right-4 z-50"
            >
                🩺 診斷
            </Button>
        )
    }

    return (
        <Card className="fixed top-4 right-4 z-50 w-80 max-h-96 overflow-y-auto">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                    <CardTitle className="text-lg">系統診斷</CardTitle>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setIsVisible(false)}
                    >
                        ✕
                    </Button>
                </div>
                <CardDescription>檢查逐字稿和錄音狀態</CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
                {/* 應用狀態 */}
                <div>
                    <h4 className="font-semibold mb-2">應用狀態</h4>
                    <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                            <span>App State:</span>
                            <Badge variant="outline">{appState.appState}</Badge>
                        </div>
                        <div className="flex justify-between">
                            <span>錄音中:</span>
                            <Badge variant={appState.isRecording ? "default" : "secondary"}>
                                {appState.isRecording ? '是' : '否'}
                            </Badge>
                        </div>
                        <div className="flex justify-between">
                            <span>逐字稿條目:</span>
                            <Badge variant="outline">{appState.transcriptEntries.length}</Badge>
                        </div>
                        <div className="flex justify-between">
                            <span>錄音時間:</span>
                            <Badge variant="outline">{appState.recordingTime}s</Badge>
                        </div>
                    </div>
                </div>

                {/* 逐字稿預覽 */}
                {appState.transcriptEntries.length > 0 && (
                    <div>
                        <h4 className="font-semibold mb-2">最新逐字稿</h4>
                        <div className="text-xs bg-muted p-2 rounded max-h-20 overflow-y-auto">
                            {appState.transcriptEntries.slice(-3).map((entry, idx) => (
                                <div key={idx} className="mb-1">
                                    <span className="text-muted-foreground">{entry.time}</span> {entry.text}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* 診斷操作 */}
                <div className="space-y-2">
                    <Button 
                        onClick={checkBackendHealth} 
                        size="sm" 
                        className="w-full"
                    >
                        檢查後端狀態
                    </Button>
                    <Button 
                        onClick={checkWebSocketConnection} 
                        variant="outline" 
                        size="sm" 
                        className="w-full"
                    >
                        檢查 WebSocket
                    </Button>
                    <Button 
                        onClick={simulateTranscript} 
                        variant="secondary" 
                        size="sm" 
                        className="w-full"
                    >
                        模擬逐字稿
                    </Button>
                </div>

                {/* 錯誤信息 */}
                {appState.error && (
                    <div>
                        <h4 className="font-semibold mb-2 text-red-600">錯誤信息</h4>
                        <div className="text-xs bg-red-50 p-2 rounded text-red-800">
                            {appState.error}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}