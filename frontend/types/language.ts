/**
 * 語言相關的類型定義和常數
 */

export type LanguageCode = 'zh-TW' | 'en-US'

export interface LanguageOption {
    code: LanguageCode
    label: string
    nativeLabel: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
    {
        code: 'zh-TW',
        label: 'Traditional Chinese',
        nativeLabel: '繁體中文'
    },
    {
        code: 'en-US',
        label: 'English (US)',
        nativeLabel: 'English'
    }
] as const

export const DEFAULT_LANGUAGE: LanguageCode = 'zh-TW'

export const LANGUAGE_STORAGE_KEY = 'selected_language'