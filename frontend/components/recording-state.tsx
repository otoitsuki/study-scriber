"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Square, Lock, Unlock } from "lucide-react"
import type { TranscriptEntry } from "../types/app-state"

interface RecordingStateProps {
  transcriptEntries: TranscriptEntry[]
  recordingTime: number
  onStopRecording: () => void
}

export function RecordingState({ transcriptEntries, recordingTime, onStopRecording }: RecordingStateProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollLocked, setIsAutoScrollLocked] = useState(true)
  const [userScrollTimeout, setUserScrollTimeout] = useState<NodeJS.Timeout | null>(null)

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

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
  const unlockOnScroll = useCallback((event: Event) => {
    const target = event.target as HTMLElement
    if (target) {
      const { scrollTop, scrollHeight, clientHeight } = target
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10

      if (!isAtBottom && isAutoScrollLocked) {
        // 使用者向上捲動，解鎖自動捲動
        setIsAutoScrollLocked(false)
        console.log('🔓 自動捲動已解鎖（使用者捲動）')
      } else if (isAtBottom && !isAutoScrollLocked) {
        // 使用者捲動到底部，重新鎖定自動捲動
        setIsAutoScrollLocked(true)
        console.log('🔒 自動捲動已鎖定（回到底部）')
      }

      // 清除之前的計時器
      if (userScrollTimeout) {
        clearTimeout(userScrollTimeout)
      }

      // 設定計時器，如果使用者 3 秒內沒有捲動，自動重新鎖定
      const timeout = setTimeout(() => {
        if (!isAutoScrollLocked) {
          setIsAutoScrollLocked(true)
          console.log('🔒 自動捲動已自動重新鎖定（3秒無操作）')
        }
      }, 3000)

      setUserScrollTimeout(timeout)
    }
  }, [isAutoScrollLocked, userScrollTimeout])

  // 手動切換自動捲動鎖定狀態
  const toggleAutoScrollLock = useCallback(() => {
    setIsAutoScrollLocked(prev => {
      const newState = !prev
      console.log(newState ? '🔒 手動鎖定自動捲動' : '🔓 手動解鎖自動捲動')
      return newState
    })
  }, [])

  // 相鄰段落合併邏輯
  const mergeSegments = useCallback((entries: TranscriptEntry[]): TranscriptEntry[] => {
    if (entries.length <= 1) return entries

    const merged: TranscriptEntry[] = []
    let currentEntry = { ...entries[0] }

    for (let i = 1; i < entries.length; i++) {
      const nextEntry = entries[i]
      const currentTime = currentEntry.time
      const nextTime = nextEntry.time

      // 如果時間相同或相近（差距小於 5 秒），合併文字
      const timeDiff = Math.abs(
        parseInt(nextTime.split(':')[0]) * 60 + parseInt(nextTime.split(':')[1]) -
        (parseInt(currentTime.split(':')[0]) * 60 + parseInt(currentTime.split(':')[1]))
      )

      if (timeDiff <= 5 && currentEntry.text.length + nextEntry.text.length < 200) {
        // 合併文字，避免重複的標點符號
        const combinedText = currentEntry.text.trim() + ' ' + nextEntry.text.trim()
        currentEntry = {
          time: currentTime, // 保持第一個時間戳
          text: combinedText
        }
      } else {
        // 不合併，推入當前項目並開始新的項目
        merged.push(currentEntry)
        currentEntry = { ...nextEntry }
      }
    }

    // 推入最後一個項目
    merged.push(currentEntry)
    return merged
  }, [])

  // 處理逐字稿更新時的自動捲動
  useEffect(() => {
    autoScroll()
  }, [transcriptEntries, autoScroll])

  // 設定捲動事件監聽器
  useEffect(() => {
    const scrollContainer = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', unlockOnScroll)
      return () => {
        scrollContainer.removeEventListener('scroll', unlockOnScroll)
      }
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

  // 應用段落合併邏輯
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
          {mergedEntries.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <div className="text-sm">Recording... {formatTime(recordingTime)}</div>
              <div className="text-xs mt-2">Transcript will appear here</div>
            </div>
          )}
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
