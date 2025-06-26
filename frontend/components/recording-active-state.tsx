"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Square, Lock, Unlock, RotateCcw } from "lucide-react"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingActiveStateProps {
    transcriptEntries: TranscriptEntry[]
    onStopRecording: () => void
    onNewNote?: () => void
}

export function RecordingActiveState({ transcriptEntries, onStopRecording, onNewNote }: RecordingActiveStateProps) {
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

    // 手動切換自動捲動鎖定狀態
    const toggleAutoScrollLock = useCallback(() => setIsAutoScrollLocked(prev => !prev), [])

    // 合併相近段落，減少行數
    const mergeSegments = useCallback((entries: TranscriptEntry[]): TranscriptEntry[] => {
        if (entries.length <= 1) return entries
        const merged: TranscriptEntry[] = []
        let current = { ...entries[0] }
        for (let i = 1; i < entries.length; i++) {
            const next = entries[i]
            const diff =
                Math.abs(
                    parseInt(next.time.split(":")[0]) * 60 + parseInt(next.time.split(":")[1]) -
                    (parseInt(current.time.split(":")[0]) * 60 + parseInt(current.time.split(":")[1]))
                )
            if (diff <= 5 && current.text.length + next.text.length < 200) {
                current = { time: current.time, text: current.text.trim() + " " + next.text.trim() }
            } else {
                merged.push(current)
                current = { ...next }
            }
        }
        merged.push(current)
        return merged
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
                            <span className="text-foreground leading-relaxed">{entry.text}</span>
                        </div>
                    ))}
                </div>
            </ScrollArea>

            <div className="p-4 border-t border-border space-y-2">
                {/* New Note 按鈕 - 在錄音過程中也可以使用 */}
                {onNewNote && (
                    <div className="flex justify-center">
                        <Button
                            onClick={onNewNote}
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                        >
                            <RotateCcw className="w-4 h-4" />
                            New note
                        </Button>
                    </div>
                )}

                <div className="flex justify-between items-center">
                    <Button
                        onClick={toggleAutoScrollLock}
                        variant="ghost"
                        size="sm"
                        className="flex items-center gap-2 text-muted-foreground"
                    >
                        {isAutoScrollLocked ? (
                            <>
                                <Lock className="w-4 h-4" />
                                Auto-scroll
                            </>
                        ) : (
                            <>
                                <Unlock className="w-4 h-4" />
                                Manual
                            </>
                        )}
                    </Button>

                    <Button onClick={onStopRecording} variant="destructive" size="sm" className="flex items-center gap-2">
                        <Square className="w-4 h-4" />
                        Stop
                    </Button>
                </div>
            </div>
        </div>
    )
}
