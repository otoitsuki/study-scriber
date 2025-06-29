import { AppState, SessionStatus, SessionType } from "./app-state"

// 狀態轉換觸發器類型
export type StateTransitionTrigger =
  | "USER_START_RECORDING"          // 用戶開始錄音
  | "USER_STOP_RECORDING"           // 用戶停止錄音
  | "FIRST_TRANSCRIPT_RECEIVED"     // 收到第一個逐字稿
  | "SESSION_CREATED"               // Session 建立完成
  | "SESSION_UPGRADED"              // Session 升級為錄音模式
  | "PROCESSING_STARTED"            // 開始處理剩餘逐字稿
  | "PROCESSING_COMPLETED"          // 處理完成
  | "ERROR_OCCURRED"                // 發生錯誤
  | "USER_NEW_NOTE"                 // 用戶開新筆記
  | "TRANSCRIPT_COMPLETED"          // 轉錄完全完成

// 狀態轉換條件
export interface StateTransitionCondition {
  currentState: AppState
  targetState: AppState
  trigger: StateTransitionTrigger

  // 額外條件檢查
  sessionExists?: boolean
  sessionStatus?: SessionStatus
  sessionType?: SessionType
  isRecording?: boolean
  hasTranscripts?: boolean

  // 自定義驗證函數
  customValidator?: (context: StateTransitionContext) => boolean
}

// 狀態轉換上下文
export interface StateTransitionContext {
  currentState: AppState
  isRecording: boolean
  transcriptCount: number
  session: {
    id: string
    status: SessionStatus
    type: SessionType
  } | null
  error: string | null
  pendingSessionTitle?: string  // 待建立會話的標題
}

// 狀態轉換結果
export interface StateTransitionResult {
  success: boolean
  newState: AppState
  error?: string
  sideEffects?: StateTransitionSideEffect[]
}

// 副作用類型
export type StateTransitionSideEffect =
  | { type: "CREATE_SESSION"; sessionType: SessionType; title?: string }
  | { type: "UPGRADE_SESSION" }
  | { type: "FINISH_SESSION" }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" }
  | { type: "CONNECT_WEBSOCKET" }
  | { type: "DISCONNECT_WEBSOCKET" }
  | { type: "CLEAR_TRANSCRIPTS" }
  | { type: "SAVE_DRAFT" }
  | { type: "SHOW_ERROR"; message: string }

// 狀態轉換規則定義
export const STATE_TRANSITION_RULES: StateTransitionCondition[] = [
  // 從 default 狀態開始錄音
  {
    currentState: "default",
    targetState: "recording_waiting",
    trigger: "USER_START_RECORDING",
    customValidator: (context) => {
      // 確保沒有其他活躍的錄音 session
      return !context.session || context.session.status === "completed" || context.session.status === "error"
    }
  },

  // 從 recording_waiting 重新開始錄音（處理重試情況）
  {
    currentState: "recording_waiting",
    targetState: "recording_waiting",
    trigger: "USER_START_RECORDING",
    customValidator: (context) => {
      // 允許在沒有 session 或 session 狀態異常時重新開始
      return !context.session || context.session.status === "completed" || context.session.status === "error"
    }
  },

  // Session 建立完成後保持在 default 狀態
  {
    currentState: "default",
    targetState: "default",
    trigger: "SESSION_CREATED",
    sessionExists: true,
    sessionStatus: "draft"
  },

  // 修復：從 recording_waiting 狀態處理 SESSION_CREATED，保持在 recording_waiting 等待 WebSocket 連接
  {
    currentState: "recording_waiting",
    targetState: "recording_waiting",
    trigger: "SESSION_CREATED",
    sessionExists: true,
    sessionStatus: "active",
    sessionType: "recording"
  },

  // 從 recording_waiting 收到第一個逐字稿轉為 recording_active
  {
    currentState: "recording_waiting",
    targetState: "recording_active",
    trigger: "FIRST_TRANSCRIPT_RECEIVED",
    sessionExists: true,
    sessionStatus: "active",
    sessionType: "recording",
    isRecording: true,
    hasTranscripts: true
  },

  // 從 recording_waiting 或 recording_active 停止錄音轉為 processing
  {
    currentState: "recording_waiting",
    targetState: "processing",
    trigger: "USER_STOP_RECORDING",
    sessionExists: true,
    sessionType: "recording"
  },
  {
    currentState: "recording_active",
    targetState: "processing",
    trigger: "USER_STOP_RECORDING",
    sessionExists: true,
    sessionType: "recording"
  },

  // 從 processing 完成轉錄轉為 finished
  {
    currentState: "processing",
    targetState: "finished",
    trigger: "PROCESSING_COMPLETED",
    sessionExists: true,
    sessionStatus: "completed"
  },

  // 修復：從任何狀態發生錯誤回到 default
  {
    currentState: "recording_waiting",
    targetState: "default",
    trigger: "ERROR_OCCURRED"
  },
  {
    currentState: "recording_active",
    targetState: "default",
    trigger: "ERROR_OCCURRED"
  },
  {
    currentState: "processing",
    targetState: "default",
    trigger: "ERROR_OCCURRED"
  },

  // 從 finished 或任何狀態開新筆記回到 default
  {
    currentState: "finished",
    targetState: "default",
    trigger: "USER_NEW_NOTE"
  },
  {
    currentState: "recording_waiting",
    targetState: "default",
    trigger: "USER_NEW_NOTE"
  },
  {
    currentState: "recording_active",
    targetState: "default",
    trigger: "USER_NEW_NOTE"
  }
]

// 狀態轉換副作用映射
export const STATE_TRANSITION_SIDE_EFFECTS: Record<string, StateTransitionSideEffect[]> = {
  // default -> recording_waiting: 建立會話、開始錄音並連接 WebSocket
  "default->recording_waiting->USER_START_RECORDING": [
    { type: "CREATE_SESSION", sessionType: "recording" },
    { type: "START_RECORDING" },
    { type: "CONNECT_WEBSOCKET" }
  ],

  // recording_waiting -> recording_waiting: 重新開始錄音（重試情況）
  "recording_waiting->recording_waiting->USER_START_RECORDING": [
    { type: "CREATE_SESSION", sessionType: "recording" },
    { type: "START_RECORDING" },
    { type: "CONNECT_WEBSOCKET" }
  ],

  // recording_waiting/recording_active -> processing: 停止錄音
  "recording_waiting->processing->USER_STOP_RECORDING": [
    { type: "STOP_RECORDING" }
  ],
  "recording_active->processing->USER_STOP_RECORDING": [
    { type: "STOP_RECORDING" }
  ],

  // processing -> finished: 完成 session
  "processing->finished->PROCESSING_COMPLETED": [
    { type: "FINISH_SESSION" }
  ],

  // 任何狀態 -> default (新筆記): 清理狀態
  "finished->default->USER_NEW_NOTE": [
    { type: "CLEAR_TRANSCRIPTS" },
    { type: "SAVE_DRAFT" }
  ],
  "recording_waiting->default->USER_NEW_NOTE": [
    { type: "STOP_RECORDING" },
    { type: "DISCONNECT_WEBSOCKET" },
    { type: "CLEAR_TRANSCRIPTS" }
  ],
  "recording_active->default->USER_NEW_NOTE": [
    { type: "STOP_RECORDING" },
    { type: "DISCONNECT_WEBSOCKET" },
    { type: "CLEAR_TRANSCRIPTS" }
  ],

  // 錯誤處理
  "recording_waiting->default->ERROR_OCCURRED": [
    { type: "STOP_RECORDING" },
    { type: "DISCONNECT_WEBSOCKET" },
    { type: "SHOW_ERROR", message: "錄音過程中發生錯誤" }
  ],
  "recording_active->default->ERROR_OCCURRED": [
    { type: "STOP_RECORDING" },
    { type: "DISCONNECT_WEBSOCKET" },
    { type: "SHOW_ERROR", message: "錄音過程中發生錯誤" }
  ],
  "processing->default->ERROR_OCCURRED": [
    { type: "SHOW_ERROR", message: "處理轉錄時發生錯誤" }
  ]
}
