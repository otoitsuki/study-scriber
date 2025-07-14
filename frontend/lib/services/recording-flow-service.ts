"use client"

import { BaseService } from './base-service'
import { serviceContainer } from './service-container'
import { SERVICE_KEYS, type ISessionService, type IRecordingService, type ITranscriptService, type TranscriptMessage } from './interfaces'
import type { SessionResponse } from '../api'
import { useAppStore } from '../app-store-zustand'
import { formatTime } from '../../utils/time'

const setAppState = useAppStore.getState().setState

/**
 * 錄音流程管理服務
 *
 * 整合 SessionService、RecordingService 和 TranscriptService
 * 提供統一的錄音流程管理
 */
import { STTProvider } from '../api'

const AUDIO_CHUNK_SEC = Number(
  process.env.NEXT_PUBLIC_AUDIO_CHUNK_INTERVAL_SEC ?? "15"
);

export class RecordingFlowService extends BaseService {
  protected readonly serviceName = 'RecordingFlowService'

  // 服務依賴
  private sessionService!: ISessionService
  private recordingService!: IRecordingService
  private transcriptService!: ITranscriptService

  // 流程狀態
  private currentSession: SessionResponse | null = null
  private isFlowActive = false
  private labelIntervalSec = Number(process.env.NEXT_PUBLIC_TRANSCRIPT_LABEL_INTERVAL ?? '15')
  private lastLabelSec = 0
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
  async startRecordingFlow(title?: string, content?: string, startTs?: number, sttProvider?: STTProvider): Promise<SessionResponse> {
    this.logInfo('開始錄音流程', { title, content, startTs })

    try {
      // ① 先拿權限
      if (!(await this.recordingService.requestPermission())) {
        setAppState('default')
        throw new Error('麥克風權限被拒')
      }

      // === 🛠 追加: 若有現有活躍會話，先結束它，避免 Session 打架 ===
      const activeSession = await this.sessionService.checkActiveSession()
      if (activeSession) {
        this.logInfo('檢測到現有活躍會話，先完成它以避免衝突', {
          sessionId: activeSession.id,
          type: activeSession.type,
          status: activeSession.status
        })
        await this.sessionService.finishSession(activeSession.id)
        this.logSuccess('已完成現有活躍會話', { sessionId: activeSession.id })
      }
      // === 🛠 追加結束 ===

      // ② 建 Session（POST /session）
      const session = await this.sessionService.createRecordingSession(
        title || `錄音筆記 ${new Date().toLocaleString()}`,
        content,
        startTs,
        sttProvider
      )
      if (!session) {
        setAppState('default')
        throw new Error('建立 Session 失敗')
      }

      // ③ 啟動逐字稿服務
      await this.transcriptService.start(session.id)
      setAppState('recording_waiting')

      // 步驟 1: 使用新建立的會話
      this.currentSession = session
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

      // 通知全域狀態：設置錄音開始時間，啟動計時器
      try {
        const setRecordingStart = (await import('../app-store-zustand')).useAppStore.getState().setRecordingStart
        setRecordingStart(Date.now())
        console.log('🕐 [RecordingFlowService] 已透過 AppStore 設置錄音開始時間')
      } catch (e) {
        console.warn('⚠️ [RecordingFlowService] 無法設置錄音開始時間:', e)
      }

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
  private handleTranscriptMessage = (msg: TranscriptMessage): void => {
    try {
      // 1. 判斷訊息型別
      if (
        (msg.type === 'transcript' || msg.type === 'transcript_segment') &&
        msg.text
      ) {
        /* 2. 計算 startSec
           a. 後端若有 start_time → 用它
           b. 否則用 chunk_sequence × 切片長度
        */
        const startSec =
          msg.start_time !== undefined
            ? msg.start_time
            : (msg.chunk_sequence ?? 0) * AUDIO_CHUNK_SEC;

        /* 3. 每隔 labelIntervalSec 秒插入一條時間碼 */
        if (startSec - this.lastLabelSec >= this.labelIntervalSec) {
          this.transcriptEntries.push({
            time: formatTime(startSec),
            text: '',              // 純時間標籤
          })
          this.lastLabelSec = startSec
        }

        /* 4. 真正的逐字稿行 */
        this.transcriptEntries.push({
          time: formatTime(startSec),
          text: msg.text.trim(),
        })
      } else if (msg.type === 'error') {
        this.logWarning('逐字稿錯誤', msg)
      }
    } catch (e) {
      this.logWarning('處理逐字稿訊息失敗', e)
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
