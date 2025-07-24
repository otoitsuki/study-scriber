"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { ScrollArea } from "./ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Square, AlertCircle, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
// 若需 Markdown 解析可換成 react-markdown；此處先以 pre 顯示
import { useAppState, useAppActions } from "../lib/app-store-zustand";

export default function RightPanel() {
    const {
        currentTab,
        transcriptEntries,
        summary,
        isSummaryReady,
        appState,
        recordingTime,
        error,
        session
    } = useAppState();
    const { setCurrentTab, stopRecording } = useAppActions();

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
    }

    const renderTranscriptTabContent = () => {
        // 在 recording_waiting 或 recording_active 狀態下，顯示倒數時間與控制列
        if (appState === 'recording_waiting' || appState === 'recording_active') {
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
                                    {error ? "轉錄過程中發生錯誤" : "轉錄中"}
                                </div>
                            </div>
                        )}
                    </ScrollArea>

                    {/* 下方控制列 */}
                    <div className="p-4 border-t border-border flex justify-between items-center">
                        {/* 錄音計時顯示 */}
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock className="w-4 h-4" />
                            <span className="font-mono text-sm">
                                {formatTime(recordingTime)}
                            </span>
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
            )
        }

        // 其他狀態下的正常逐字稿顯示
        return (
            <ScrollArea className="h-full p-4 space-y-2">
                {transcriptEntries.map((entry, idx) => (
                    <div key={idx} className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {entry.time ? `[${entry.time}] ` : ""}
                        {entry.text}
                    </div>
                ))}
            </ScrollArea>
        )
    }

    return (
        <div className="w-full h-full border-l bg-background flex flex-col">
            <Tabs
                defaultValue="transcript"
                value={currentTab}
                onValueChange={(val: string) => setCurrentTab(val as "transcript" | "summary")}
                className="w-full h-full flex flex-col"
            >
                <TabsList className="flex-none">
                    <TabsTrigger value="transcript">逐字稿</TabsTrigger>
                    <TabsTrigger value="summary">摘要</TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-hidden">
                    <TabsContent value="transcript" className="h-full">
                        {renderTranscriptTabContent()}
                    </TabsContent>

                    <TabsContent value="summary" className="h-full">
                        <ScrollArea className="h-full p-4">
                            {isSummaryReady ? (
                                summary ? (
                                    <pre className="whitespace-pre-wrap text-sm">{summary}</pre>
                                ) : (
                                    <div className="text-muted-foreground">(無摘要可用)</div>
                                )
                            ) : (
                                <div className="animate-pulse text-muted-foreground">生成中…</div>
                            )}
                        </ScrollArea>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}
