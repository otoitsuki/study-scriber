/**
 * 語言管理工具函數
 */

import { LanguageCode, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from '@/types/language'

/**
 * 從 localStorage 取得使用者選擇的語言
 */
export function getSelectedLanguage(): LanguageCode {
    if (typeof window === 'undefined') {
        return DEFAULT_LANGUAGE
    }

    try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
        if (stored && isValidLanguageCode(stored)) {
            return stored as LanguageCode
        }
    } catch (error) {
        console.warn('讀取語言設定失敗:', error)
    }

    return DEFAULT_LANGUAGE
}

/**
 * 儲存使用者選擇的語言到 localStorage
 */
export function saveSelectedLanguage(language: LanguageCode): void {
    if (typeof window === 'undefined') {
        return
    }

    try {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
        console.log('✅ 語言設定已儲存:', language)
    } catch (error) {
        console.error('儲存語言設定失敗:', error)
    }
}

/**
 * 取得語言選項的顯示標籤
 */
export function getLanguageLabel(code: LanguageCode): string {
    const option = SUPPORTED_LANGUAGES.find(lang => lang.code === code)
    return option ? option.nativeLabel : code
}

/**
 * 檢查語言代碼是否有效
 */
export function isValidLanguageCode(code: string): boolean {
    return SUPPORTED_LANGUAGES.some(lang => lang.code === code)
}

/**
 * 取得所有支援的語言選項
 */
export function getSupportedLanguages() {
    return SUPPORTED_LANGUAGES
}