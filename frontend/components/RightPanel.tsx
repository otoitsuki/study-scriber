"use client"

import { useRef, useEffect } from "react";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Square, AlertCircle, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppState, useAppActions } from "../lib/app-store-zustand";
import { WaitingState } from "./waiting-state";

export default function RightPanel() {
    const {
        transcriptEntries,
        appState,
        recordingTime,
        error,
    } = useAppState();
    const { stopRecording } = useAppActions();

    // ScrollArea refs for auto-scrolling
    const recordingScrollRef = useRef<HTMLDivElement>(null);
    const finishedScrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new transcript entries are added
    useEffect(() => {
        const scrollToBottom = () => {
            const isRecordingPhase = appState === "recording_waiting" || appState === "recording_active";
            const targetRef = isRecordingPhase ? recordingScrollRef : finishedScrollRef;
            
            if (targetRef.current) {
                const scrollContainer = targetRef.current.querySelector('[data-radix-scroll-area-viewport]');
                if (scrollContainer) {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
            }
        };

        // Use setTimeout to ensure DOM is updated
        const timeoutId = setTimeout(scrollToBottom, 50);
        
        return () => clearTimeout(timeoutId);
    }, [transcriptEntries.length, appState]); // Trigger when entries length changes or state changes

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const isRecordingPhase = appState === "recording_waiting" || appState === "recording_active";
    const isProcessing = appState === "processing";

    return (
        <div className="w-full h-full border-l bg-background flex flex-col">
            {/* 內容區域 */}
            <div className="flex-1 overflow-hidden">
                {isRecordingPhase ? (
                    <div className="h-full flex flex-col">
                        <ScrollArea className="flex-1" ref={recordingScrollRef}>
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
                                    <div className="text-sm">Recording… {formatTime(recordingTime)}</div>
                                    <div className="text-xs">{error ? "轉錄過程中發生錯誤" : "轉錄中"}</div>
                                </div>
                            )}
                        </ScrollArea>

                        {/* 底部控制列 */}
                        <div className="p-4 border-t border-border flex justify-between items-center">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Clock className="w-4 h-4" />
                                <span className="font-mono text-sm">{formatTime(recordingTime)}</span>
                            </div>

                            <Button
                                onClick={stopRecording}
                                variant="destructive"
                                size="sm"
                                className="flex items-center gap-2"
                            >
                                <Square className="w-4 h-4" />
                                Stop
                            </Button>
                        </div>
                    </div>
                ) : (
                    isProcessing ? (
                        // processing 階段顯示等待 UI
                        <WaitingState />
                    ) : (
                        <ScrollArea className="h-full" ref={finishedScrollRef}>
                            <div className="p-4 space-y-4">
                                {transcriptEntries.map((entry, idx) => (
                                    <div key={idx} className="flex gap-4 text-sm">
                                        <span className="text-muted-foreground font-mono">{entry.time}</span>
                                        <span className="flex-1">{entry.text}</span>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    )
                )}
            </div>
        </div>
    );
}
