// 前端應用狀態 - 對應 PRD 四狀態流程
export type AppState =
  | "default"     // 預設畫面：可寫筆記，顯示錄音按鈕
  | "recording"   // 錄音畫面：錄音中，即時顯示逐字稿
  | "processing"  // 處理畫面：停止錄音後，處理剩餘逐字稿
  | "finished"    // 完整逐字稿畫面：可編輯筆記、匯出、開新筆記

export interface TranscriptEntry {
  time: string
  text: string
}

export interface AppData {
  state: AppState
  editorContent: string
  transcriptEntries: TranscriptEntry[]
  isRecording: boolean
  recordingTime: number
}

// 後端 Session 狀態對應前端狀態
export type SessionStatus = "draft" | "active" | "processing" | "completed" | "error"
export type SessionType = "note_only" | "recording"

// 狀態映射介面
export interface StateMapping {
  frontendState: AppState
  backendStatus: SessionStatus
  sessionType: SessionType
}
