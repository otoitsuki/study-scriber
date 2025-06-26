"use client"

import { useState, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Square, Lock, Unlock } from "lucide-react"

interface RecordingWaitingStateProps {
    recordingTime: number
    onStopRecording: () => void
}

export function RecordingWaitingState({ recordingTime, onStopRecording }: RecordingWaitingStateProps) {
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
                <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground text-center space-y-2">
                    <div className="text-sm">
                        Recording… {formatTime(recordingTime)}
                    </div>
                    <div className="text-xs">Transcript will appear here</div>
                </div>
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
