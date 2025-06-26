import '@testing-library/jest-dom'
import { vi } from 'vitest'

// 模擬 window.matchMedia (Radix UI 需要)
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
})

// 模擬 ResizeObserver (某些 UI 元件需要)
Object.defineProperty(global, 'ResizeObserver', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
    })),
})
