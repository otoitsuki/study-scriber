/**
 * LLM 配置相關類型定義
 * 用於前端與後端的 LLM 配置管理
 */

export interface LLMConfig {
    baseUrl: string
    apiKey: string
    model: string
    apiVersion?: string
}

export interface LLMTestCapabilities {
    transcription: boolean
    summary: boolean
}

export interface LLMTestErrors {
    transcription?: string
    chat?: string
}

export interface LLMTestResponse {
    success: boolean
    detectedProvider: 'azure' | 'openai' | 'openai_compatible' | 'unknown'
    detectedSttMethod: 'whisper' | 'gpt4o-audio' | 'gemini' | 'unknown'
    capabilities: LLMTestCapabilities
    errors?: LLMTestErrors
    error?: string
}

export interface LLMConfigFormData {
    baseUrl: string
    apiKey: string
    model: string
    apiVersion: string
}

export interface LLMConfigValidation {
    isValid: boolean
    errors: {
        baseUrl?: string
        apiKey?: string
        model?: string
        apiVersion?: string
    }
}

// 預設配置
export const DEFAULT_LLM_CONFIGS = {
    openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'whisper-1',
        apiVersion: ''
    },
    azure: {
        baseUrl: 'https://your-resource.openai.azure.com',
        model: 'whisper-deployment',
        apiVersion: '2024-06-01'
    }
} as const

// 常見模型選項
export const COMMON_MODELS = {
    whisper: [
        'whisper-1',
        'whisper-large-v3',
        'whisper-large-v2'
    ],
    gpt4o: [
        'gpt-4o',
        'gpt-4o-audio-preview',
        'gpt-4o-mini'
    ],
    gemini: [
        'gemini-1.5-pro',
        'gemini-1.5-flash'
    ]
} as const

// LocalStorage 鍵名
export const LLM_CONFIG_STORAGE_KEYS = {
    BASE_URL: 'llm_base_url',
    API_KEY: 'llm_api_key',
    MODEL: 'llm_model',
    API_VERSION: 'llm_api_version'
} as const

