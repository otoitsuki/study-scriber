"use client"

/**
 * 前端配置管理
 * 集中管理所有可配置的設定項目
 */

/**
 * 音訊錄製配置
 */
export interface AudioConfig {
  chunkInterval: number // 音訊切片間隔（毫秒）
  chunkDuration: number // 音訊切片長度（秒）
  chunkOverlap: number // 音訊切片重疊（秒）
  effectiveChunkDuration: number // 有效音訊切片長度（秒）
  mimeType: string // 音訊格式
  audioBitsPerSecond: number // 音訊位元率
}

/**
 * 應用程式配置
 */
export interface AppConfig {
  apiUrl: string
  wsUrl: string
  audio: AudioConfig
  isDevelopment: boolean
}

/**
 * 從環境變數獲取音訊切片間隔
 * 支援秒數和毫秒數兩種格式
 */
function getAudioChunkInterval(): number {
  // 優先使用毫秒格式的環境變數
  const intervalMs = process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS
  if (intervalMs) {
    const parsed = parseInt(intervalMs, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }

  // 其次使用秒數格式的環境變數
  const intervalSec = process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC
  if (intervalSec) {
    const parsed = parseInt(intervalSec, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed * 1000 // 轉換為毫秒
    }
  }

  // 預設值：10秒
  return 30 * 1000
}

/**
 * 從環境變數獲取音訊切片長度（秒）
 */
function getAudioChunkDuration(): number {
  const duration = process.env.NEXT_PUBLIC_AUDIO_CHUNK_DURATION_SEC
  if (duration) {
    const parsed = parseInt(duration, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  // 預設值：15秒（與後端保持一致）
  return 15
}

/**
 * 從環境變數獲取音訊切片重疊（秒）
 */
function getAudioChunkOverlap(): number {
  const overlap = process.env.NEXT_PUBLIC_AUDIO_CHUNK_OVERLAP_SEC
  if (overlap) {
    const parsed = parseInt(overlap, 10)
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed
    }
  }
  // 預設值：5秒（與後端保持一致）
  return 5
}

/**
 * 應用程式配置實例
 */
export const appConfig: AppConfig = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
  wsUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000',
  isDevelopment: process.env.NODE_ENV === 'development',
  audio: {
    chunkInterval: getAudioChunkInterval(),
    chunkDuration: getAudioChunkDuration(),
    chunkOverlap: getAudioChunkOverlap(),
    effectiveChunkDuration: getAudioChunkDuration() - getAudioChunkOverlap(),
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 64000  // 64 kbps for 10s chunks
  }
}

/**
 * 輔助函數：獲取音訊切片間隔（毫秒）
 */
export function getAudioChunkIntervalMs(): number {
  return appConfig.audio.chunkInterval
}

/**
 * 輔助函數：獲取音訊切片間隔（秒）
 */
export function getAudioChunkIntervalSec(): number {
  return Math.round(appConfig.audio.chunkInterval / 1000)
}

/**
 * 輔助函數：獲取時間戳標籤間隔（秒）
 */
export function getTranscriptLabelIntervalSec(): number {
  const raw = process.env.NEXT_PUBLIC_TRANSCRIPT_LABEL_INTERVAL
  const n = Number(raw)
  const result = Number.isFinite(n) && n > 0 ? Math.floor(n) : 30

  // 開發模式下顯示調試信息
  if (process.env.NODE_ENV === 'development') {
    console.log('🏷️ [Config] 時間戳標籤間隔設定:', {
      rawValue: raw,
      parsedValue: n,
      finalValue: result,
      envVar: 'NEXT_PUBLIC_TRANSCRIPT_LABEL_INTERVAL'
    })
  }

  return result
}

/**
 * 輔助函數：獲取音訊切片長度（秒）
 */
export function getAudioChunkDurationSec(): number {
  return appConfig.audio.chunkDuration
}

/**
 * 輔助函數：獲取音訊切片重疊（秒）
 */
export function getAudioChunkOverlapSec(): number {
  return appConfig.audio.chunkOverlap
}

/**
 * 輔助函數：獲取有效音訊切片長度（秒）
 * 用於時間戳計算，考慮 overlap 的影響
 */
export function getEffectiveAudioChunkDurationSec(): number {
  return appConfig.audio.effectiveChunkDuration
}

/**
 * 輔助函數：格式化音訊配置資訊
 */
export function getAudioConfigInfo(): string {
  const seconds = getAudioChunkIntervalSec()
  return `${seconds}秒切片 (${appConfig.audio.chunkInterval}ms)`
}

/**
 * 獲取應用程式配置
 */
export function getAppConfig(): AppConfig {
  return appConfig
}

/**
 * 開發模式診斷資訊
 */
export function getConfigInfo(): string {
  const config = getAppConfig()
  return `Config: API=${config.apiUrl}, WS=${config.wsUrl}, Dev=${config.isDevelopment}`
}

/**
 * 開發模式診斷：顯示當前配置
 */
if (appConfig.isDevelopment && typeof window !== 'undefined') {
  console.log('🔧 [Config] 音訊配置:', {
    chunkInterval: appConfig.audio.chunkInterval,
    chunkIntervalSec: getAudioChunkIntervalSec(),
    chunkDuration: appConfig.audio.chunkDuration,
    chunkOverlap: appConfig.audio.chunkOverlap,
    effectiveChunkDuration: appConfig.audio.effectiveChunkDuration,
    mimeType: appConfig.audio.mimeType,
    audioBitsPerSecond: appConfig.audio.audioBitsPerSecond,
    source: process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS ? 'MS' :
      process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC ? 'SEC' : 'DEFAULT'
  })
}
