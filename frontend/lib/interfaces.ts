export interface ISessionService {
    ensureFreshRecordingSession(): Promise<void>
}
