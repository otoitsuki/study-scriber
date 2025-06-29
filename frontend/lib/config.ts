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

  // 預設值：15秒
  return 15 * 1000
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
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128000
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
    mimeType: appConfig.audio.mimeType,
    source: process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_MS ? 'MS' :
      process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC ? 'SEC' : 'DEFAULT'
  })
}
