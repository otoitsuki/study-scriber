/* ============================================================
 * 型別安全：所有 WS 訊息的 Discriminated Union
 * ============================================================
 */

/** 共用欄位（可視需求增刪） */
interface BaseMessage {
    /** 來源伺服器時間（毫秒） */
    timestamp: number
}

/** 逐字稿片段 */
export interface TranscriptSegmentMessage extends BaseMessage {
    type: 'transcript_segment'
    text: string
    start_time: number
    end_time: number
    confidence: number
}

/** 連線建立成功 */
export interface ConnectionEstablishedMessage extends BaseMessage {
    type: 'connection_established'
    message: string
}

/** 整段逐字稿完成 */
export interface TranscriptCompleteMessage extends BaseMessage {
    type: 'transcript_complete'
    message: string
}

/** 心跳回覆 */
export interface HeartbeatAckMessage extends BaseMessage {
    type: 'heartbeat_ack'
}

/** Pong 回覆 */
export interface PongMessage extends BaseMessage {
    type: 'pong'
}

/** 一般錯誤 */
export interface ErrorMessage extends BaseMessage {
    type: 'error'
    error_type: string
    error_message: string
    details?: unknown
}

/** 轉錄服務錯誤 */
export interface TranscriptionErrorMessage extends BaseMessage {
    type: 'transcription_error'
    error_type: string
    error_message: string
}

/** 後端狀態切換（無 type 欄位，另拆） */
export interface PhaseMessage {
    phase: 'waiting' | 'active'
}

/** → 最終 Union */
export type WSMessage =
    | TranscriptSegmentMessage
    | ConnectionEstablishedMessage
    | TranscriptCompleteMessage
    | HeartbeatAckMessage
    | PongMessage
    | ErrorMessage
    | TranscriptionErrorMessage
    | PhaseMessage
