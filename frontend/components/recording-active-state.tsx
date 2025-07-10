"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Square, Clock } from "lucide-react"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingActiveStateProps {
    transcriptEntries: TranscriptEntry[]
    recordingTime: number
    onStopRecording: () => void
}

// 格式化錄音時間為 HH:MM:SS 格式
function formatRecordingTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function RecordingActiveState({ transcriptEntries, recordingTime, onStopRecording }: RecordingActiveStateProps) {
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const [isAutoScrollLocked, setIsAutoScrollLocked] = useState(true)
    const [userScrollTimeout, setUserScrollTimeout] = useState<NodeJS.Timeout | null>(null)

    // 自動捲動到底部
    const autoScroll = useCallback(() => {
        if (isAutoScrollLocked && scrollAreaRef.current) {
            const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
            if (scrollContainer) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight
            }
        }
    }, [isAutoScrollLocked])

    // 檢測使用者捲動行為
    const unlockOnScroll = useCallback(
        (event: Event) => {
            const target = event.target as HTMLElement
            if (target) {
                const { scrollTop, scrollHeight, clientHeight } = target
                const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10

                if (!isAtBottom && isAutoScrollLocked) {
                    setIsAutoScrollLocked(false)
                } else if (isAtBottom && !isAutoScrollLocked) {
                    setIsAutoScrollLocked(true)
                }

                if (userScrollTimeout) clearTimeout(userScrollTimeout)

                const timeout = setTimeout(() => {
                    if (!isAutoScrollLocked) setIsAutoScrollLocked(true)
                }, 3000)

                setUserScrollTimeout(timeout)
            }
        },
        [isAutoScrollLocked, userScrollTimeout]
    )

    // 手動切換自動捲動鎖定狀態（保持功能但不顯示按鈕）
    const toggleAutoScrollLock = useCallback(() => setIsAutoScrollLocked(prev => !prev), [])

    // 禁用合併段落邏輯 - 用戶要求一句話一個時間戳
    const mergeSegments = useCallback((entries: TranscriptEntry[]): TranscriptEntry[] => {
        // 直接返回原始條目，不進行任何合併
        return entries
    }, [])

    // 自動捲動
    useEffect(() => {
        autoScroll()
    }, [transcriptEntries, autoScroll])

    // 監聽捲動
    useEffect(() => {
        const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
        if (scrollContainer) {
            scrollContainer.addEventListener("scroll", unlockOnScroll)
            return () => scrollContainer.removeEventListener("scroll", unlockOnScroll)
        }
    }, [unlockOnScroll])

    // 清理計時器
    useEffect(() => {
        return () => {
            if (userScrollTimeout) {
                clearTimeout(userScrollTimeout)
            }
        }
    }, [userScrollTimeout])

    const mergedEntries = mergeSegments(transcriptEntries)

    return (
        <div className="h-full flex flex-col">
            <ScrollArea className="flex-1" ref={scrollAreaRef}>
                <div className="p-6 space-y-4">
                    {mergedEntries.map((entry, index) => (
                        <div key={index} className="flex gap-4 text-sm">
                            <span className="text-muted-foreground font-mono text-xs mt-1 min-w-[40px] flex-shrink-0">
                                {entry.time}
                            </span>
                            <span className="text-foreground leading-relaxed flex-1">{entry.text}</span>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="p-4 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span className="font-mono text-sm">
                        {formatRecordingTime(recordingTime)}
                    </span>
                </div>

                <Button onClick={onStopRecording} variant="destructive" size="sm" className="flex items-center gap-2">
                    <Square className="w-4 h-4" />
                    Stop
                </Button>
            </div>
        </div>
    )
}
