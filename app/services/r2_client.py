"""
Cloudflare R2 儲存服務客戶端
使用 Cloudflare API Token 認證
"""

import os
import logging
import asyncio
import aiohttp
from typing import Dict, Any
from uuid import UUID
import requests
from dotenv import load_dotenv
from supabase import Client

# 載入環境變數
load_dotenv()

logger = logging.getLogger(__name__)

class R2ClientError(Exception):
    """R2 客戶端異常"""
    pass

class R2Client:
    """Cloudflare R2 儲存客戶端 - 使用 API Token 認證"""

    def __init__(self):
        """初始化 R2 客戶端"""
        self.account_id = os.getenv('R2_ACCOUNT_ID')
        self.bucket_name = os.getenv('R2_BUCKET_NAME', 'studyscriber-audio')
        self.api_token = os.getenv('R2_API_TOKEN')

        # 驗證必要配置
        if not self.account_id:
            raise R2ClientError("缺少 R2_ACCOUNT_ID 環境變數")

        if not self.api_token:
            raise R2ClientError("缺少 R2_API_TOKEN 環境變數")

        # 初始化 API Token 客戶端
        self.api_base_url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/r2/buckets/{self.bucket_name}/objects"
        self.headers = {
            'Authorization': f'Bearer {self.api_token}',
            'Content-Type': 'application/octet-stream'
        }

        logger.info("R2 客戶端初始化成功，使用 API Token 認證")

    async def store_segment(self, sid: UUID, seq: int, blob: bytes) -> str:
        """
        儲存音檔切片到 R2 (簡化版 REST API 架構)

        Args:
            sid: 會話 ID
            seq: 切片序號
            blob: 音檔二進制資料

        Returns:
            str: R2 儲存鍵值

        Raises:
            R2ClientError: 上傳失敗時拋出
        """
        key = f"{sid}/{seq:06}.webm"
        url = f"{self.api_base_url}/{key}"

        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "audio/webm"
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.put(url, data=blob, headers=headers) as response:
                    if response.status in [200, 201]:
                        logger.info(f"✅ R2 上傳成功: {key} ({len(blob)} bytes)")
                        return key
                    else:
                        error_text = await response.text()
                        raise R2ClientError(f"R2 上傳失敗: {response.status} - {error_text}")

        except aiohttp.ClientError as e:
            raise R2ClientError(f"R2 上傳連線錯誤: {str(e)}")
        except Exception as e:
            raise R2ClientError(f"R2 上傳未知錯誤: {str(e)}")

    async def test_connection(self) -> Dict[str, Any]:
        """測試連接"""
        try:
            # 測試 token 有效性
            verify_url = "https://api.cloudflare.com/client/v4/user/tokens/verify"
            response = requests.get(verify_url, headers={'Authorization': f'Bearer {self.api_token}'})

            if response.status_code == 200:
                result = response.json()
                return {
                    'success': True,
                    'auth_method': 'api_token',
                    'token_status': result.get('result', {}).get('status'),
                    'account_id': self.account_id,
                    'bucket_name': self.bucket_name
                }
            else:
                return {
                    'success': False,
                    'error': f'Token 驗證失敗: {response.status_code}',
                    'auth_method': 'api_token'
                }
        except Exception as e:
            return {
                'success': False,
                'error': f'API Token 連接測試失敗: {str(e)}',
                'auth_method': 'api_token'
            }

    async def upload_file(self, key: str, data: bytes, content_type: str = 'application/octet-stream') -> Dict[str, Any]:
        """上傳檔案到 R2"""
        try:
            url = f"{self.api_base_url}/{key}"
            headers = self.headers.copy()
            headers['Content-Type'] = content_type

            response = requests.put(url, data=data, headers=headers)

            if response.status_code in [200, 201]:
                return {
                    'success': True,
                    'key': key,
                    'size': len(data),
                    'method': 'api_token'
                }
            else:
                return {
                    'success': False,
                    'error': f'上傳失敗: {response.status_code} - {response.text}',
                    'method': 'api_token'
                }
        except Exception as e:
            return {
                'success': False,
                'error': f'API Token 上傳失敗: {str(e)}',
                'method': 'api_token'
            }

    async def store_chunk_blob(
        self, session_id: UUID, chunk_sequence: int, blob_data: bytes, supabase_client: Client
    ) -> dict:
        """
        將音檔切片 Blob 存儲到 R2 並在資料庫中記錄

        Args:
            session_id: 會話 ID
            chunk_sequence: 音檔切片序號
            blob_data: 音檔二進制數據
            supabase_client: Supabase 客戶端實例

        Returns:
            Dict: 包含操作結果的字典
        """
        # 生成 R2 儲存鍵值
        r2_key = generate_audio_key(str(session_id), chunk_sequence)

        # 最多重試3次上傳
        max_retries = 3
        upload_result = None

        for attempt in range(max_retries):
            try:
                # 上傳檔案到 R2
                upload_result = await self.upload_file(
                    key=r2_key,
                    data=blob_data,
                    content_type='audio/webm'
                )

                if upload_result['success']:
                    break

                logger.warning(f"上傳失敗，第 {attempt + 1} 次嘗試: {upload_result.get('error')}")

                # 指數退避
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)

            except Exception as e:
                logger.error(f"上傳異常，第 {attempt + 1} 次嘗試: {str(e)}")
                if attempt == max_retries - 1:
                    upload_result = {
                        'success': False,
                        'error': f'上傳失敗，已重試 {max_retries} 次: {str(e)}'
                    }
                elif attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)

        if not upload_result['success']:
            return {
                'success': False,
                'error': f'R2 上傳失敗: {upload_result.get("error")}',
                'session_id': session_id,
                'chunk_sequence': chunk_sequence
            }

        # 使用傳入的 supabase_client 進行資料庫操作
        try:
            audio_file_record = {
                "session_id": str(session_id),
                "chunk_sequence": chunk_sequence,
                "r2_key": r2_key,
                "r2_bucket": self.bucket_name,
                "file_size": len(blob_data),
                "duration_seconds": 5.0  # 預設每個切片為 5 秒
            }

            db_response = supabase_client.table("audio_files").insert(audio_file_record).execute()

            if not db_response.data:
                return {
                    'success': False,
                    'error': '資料庫記錄建立失敗',
                    'session_id': session_id,
                    'chunk_sequence': chunk_sequence
                }

        except Exception as db_error:
            logger.error(f"資料庫操作失敗: {str(db_error)}")
            return {
                'success': False,
                'error': f'資料庫記錄建立失敗: {str(db_error)}',
                'session_id': session_id,
                'chunk_sequence': chunk_sequence
            }

        return {
            'success': True,
            'session_id': session_id,
            'chunk_sequence': chunk_sequence,
            'r2_key': r2_key,
            'r2_bucket': self.bucket_name,
            'file_size': len(blob_data),
            'upload_method': upload_result.get('method')
        }

    def get_download_url(self, key: str) -> str:
        """
        獲取檔案的直接下載 URL

        注意：此 URL 需要 API Token 認證，適用於服務端使用
        對於客戶端下載，建議使用 Cloudflare 的公開 URL 或實作代理端點
        """
        return f"{self.api_base_url}/{key}"

    async def download_file(self, key: str) -> Dict[str, Any]:
        """從 R2 下載檔案"""
        try:
            url = f"{self.api_base_url}/{key}"
            headers = {'Authorization': f'Bearer {self.api_token}'}

            response = requests.get(url, headers=headers)

            if response.status_code == 200:
                return {
                    'success': True,
                    'key': key,
                    'data': response.content,
                    'size': len(response.content),
                    'method': 'api_token'
                }
            elif response.status_code == 404:
                return {
                    'success': False,
                    'error': f'檔案不存在: {key}',
                    'method': 'api_token'
                }
            else:
                return {
                    'success': False,
                    'error': f'下載失敗: {response.status_code} - {response.text}',
                    'method': 'api_token'
                }
        except Exception as e:
            return {
                'success': False,
                'error': f'API Token 下載失敗: {str(e)}',
                'method': 'api_token'
            }

def get_r2_client() -> R2Client:
    """獲取 R2 客戶端實例"""
    return R2Client()

def generate_audio_key(session_id: str, chunk_sequence: int) -> str:
    """生成音檔儲存鍵名"""
    return f"audio/{session_id}/chunk_{chunk_sequence:04d}.webm"
