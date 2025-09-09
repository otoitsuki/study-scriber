/**
 * 統一配置管理 - 從後端 API 讀取配置，確保前後端一致
 * 只要修改後端 .env 檔案，前端自動跟隨
 */

interface AppConfig {
  // 音頻切片配置
  audioChunkDurationSec: number
  audioChunkOverlapSec: number
  transcriptDisplayIntervalSec: number
  
  // 其他配置
  apiBaseUrl: string
  wsBaseUrl: string
}

// 預設配置（後備）
const DEFAULT_CONFIG: AppConfig = {
  audioChunkDurationSec: 15,
  audioChunkOverlapSec: 0, 
  transcriptDisplayIntervalSec: 15,
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000',
  wsBaseUrl: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
}

let cachedConfig: AppConfig | null = null

/**
 * 從後端 API 獲取統一配置
 */
export async function getUnifiedConfig(): Promise<AppConfig> {
  // 如果已有快取且在瀏覽器環境中，返回快取
  if (cachedConfig && typeof window !== 'undefined') {
    return cachedConfig
  }

  try {
    const apiBaseUrl = DEFAULT_CONFIG.apiBaseUrl
    const response = await fetch(`${apiBaseUrl}/api/config`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`配置 API 請求失敗: ${response.status}`)
    }

    const backendConfig = await response.json()
    
    cachedConfig = {
      audioChunkDurationSec: backendConfig.audioChunkDurationSec || DEFAULT_CONFIG.audioChunkDurationSec,
      audioChunkOverlapSec: backendConfig.audioChunkOverlapSec || DEFAULT_CONFIG.audioChunkOverlapSec,
      transcriptDisplayIntervalSec: backendConfig.transcriptDisplayIntervalSec || DEFAULT_CONFIG.transcriptDisplayIntervalSec,
      apiBaseUrl: DEFAULT_CONFIG.apiBaseUrl,
      wsBaseUrl: DEFAULT_CONFIG.wsBaseUrl
    }

    console.log('✅ [ConfigUnified] 從後端獲取統一配置:', cachedConfig)
    return cachedConfig

  } catch (error) {
    console.warn('⚠️ [ConfigUnified] 無法獲取後端配置，使用預設值:', error)
    cachedConfig = DEFAULT_CONFIG
    return DEFAULT_CONFIG
  }
}

/**
 * 清除配置快取（用於重新載入配置）
 */
export function clearConfigCache(): void {
  cachedConfig = null
}

/**
 * 計算有效音頻切片長度（考慮重疊）
 */
export function getEffectiveAudioChunkDuration(config: AppConfig): number {
  return config.audioChunkDurationSec - config.audioChunkOverlapSec
}

/**
 * 將秒數轉換為毫秒數
 */
export function getAudioChunkDurationMs(config: AppConfig): number {
  return config.audioChunkDurationSec * 1000
}

/**
 * 兼容舊版本的函數
 * @deprecated 請使用 getUnifiedConfig()
 */
export const getEffectiveAudioChunkDurationSec = async (): Promise<number> => {
  const config = await getUnifiedConfig()
  return getEffectiveAudioChunkDuration(config)
}

export const getTranscriptLabelIntervalSec = async (): Promise<number> => {
  const config = await getUnifiedConfig()
  return config.transcriptDisplayIntervalSec
}