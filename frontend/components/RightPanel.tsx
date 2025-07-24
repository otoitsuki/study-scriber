"use client"

import { ScrollArea } from "./ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Square, AlertCircle, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppState, useAppActions } from "../lib/app-store-zustand";

export default function RightPanel() {
    const {
        transcriptEntries,
        appState,
        recordingTime,
        error,
    } = useAppState();
    const { stopRecording } = useAppActions();

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const isRecordingPhase = appState === "recording_waiting" || appState === "recording_active";

    return (
        <div className="w-full h-full border-l bg-background flex flex-col">
            {/* 內容區域 */}
            <div className="flex-1 overflow-hidden">
                {isRecordingPhase ? (
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
                    <ScrollArea className="h-full p-4 space-y-2">
                        {transcriptEntries.map((entry, idx) => (
                            <div key={idx} className="whitespace-pre-wrap text-sm text-muted-foreground">
                                {entry.time ? `[${entry.time}] ` : ""}
                                {entry.text}
                            </div>
                        ))}
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
