"use client"

import dynamic from "next/dynamic"
import Component from "../study-scriber"

// 添加全局除錯功能
if (typeof window !== 'undefined') {
  (window as any).debugTranscript = () => {
    const testMessage = {
      type: 'transcript_segment',
      text: '測試逐字稿內容 - 如果看到這個表示前端可以正常處理',
      start_time: 0,
      end_time: 12,
      start_sequence: 0,
      confidence: 0.95
    };

    // 取得當前 session ID
    const appData = (window as any).appData;
    const sessionId = appData?.session?.id || '861f8cee-1f57-476c-8819-0ffe9ec084c8';

    console.log('🔍 測試逐字稿接收，Session ID:', sessionId);

    // 直接觸發 TranscriptManager 的訊息處理
    const manager = (window as any).transcriptManager;
    if (manager) {
      const listeners = manager.listeners.get(sessionId);
      if (listeners && listeners.size > 0) {
        console.log(`📡 找到 ${listeners.size} 個監聽器，開始廣播測試訊息`);
        listeners.forEach((callback: any) => {
          try {
            callback(testMessage);
            console.log('✅ 測試訊息已發送');
          } catch (error) {
            console.error('❌ 發送測試訊息失敗:', error);
          }
        });
      } else {
        console.error('❌ 沒有找到監聽器，請確認 WebSocket 已連接');
      }
    } else {
      console.error('❌ TranscriptManager 未初始化');
    }
  };

  // 新增：診斷函數
  (window as any).debugState = () => {
    const appData = (window as any).appData;
    console.log('🔍 完整應用狀態診斷：');
    console.log('1. AppData:', appData);
    console.log('2. Session:', appData?.session);
    console.log('3. 錄音狀態:', {
      isRecording: appData?.isRecording,
      recordingTime: appData?.recordingTime,
      state: appData?.state
    });
    console.log('4. 逐字稿:', {
      transcriptEntries: appData?.transcriptEntries,
      count: appData?.transcriptEntries?.length || 0
    });

    // 檢查 transcriptManager 的內部狀態
    const manager = (window as any).transcriptManager;
    if (manager) {
      console.log('5. TranscriptManager:');
      console.log('   - 連接數:', manager.getConnectionCount());
      console.log('   - 連接Map:', manager.connections);
      console.log('   - 監聽器Map:', manager.listeners);
    }

    // 檢查為什麼狀態是 default
    console.log('6. 狀態映射條件:');
    console.log('   - hasSession:', !!appData?.session);
    console.log('   - sessionStatus:', appData?.session?.status);
    console.log('   - sessionType:', appData?.session?.type);
    console.log('   - isRecording:', appData?.isRecording);
    console.log('   - transcriptCount:', appData?.transcriptEntries?.length || 0);
  };

  // 新增：監聽逐字稿更新
  (window as any).watchTranscripts = () => {
    const sessionId = '861f8cee-1f57-476c-8819-0ffe9ec084c8';

    // 添加一個測試監聽器
    const testListener = (message: any) => {
      console.log('🎯 [測試監聽器] 收到訊息:', {
        type: message.type,
        text: message.text,
        time: new Date().toISOString()
      });
    };

    const manager = (window as any).transcriptManager;
    if (manager) {
      manager.addListener(sessionId, testListener);
      console.log('✅ 測試監聽器已添加，等待逐字稿訊息...');

      // 返回移除函數
      return () => {
        manager.removeListener(sessionId, testListener);
        console.log('❌ 測試監聽器已移除');
      };
    } else {
      console.error('❌ TranscriptManager 未初始化');
      return () => { };
    }
  };

  // 新增：手動推送逐字稿
  (window as any).pushTranscript = (text: string, startTime: number = 0) => {
    const appData = (window as any).appData;
    if (!appData) {
      console.error('❌ appData 未定義');
      return;
    }

    // 計算時間格式
    const minutes = Math.floor(startTime / 60);
    const seconds = Math.floor(startTime % 60);
    const timeStr = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

    // 創建新的逐字稿項目
    const newEntry = {
      time: timeStr,
      text: text
    };

    // 更新 appData
    const currentEntries = appData.transcriptEntries || [];
    const newEntries = [...currentEntries, newEntry];

    // 手動觸發狀態更新
    console.log('📝 手動推送逐字稿:', newEntry);
    console.log('📊 更新前:', currentEntries.length, '條');
    console.log('📊 更新後:', newEntries.length, '條');

    // 更新狀態
    appData.transcriptEntries = newEntries;

    // 如果狀態還是 recording_waiting，改為 recording_active
    if (appData.state === 'recording_waiting' && newEntries.length > 0) {
      appData.state = 'recording_active';
      console.log('✅ 狀態更新: recording_waiting → recording_active');
    }

    // 強制重新渲染
    window.location.reload();
  };

  // 新增：診斷 WebSocket 和狀態
  (window as any).diagnose = () => {
    console.log('🔍 ========== 診斷開始 ==========');

    // 1. 檢查 appData 狀態
    const appData = (window as any).appData;
    console.log('📊 [1] appData 狀態:', {
      state: appData?.state,
      isRecording: appData?.isRecording,
      transcriptEntries: appData?.transcriptEntries?.length || 0,
      session: appData?.session
    });

    // 2. 檢查 recording hook 狀態
    const recordingHook = (window as any).recordingHook;
    if (recordingHook) {
      console.log('🎤 [2] recording hook 狀態:', {
        isRecording: recordingHook.isRecording,
        transcriptsCount: recordingHook.transcripts?.length || 0,
        transcripts: recordingHook.transcripts
      });
    } else {
      console.error('❌ [2] recording hook 未找到');
    }

    // 3. 檢查 TranscriptManager 狀態
    const manager = (window as any).transcriptManager;
    if (manager) {
      const sessionId = appData?.session?.id;
      if (sessionId) {
        console.log('📡 [3] TranscriptManager 狀態:', {
          sessionId,
          isConnected: manager.isConnected(sessionId),
          connectionCount: manager.getConnectionCount(),
          listeners: manager.listeners.get(sessionId)?.size || 0
        });

        // 檢查 WebSocket 詳情
        const ws = manager.connections.get(sessionId);
        if (ws) {
          console.log('🔌 [4] WebSocket 詳情:', {
            readyState: ws.readyState,
            isConnected: ws.isConnected,
            url: ws.url
          });
        } else {
          console.error('❌ [4] WebSocket 未找到');
        }
      } else {
        console.error('❌ [3] session ID 未定義');
      }
    } else {
      console.error('❌ [3] TranscriptManager 未找到');
    }

    console.log('🔍 ========== 診斷結束 ==========');
  };

  // 新增：強制 React 重新渲染
  (window as any).forceUpdate = () => {
    console.log('🔄 強制 React 重新渲染...');

    // 方法 1：創建一個微小的狀態變化來觸發重新渲染
    const appData = (window as any).appData;
    if (appData) {
      const originalRecordingTime = appData.recordingTime;
      appData.recordingTime = originalRecordingTime + 0.1;

      setTimeout(() => {
        appData.recordingTime = originalRecordingTime;
        console.log('✅ 強制更新完成');
      }, 100);
    }

    // 方法 2：如果上面不工作，重新載入頁面
    console.log('如果UI還是沒有更新，將在3秒後重新載入頁面...');
    setTimeout(() => {
      if (confirm('UI 沒有更新，是否重新載入頁面？')) {
        window.location.reload();
      }
    }, 3000);
  };
}

export default function Page() {
  return <Component />
}
