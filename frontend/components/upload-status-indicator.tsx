"use client"

import { useState, useEffect } from 'react'
import { Button } from './ui/button'
import { Alert, AlertDescription } from './ui/alert'
import { Badge } from './ui/badge'
import { RefreshCw, Upload, AlertTriangle, CheckCircle, Wifi, WifiOff } from 'lucide-react'
import { restAudioUploader } from '../lib/rest-audio-uploader'

interface UploadStats {
    uploaded: number
    failed: number
    cached: number
    retrying: boolean
}

interface UploadStatusIndicatorProps {
    sessionId?: string
    isRecording?: boolean
    className?: string
}

/**
 * UploadStatusIndicator - 上傳狀態指示器
 *
 * Phase 2 重構：顯示 REST API 上傳狀態
 *
 * 功能：
 * - 顯示上傳統計（成功/失敗/暫存）
 * - 提示暫存檔案可重新上傳
 * - 支援手動重試功能
 * - 網路狀態指示
 */
export function UploadStatusIndicator({
    sessionId,
    isRecording = false,
    className = ""
}: UploadStatusIndicatorProps) {
    const [uploadStats, setUploadStats] = useState<UploadStats>({
        uploaded: 0,
        failed: 0,
        cached: 0,
        retrying: false
    })
    const [isOnline, setIsOnline] = useState(true)
    const [lastUpdate, setLastUpdate] = useState(Date.now())

    // 監聽網路狀態
    useEffect(() => {
        const handleOnline = () => setIsOnline(true)
        const handleOffline = () => setIsOnline(false)

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    // 設置上傳器事件監聽
    useEffect(() => {
        if (!sessionId) return

        restAudioUploader.setSessionId(sessionId)

        // 監聽上傳成功
        const handleUploadSuccess = (seq: number) => {
            setUploadStats(prev => ({
                ...prev,
                uploaded: prev.uploaded + 1
            }))
            setLastUpdate(Date.now())
        }

        // 監聽上傳失敗
        const handleUploadError = (seq: number) => {
            setUploadStats(prev => ({
                ...prev,
                failed: prev.failed + 1
            }))
            setLastUpdate(Date.now())
        }

        // 監聽暫存到本地
        const handleCacheStored = (seq: number) => {
            setUploadStats(prev => ({
                ...prev,
                cached: prev.cached + 1
            }))
            setLastUpdate(Date.now())
        }

        restAudioUploader.onUploadSuccess(handleUploadSuccess)
        restAudioUploader.onUploadError(handleUploadError)
        restAudioUploader.onCacheStored(handleCacheStored)

        return () => {
            // 清理事件監聽器
            restAudioUploader.onUploadSuccess(() => { })
            restAudioUploader.onUploadError(() => { })
            restAudioUploader.onCacheStored(() => { })
        }
    }, [sessionId])

    // 定期更新暫存數量
    useEffect(() => {
        const updateCachedCount = async () => {
            if (sessionId && restAudioUploader) {
                const count = await restAudioUploader.getCachedSegmentsCount()
                setUploadStats(prev => ({
                    ...prev,
                    cached: count
                }))
            }
        }

        updateCachedCount()
        const interval = setInterval(updateCachedCount, 10000) // 每 10 秒更新一次

        return () => clearInterval(interval)
    }, [sessionId])

    // 重新上傳暫存檔案
    const handleRetryUploads = async () => {
        if (!sessionId || uploadStats.retrying) return

        setUploadStats(prev => ({ ...prev, retrying: true }))

        try {
            await restAudioUploader.retryFailedSegments()

            // 更新暫存數量
            const newCachedCount = await restAudioUploader.getCachedSegmentsCount()
            setUploadStats(prev => ({
                ...prev,
                cached: newCachedCount,
                retrying: false
            }))

            console.log('✅ [UploadStatusIndicator] 重新上傳完成')
        } catch (error) {
            console.error('❌ [UploadStatusIndicator] 重新上傳失敗:', error)
            setUploadStats(prev => ({ ...prev, retrying: false }))
        }
    }

    // 如果不在錄音且沒有統計數據，不顯示
    if (!isRecording && uploadStats.uploaded === 0 && uploadStats.failed === 0 && uploadStats.cached === 0) {
        return null
    }

    return (
        <div className={`space-y-2 ${className}`}>
            {/* 網路狀態指示 */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isOnline ? (
                    <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                    <WifiOff className="h-4 w-4 text-red-500" />
                )}
                <span>{isOnline ? '線上' : '離線'}</span>
            </div>

            {/* 上傳統計 */}
            <div className="flex items-center gap-2 flex-wrap">
                {uploadStats.uploaded > 0 && (
                    <Badge variant="default" className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        已上傳 {uploadStats.uploaded}
                    </Badge>
                )}

                {uploadStats.failed > 0 && (
                    <Badge variant="destructive" className="flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        失敗 {uploadStats.failed}
                    </Badge>
                )}

                {uploadStats.cached > 0 && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                        <Upload className="h-3 w-3" />
                        暫存 {uploadStats.cached}
                    </Badge>
                )}
            </div>

            {/* 暫存檔案提示 */}
            {uploadStats.cached > 0 && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="flex items-center justify-between">
                        <span>
                            有 {uploadStats.cached} 個音頻段落暫存在本地。
                            {isOnline ? '可以重新上傳' : '請等待網路連線'}
                        </span>
                        {isOnline && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRetryUploads}
                                disabled={uploadStats.retrying}
                                className="ml-2"
                            >
                                {uploadStats.retrying ? (
                                    <>
                                        <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                        重新上傳中...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="h-3 w-3 mr-1" />
                                        重新上傳
                                    </>
                                )}
                            </Button>
                        )}
                    </AlertDescription>
                </Alert>
            )}

            {/* 錄音時的即時狀態 */}
            {isRecording && (
                <div className="text-xs text-muted-foreground">
                    上次更新：{new Date(lastUpdate).toLocaleTimeString()}
                </div>
            )}
        </div>
    )
}
