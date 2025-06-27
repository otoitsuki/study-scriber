"use client"

import { useState, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Square, Lock, Unlock, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingWaitingStateProps {
    recordingTime: number
    onStopRecording: () => void
    transcriptEntries: TranscriptEntry[]
    error?: string | null
}

export function RecordingWaitingState({
    recordingTime,
    onStopRecording,
    transcriptEntries,
    error
}: RecordingWaitingStateProps) {
    const [isAutoScrollLocked, setIsAutoScrollLocked] = useState(true)

    const toggleAutoScrollLock = useCallback(() => {
        setIsAutoScrollLocked(prev => !prev)
    }, [])

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }

    return (
        <div className="h-full flex flex-col">
            <ScrollArea className="flex-1">
                {error && (
                    <Alert variant="destructive" className="m-4">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                {transcriptEntries.length > 0 ? (
                    <div className="p-4 space-y-4">
                        {transcriptEntries.map((entry, index) => (
                            <div key={index} className="flex gap-4 text-sm">
                                <span className="text-muted-foreground font-mono">{entry.time}</span>
                                <span className="flex-1">{entry.text}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground text-center space-y-2">
                        <div className="text-sm">
                            Recording… {formatTime(recordingTime)}
                        </div>
                        <div className="text-xs">
                            {error ? "轉錄過程中發生錯誤" : "等待逐字稿..."}
                        </div>
                    </div>
                )}
            </ScrollArea>

            <div className="p-4 border-t border-border flex justify-between items-center">
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
    )
}
