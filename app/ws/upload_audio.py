"""
WebSocket 音檔上傳服務

實作音檔切片即時上傳、重傳機制與 Cloudflare R2 整合
"""

import json
import logging
import asyncio
import struct
from typing import Dict, Set, Optional, List
from uuid import UUID
from datetime import datetime, timedelta

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, WebSocketException, status, Path, Depends
from supabase import Client
from fastapi import HTTPException
from app.core.container import container
from app.services.azure_openai_v2 import SimpleAudioTranscriptionService
from ..db.database import get_supabase_client
from ..services.r2_client import get_r2_client, R2ClientError

logger = logging.getLogger(__name__)

router = APIRouter()

class AudioUploadManager:
    """音檔上傳管理器"""

    def __init__(self, websocket: WebSocket, session_id: UUID, supabase_client: Client):
        self.websocket = websocket
        self.session_id = session_id
        self.supabase_client = supabase_client
        self.r2_client = get_r2_client()

        # 狀態管理
        self.is_connected = False
        self.received_chunks: Set[int] = set()  # 已收到的切片序號
        self.last_heartbeat = datetime.utcnow()
        self.upload_tasks: Dict[int, asyncio.Task] = {}  # 上傳任務追蹤

        # 設定
        self.heartbeat_interval = 30  # 心跳間隔（秒）
        self.chunk_timeout = 10  # 切片處理超時（秒）
        self.max_pending_uploads = 5  # 最大並行上傳數

    async def _initialize_received_chunks(self):
        """從資料庫初始化已收到的切片集合"""
        try:
            response = self.supabase_client.table("audio_files").select("chunk_sequence").eq("session_id", str(self.session_id)).execute()
            if response.data:
                self.received_chunks = {item['chunk_sequence'] for item in response.data}
                logger.info(f"從資料庫恢復 {len(self.received_chunks)} 個已存在的切片記錄 for session {self.session_id}")
        except Exception as e:
            logger.error(f"從資料庫初始化 received_chunks 失敗: {e}")
            # 即使初始化失敗，也繼續執行，但使用空的集合
            self.received_chunks = set()

    async def handle_connection(self):
        """處理 WebSocket 連接"""
        logger.info("<<<<< RUNNING UPLOAD_AUDIO.PY CODE (v5) >>>>>")
        try:
            # 接受連接
            await self.websocket.accept()
            self.is_connected = True
            logger.info(f"WebSocket 連接建立: session_id={self.session_id}")

            # 從資料庫加載已有的切片，以處理重連情況
            await self._initialize_received_chunks()

            # 驗證會話狀態
            if not await self._validate_session():
                await self._send_error("Invalid session or session not in recording mode")
                return

            # 發送連接確認
            await self._send_message({
                "type": "connection_established",
                "session_id": str(self.session_id),
                "timestamp": datetime.utcnow().isoformat()
            })

            # 啟動心跳檢測
            heartbeat_task = asyncio.create_task(self._heartbeat_monitor())

            try:
                # 主要消息處理循環
                await self._message_loop()
            finally:
                # 清理資源
                heartbeat_task.cancel()
                await self._cleanup()

        except WebSocketDisconnect:
            logger.info(f"WebSocket 連接斷開: session_id={self.session_id}")
        except Exception as e:
            logger.error(f"WebSocket 處理異常: {e}")
            await self._send_error(f"Connection error: {str(e)}")
        finally:
            self.is_connected = False

    async def _validate_session(self) -> bool:
        """驗證會話存在且處於錄音模式"""
        try:
            response = self.supabase_client.table("sessions").select("*").eq("id", str(self.session_id)).single().execute()

            if not response.data:
                logger.warning(f"會話不存在: {self.session_id}")
                return False

            session = response.data

            if session.get('status') != 'active':
                logger.warning(f"會話非活躍狀態: {self.session_id}, status={session.get('status')}")
                return False

            if session.get('type') != 'recording':
                logger.warning(f"會話非錄音模式: {self.session_id}, type={session.get('type')}")
                return False

            return True
        except Exception as e:
            logger.error(f"會話驗證時發生異常: {self.session_id}, error: {e}")
            return False

    async def _message_loop(self):
        """主要消息處理循環"""
        while self.is_connected:
            try:
                # 接收消息（二進制或文本）
                data = await self.websocket.receive()

                if "bytes" in data:
                    # 處理二進制音檔切片
                    await self._handle_audio_chunk(data["bytes"])
                elif "text" in data:
                    # 處理文本消息（心跳、控制指令等）
                    await self._handle_text_message(data["text"])

            except WebSocketDisconnect:
                # Case 1: 客戶端正常、乾淨地關閉連接
                logger.info("WebSocket gracefully disconnected by client.")
                self.is_connected = False # 確保迴圈終止
                break # 乾淨地退出迴圈

            except RuntimeError as e:
                # Case 2: 連接意外中斷，導致 receive() 失敗
                # 注意：這裡的 "receive" 必須是雙引號，才能匹配異常消息
                if 'Cannot call "receive" once a disconnect message has been received' in str(e):
                    logger.info(f"WebSocket connection closed (RuntimeError on receive), breaking loop: {e}")
                    self.is_connected = False # 確保迴圈終止
                    break # 乾淨地退出迴圈
                else:
                    # 處理其他類型的 RuntimeError
                    logger.error(f"An unexpected runtime error occurred in message loop: {e}", exc_info=True)
                    await self._send_error(f"Message processing runtime error: {str(e)}")
                    # 即使發送錯誤，也要中斷迴圈
                    self.is_connected = False
                    break

            except Exception as e:
                # Case 3: 處理所有其他未預期的錯誤
                logger.error(f"An unexpected error occurred in message loop: {e}", exc_info=True)
                await self._send_error(f"Message processing error: {str(e)}")
                # 發生未知錯誤後也中斷迴圈，避免無限循環
                self.is_connected = False
                break

    async def _handle_audio_chunk(self, chunk_data: bytes):
        """處理音檔切片數據"""
        try:
            # 解析切片格式：4字節序號 + 音檔數據
            if len(chunk_data) < 4:
                await self._send_error("Invalid chunk format: too short")
                return

            # 解包序號（小端序 unsigned int）
            chunk_sequence = struct.unpack('<I', chunk_data[:4])[0]
            audio_data = chunk_data[4:]

            if len(audio_data) == 0:
                await self._send_error(f"Empty audio data for chunk {chunk_sequence}")
                return

            logger.debug(f"收到音檔切片: seq={chunk_sequence}, size={len(audio_data)}")

            # 檢查是否為重複切片
            if chunk_sequence in self.received_chunks:
                logger.debug(f"忽略重複切片: seq={chunk_sequence}")
                await self._send_ack(chunk_sequence)
                return

            # 記錄已收到的切片
            self.received_chunks.add(chunk_sequence)

            # 限制並行上傳數量
            if len(self.upload_tasks) >= self.max_pending_uploads:
                # 等待最舊的上傳完成
                oldest_task = min(self.upload_tasks.values(), key=lambda t: t.get_name())
                await oldest_task

            # 非同步上傳到 R2
            upload_task = asyncio.create_task(
                self._upload_chunk_to_r2(chunk_sequence, audio_data)
            )
            self.upload_tasks[chunk_sequence] = upload_task

        except Exception as e:
            logger.error(f"音檔切片處理失敗: {e}")
            await self._send_error(f"Chunk processing error: {str(e)}")

    async def _upload_chunk_to_r2(self, chunk_sequence: int, audio_data: bytes):
        """上傳音檔切片到 R2 並觸發轉錄"""
        try:
            result = await self.r2_client.store_chunk_blob(
                session_id=self.session_id,
                chunk_sequence=chunk_sequence,
                blob_data=audio_data,
                supabase_client=self.supabase_client
            )

            if result['success']:
                # 上傳成功，發送 ACK
                await self._send_ack(chunk_sequence)
                logger.debug(f"切片上傳成功: seq={chunk_sequence}, size={len(audio_data)}")

                # 從容器解析服務並啟動轉錄
                try:
                    transcription_service = container.resolve(SimpleAudioTranscriptionService)
                    if transcription_service:
                        logger.info(f"🎯 [轉錄觸發] 開始處理切片 {chunk_sequence} (session: {self.session_id})")
                        success = await transcription_service.process_audio_chunk(
                            session_id=self.session_id,
                            chunk_sequence=chunk_sequence,
                            webm_data=audio_data
                        )
                        if success:
                            logger.info(f"✅ [轉錄觸發] 切片 {chunk_sequence} 轉錄任務啟動成功")
                        else:
                            logger.warning(f"⚠️ [轉錄觸發] 切片 {chunk_sequence} 轉錄任務啟動失敗")
                    else:
                        logger.error("❌ [轉錄觸發] 轉錄服務不可用，跳過轉錄")
                except Exception as e:
                    logger.error(f"❌ [轉錄觸發] 解析轉錄服務失敗 (chunk {chunk_sequence}): {e}")
                    # 即使轉錄失敗，也不影響音檔上傳流程
            else:
                # 上傳失敗
                error_message = result.get('error', 'Unknown R2 upload error')
                await self._send_upload_error(chunk_sequence, error_message)
                # 從 received_chunks 移除，允許重試
                self.received_chunks.discard(chunk_sequence)
                logger.error(f"切片上傳失敗: seq={chunk_sequence}, error={error_message}")

        except Exception as e:
            logger.error(f"上傳到 R2 失敗: seq={chunk_sequence}, error: {e}")
            await self._send_upload_error(chunk_sequence, str(e))
            # 從 received_chunks 移除，允許重試
            self.received_chunks.discard(chunk_sequence)
        finally:
            # 清理追蹤字典中的任務
            self.upload_tasks.pop(chunk_sequence, None)

    async def _handle_text_message(self, message_text: str):
        """處理文本消息"""
        try:
            message = json.loads(message_text)
            msg_type = message.get("type")

            if msg_type == "heartbeat":
                # 更新心跳時間
                self.last_heartbeat = datetime.utcnow()
                await self._send_message({"type": "heartbeat_ack"})

            elif msg_type == "request_missing":
                # 客戶端請求缺失切片列表
                await self._send_missing_chunks()

            elif msg_type == "upload_complete":
                # 客戶端表示上傳完成
                await self._handle_upload_complete()

            else:
                logger.warning(f"未知消息類型: {msg_type}")

        except json.JSONDecodeError:
            logger.error(f"JSON 解析失敗: {message_text}")
            await self._send_error("Invalid JSON message")
        except Exception as e:
            logger.error(f"文本消息處理失敗: {e}")
            await self._send_error(f"Text message error: {str(e)}")

    async def _send_ack(self, chunk_sequence: int):
        """發送切片確認"""
        await self._send_message({
            "type": "ack",
            "chunk_sequence": chunk_sequence,
            "timestamp": datetime.utcnow().isoformat()
        })

    async def _send_upload_error(self, chunk_sequence: int, error_msg: str):
        """發送上傳錯誤"""
        await self._send_message({
            "type": "upload_error",
            "chunk_sequence": chunk_sequence,
            "error": error_msg,
            "timestamp": datetime.utcnow().isoformat()
        })

    async def _send_missing_chunks(self):
        """發送缺失切片列表（實作重傳機制）"""
        # 這裡可以實作更複雜的缺失檢測邏輯
        # 目前簡單返回已收到的切片列表
        await self._send_message({
            "type": "chunk_status",
            "received_chunks": sorted(list(self.received_chunks)),
            "total_received": len(self.received_chunks),
            "timestamp": datetime.utcnow().isoformat()
        })

    async def _handle_upload_complete(self):
        """處理上傳完成"""
        # 等待所有進行中的上傳完成
        if self.upload_tasks:
            logger.info(f"等待 {len(self.upload_tasks)} 個上傳任務完成")
            await asyncio.gather(*self.upload_tasks.values(), return_exceptions=True)

        # 向客戶端確認全部切片已接收
        await self._send_message({
            "type": "all_chunks_received"
        })
        await self._send_message({
            "type": "upload_complete_ack",
            "total_chunks": len(self.received_chunks),
            "timestamp": datetime.utcnow().isoformat()
        })

        logger.info(f"音檔上傳完成: session_id={self.session_id}, chunks={len(self.received_chunks)}")

    async def _heartbeat_monitor(self):
        """心跳監控器，超時則關閉連接"""
        while self.is_connected:
            await asyncio.sleep(self.heartbeat_interval)
            if datetime.utcnow() - self.last_heartbeat > timedelta(seconds=self.heartbeat_interval * 2):
                logger.warning(f"心跳超時，關閉連接: session_id={self.session_id}")
                await self._send_error("Heartbeat timeout")
                await self.websocket.close(code=status.WS_1008_POLICY_VIOLATION)
                break

    async def _send_message(self, message: dict):
        """安全地發送消息（即使 is_connected 為 False 亦嘗試傳送，便於單元測試驗證）"""
        try:
            await self.websocket.send_text(json.dumps(message))
        except (WebSocketDisconnect, RuntimeError) as e:
            logger.warning(f"發送消息失敗，連接可能已關閉: {e}")
            self.is_connected = False  # 標記為已斷開

    async def _send_error(self, error_msg: str):
        """安全地發送錯誤消息"""
        logger.error(f"WebSocket 錯誤發送至客戶端: {error_msg}")
        await self._send_message({
            "type": "error",
            "message": error_msg
        })

    async def _cleanup(self):
        """清理資源，例如等待中的上傳任務"""
        if self.upload_tasks:
            logger.info(f"等待 {len(self.upload_tasks)} 個上傳任務完成...")
            await asyncio.gather(*self.upload_tasks.values())
        logger.info(f"清理完成: session_id={self.session_id}")


@router.websocket("/ws/upload_audio/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: UUID = Path(...),
    supabase_client: Client = Depends(get_supabase_client)
):
    """
    WebSocket 端點：處理音檔上傳

    - B-005: 建立 WebSocket 端點
    - B-012: 實作 ACK/Missing 重傳機制
    - 整合 Cloudflare R2 上傳與 Azure OpenAI 轉錄
    """
    manager = AudioUploadManager(websocket, session_id, supabase_client)
    await manager.handle_connection()


def handle_ack_missing(received_chunks: Set[int], expected_total: Optional[int] = None) -> dict:
    """
    根據已收到的切片列表，產生 ack/missing 報告 (B-012)

    Args:
        received_chunks: 已收到的切片序號集合
        expected_total: 預期的總切片數（可選）

    Returns:
        dict: ACK/Missing 狀態響應
    """
    if not received_chunks:
        return {
            "type": "status",
            "received_count": 0,
            "missing_chunks": [],
            "status": "waiting"
        }

    # 計算缺失的切片
    min_chunk = min(received_chunks)
    max_chunk = max(received_chunks)

    # 如果有指定總數，使用總數；否則基於最大序號推測
    total_expected = expected_total or (max_chunk + 1)

    expected_chunks = set(range(total_expected))
    missing_chunks = sorted(list(expected_chunks - received_chunks))

    return {
        "type": "status",
        "received_count": len(received_chunks),
        "expected_total": total_expected,
        "missing_chunks": missing_chunks,
        "status": "complete" if not missing_chunks else "incomplete"
    }
