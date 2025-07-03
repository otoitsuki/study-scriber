"use client"

import { BaseService } from './base-service'
import { serviceContainer } from './service-container'
import { SERVICE_KEYS, type ISessionService, type IRecordingService, type ITranscriptService, type TranscriptMessage } from './interfaces'
import type { SessionResponse } from '../api'
import { useAppStore } from '../app-store-zustand'
const setAppState = useAppStore.getState().setState

/**
 * 錄音流程管理服務
 *
 * 整合 SessionService、RecordingService 和 TranscriptService
 * 提供統一的錄音流程管理
 */
export class RecordingFlowService extends BaseService {
  protected readonly serviceName = 'RecordingFlowService'

  // 服務依賴
  private sessionService!: ISessionService
  private recordingService!: IRecordingService
  private transcriptService!: ITranscriptService

  // 流程狀態
  private currentSession: SessionResponse | null = null
  private isFlowActive = false
  private transcriptEntries: Array<{ time: string; text: string }> = []

  /**
   * 服務初始化
   */
  async initialize(): Promise<void> {
    this.logInfo('初始化錄音流程服務')

    // 解析服務依賴
    this.sessionService = serviceContainer.resolve<ISessionService>(SERVICE_KEYS.SESSION_SERVICE)
    this.recordingService = serviceContainer.resolve<IRecordingService>(SERVICE_KEYS.RECORDING_SERVICE)
    this.transcriptService = serviceContainer.resolve<ITranscriptService>(SERVICE_KEYS.TRANSCRIPT_SERVICE)

    this.logSuccess('服務依賴解析完成')
    this.logSuccess('初始化完成')
  }

  /**
   * 服務清理
   */
  async cleanup(): Promise<void> {
    this.logInfo('清理錄音流程服務')

    // 如果有活躍的流程，先停止
    if (this.isFlowActive) {
      await this.stopRecordingFlow()
    }

    // 重置狀態
    this.currentSession = null
    this.isFlowActive = false
    this.transcriptEntries = []

    this.logSuccess('清理完成')
  }

  /**
   * 開始錄音流程
   */
  async startRecordingFlow(title?: string, content?: string, startTs?: number): Promise<SessionResponse> {
    this.logInfo('開始錄音流程', { title, content, startTs })

    try {
      // ① 先拿權限
      if (!(await this.recordingService.requestPermission())) {
        setAppState('default')
        throw new Error('麥克風權限被拒')
      }

      // ② 建 Session（POST /session）
      const session = await this.sessionService.createRecordingSession()
      if (!session) {
        setAppState('default')
        throw new Error('建立 Session 失敗')
      }

      // ③ 啟動錄音／WS／計時器
      await this.recordingService.start(session.id)
      await this.transcriptService.start(session.id)
      setAppState('recording_waiting')

      // 步驟 1: 確保錄音會話存在（傳遞開始時間戳）
      this.logInfo('步驟 1: 確保錄音會話')
      this.currentSession = await this.sessionService.ensureRecordingSession(title, content, startTs)
      this.logSuccess('錄音會話已準備', { sessionId: this.currentSession.id, withStartTs: !!startTs })

      // 步驟 2: 等待會話在資料庫中完全可見
      this.logInfo('步驟 2: 等待會話準備完成')
      const isReady = await this.sessionService.waitForSessionReady(this.currentSession.id, 5000)
      if (!isReady) {
        throw new Error('會話準備超時')
      }
      this.logSuccess('會話準備完成')

      // 步驟 3: 連接逐字稿服務
      this.logInfo('步驟 3: 連接逐字稿服務')
      await this.transcriptService.connect(this.currentSession.id)
      this.setupTranscriptListener()
      this.logSuccess('逐字稿服務連接成功')

      // 步驟 4: 開始錄音
      this.logInfo('步驟 4: 開始錄音')
      await this.recordingService.startRecording(this.currentSession.id)
      this.logSuccess('錄音啟動成功')

      // 標記流程為活躍
      this.isFlowActive = true

      this.logSuccess('錄音流程啟動完成', {
        sessionId: this.currentSession.id,
        isRecording: this.recordingService.isRecording(),
        transcriptConnected: this.transcriptService.isConnected(this.currentSession.id)
      })

      // 診斷資訊
      console.log('🎉 [RecordingFlowService] 錄音流程已完全啟動', {
        sessionId: this.currentSession.id,
        audioRecording: this.recordingService.isRecording() ? '✅ 錄音中' : '❌ 未錄音',
        transcriptWS: this.transcriptService.isConnected(this.currentSession.id) ? '✅ 已連接' : '❌ 未連接',
        recordingState: this.recordingService.getRecordingState(),
        timestamp: new Date().toISOString()
      })

      console.log('📋 [RecordingFlowService] 請檢查：')
      console.log('1. 應該每秒看到 [AudioRecorder] ondataavailable 觸發')
      console.log('2. 應該每秒看到 [AudioUploadWebSocket] Binary frame 已送出')
      console.log('3. DevTools > Network > WS > /ws/upload_audio 應該看到 binary frames')
      console.log('4. DevTools > Network > WS > /ws/transcript_feed 應該收到逐字稿')

      return this.currentSession

    } catch (error) {
      await this.cleanupFlowResources()
      this.handleError('開始錄音流程', error)
      throw error
    }
  }

  /**
   * 停止錄音流程
   */
  async stopRecordingFlow(): Promise<void> {
    this.logInfo('停止錄音流程')

    try {
      if (!this.isFlowActive || !this.currentSession) {
        this.logWarning('沒有活躍的錄音流程')
        return
      }

      const sessionId = this.currentSession.id

      // 步驟 1: 停止錄音
      this.logInfo('步驟 1: 停止錄音')
      if (this.recordingService.isRecording()) {
        await this.recordingService.stopRecording()
        this.logSuccess('錄音已停止')
      }

      // 步驟 2: 斷開逐字稿服務（保持連接以接收剩餘處理結果）
      this.logInfo('步驟 2: 斷開逐字稿服務')
      await this.transcriptService.disconnect(sessionId)
      this.logSuccess('逐字稿服務已斷開')

      // 步驟 3: 完成會話
      this.logInfo('步驟 3: 完成會話')
      await this.sessionService.finishSession(sessionId)
      this.logSuccess('會話已完成')

      // 重置流程狀態
      this.isFlowActive = false

      this.logSuccess('錄音流程停止完成', {
        sessionId,
        transcriptEntriesCount: this.transcriptEntries.length,
        finalRecordingTime: this.recordingService.getRecordingTime()
      })

    } catch (error) {
      this.handleError('停止錄音流程', error)
      throw error
    } finally {
      // 確保資源清理
      await this.cleanupFlowResources()
    }
  }

  /**
   * 取得當前會話
   */
  getCurrentSession(): SessionResponse | null {
    return this.currentSession
  }

  /**
   * 檢查流程是否活躍
   */
  isFlowRunning(): boolean {
    return this.isFlowActive
  }

  /**
   * 取得逐字稿項目
   */
  getTranscriptEntries(): Array<{ time: string; text: string }> {
    return [...this.transcriptEntries]
  }

  /**
   * 取得錄音狀態
   */
  getRecordingState() {
    return this.recordingService.getRecordingState()
  }

  /**
   * 設定逐字稿監聽器
   */
  private setupTranscriptListener(): void {
    if (!this.currentSession) return

    const sessionId = this.currentSession.id

    // 移除現有監聽器（如果有）
    this.transcriptService.removeTranscriptListener(sessionId, this.handleTranscriptMessage)

    // 添加新的監聽器
    this.transcriptService.addTranscriptListener(sessionId, this.handleTranscriptMessage)

    this.logInfo('逐字稿監聽器已設定', { sessionId })
  }

  /**
   * 處理逐字稿訊息
   */
  private handleTranscriptMessage = (message: TranscriptMessage): void => {
    this.logInfo('收到逐字稿訊息', { type: message.type, hasText: !!message.text })

    try {
      if (message.type === 'transcript' && message.text) {
        // 使用 start_time 並轉換為 HH:MM:SS 格式
        const startTime = message.start_time ?? 0
        const hours = Math.floor(startTime / 3600)
        const minutes = Math.floor((startTime % 3600) / 60)
        const seconds = Math.floor(startTime % 60)
        const time = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`

        // 添加逐字稿項目
        const entry = {
          time,
          text: message.text.trim()
        }

        this.transcriptEntries.push(entry)

        this.logInfo('逐字稿項目已添加', {
          time: entry.time,
          textLength: entry.text.length,
          totalEntries: this.transcriptEntries.length
        })
      } else if (message.type === 'error') {
        this.logWarning('逐字稿錯誤', {
          errorType: message.error_type,
          errorMessage: message.error_message
        })
      }
    } catch (error) {
      this.logWarning('處理逐字稿訊息失敗', error)
    }
  }

  /**
   * 清理流程資源
   */
  private async cleanupFlowResources(): Promise<void> {
    try {
      // 停止錄音（如果還在錄音）
      if (this.recordingService?.isRecording()) {
        await this.recordingService.stopRecording()
      }

      // 斷開逐字稿服務
      if (this.currentSession && this.transcriptService?.isConnected(this.currentSession.id)) {
        await this.transcriptService.disconnect(this.currentSession.id)
      }

      // 重置狀態
      this.currentSession = null
      this.isFlowActive = false

      this.logInfo('流程資源清理完成')
    } catch (error) {
      this.logWarning('清理流程資源時發生錯誤', error)
    }
  }

  /**
   * 取得流程詳細狀態
   */
  async getFlowStatus() {
    const baseStatus = this.getStatus()

    return {
      ...baseStatus,
      isFlowActive: this.isFlowActive,
      currentSession: this.currentSession,
      transcriptEntriesCount: this.transcriptEntries.length,
      recordingState: this.recordingService?.getRecordingState() || null,
      transcriptConnected: this.currentSession
        ? this.transcriptService?.isConnected(this.currentSession.id) || false
        : false
    }
  }
}
