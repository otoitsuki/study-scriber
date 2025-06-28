import { describe, test, expect, beforeEach, vi } from 'vitest'
import { StateSyncBridge } from '../migration-adapter'
import { AppStateContextValue } from '../../types/app-state-context'
import { LegacyAppStateHook } from '../migration-adapter'

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('StateSyncBridge', () => {
    let bridge: StateSyncBridge
    let mockNewContext: AppStateContextValue
    let mockLegacyHook: LegacyAppStateHook

    beforeEach(() => {
        bridge = new StateSyncBridge()

        // Mock new context
        mockNewContext = {
            appData: {
                state: 'default',
                transcriptEntries: [],
                editorContent: '',
                isRecording: false,
                recordingTime: 0,
                session: null,
            },
            isLoading: false,
            error: null,
            dispatch: vi.fn(),
            setState: vi.fn(),
            setRecording: vi.fn(),
            setRecordingTime: vi.fn(),
            setEditorContent: vi.fn(),
            setTranscriptEntries: vi.fn(),
            addTranscriptEntry: vi.fn(),
            setSession: vi.fn(),
            updateSessionStatus: vi.fn(),
            resetState: vi.fn(),
            setLoading: vi.fn(),
            setError: vi.fn(),
        }

        // Mock legacy hook
        mockLegacyHook = {
            appData: {
                state: 'default',
                transcriptEntries: [],
                editorContent: '',
                isRecording: false,
                recordingTime: 0,
                session: null,
            },
            isLoading: false,
            error: null,
            startRecording: vi.fn(),
            stopRecording: vi.fn(),
            newNote: vi.fn(),
            saveLocalDraft: vi.fn(),
            session: null,
            recordingError: null,
            transcriptError: null,
            createNoteSession: vi.fn(),
            sessionLoading: false,
        }
    })

    test('should register new context successfully', () => {
        bridge.registerNewContext(mockNewContext)
        expect(bridge.getSyncStatus().enabled).toBe(true)
    })

    test('should register legacy hook successfully', () => {
        bridge.registerLegacyHook(mockLegacyHook)
        expect(bridge.getSyncStatus().enabled).toBe(true)
    })

    test('should enable and disable sync', () => {
        bridge.disableSync()
        expect(bridge.getSyncStatus().enabled).toBe(false)

        bridge.enableSync()
        expect(bridge.getSyncStatus().enabled).toBe(true)
    })

    test('should provide sync status', () => {
        const status = bridge.getSyncStatus()
        expect(status).toHaveProperty('enabled')
        expect(status).toHaveProperty('lastSync')
        expect(status).toHaveProperty('inProgress')
    })
})
