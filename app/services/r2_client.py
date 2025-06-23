"""
Cloudflare R2 儲存服務客戶端
支援 Cloudflare API Token 和 S3 兼容認證兩種方式
"""

import os
import logging
import json
from typing import Optional, Dict, Any, Union
from datetime import datetime, timedelta
from uuid import UUID
import boto3
import requests
from botocore.config import Config
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.database import get_async_session
from ..db.models import AudioFile

# 載入環境變數
load_dotenv()

logger = logging.getLogger(__name__)

class R2ClientError(Exception):
    """R2 客戶端異常"""
    pass

class R2Client:
    """Cloudflare R2 儲存客戶端 - 支援 API Token 和 S3 兼容認證"""

    def __init__(self):
        """初始化 R2 客戶端"""
        self.account_id = os.getenv('R2_ACCOUNT_ID')
        self.bucket_name = os.getenv('R2_BUCKET_NAME', 'studyscriber-audio')

        # 嘗試 API Token 認證
        self.api_token = os.getenv('R2_API_TOKEN') or os.getenv('R2_ACCESS_KEY_ID')  # 支援兩種環境變數名稱

        # 嘗試 S3 兼容認證
        self.access_key_id = os.getenv('R2_ACCESS_KEY_ID')
        self.secret_access_key = os.getenv('R2_SECRET_ACCESS_KEY')

        # 驗證必要配置
        if not self.account_id:
            raise R2ClientError("缺少 R2_ACCOUNT_ID 環境變數")

        # 確定使用哪種認證方式
        self.auth_method = self._determine_auth_method()

        if self.auth_method == 'api_token':
            self._init_api_token_client()
        elif self.auth_method == 's3_compatible':
            self._init_s3_client()
        else:
            raise R2ClientError("無有效的認證配置。請設定 R2_API_TOKEN 或 (R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY)")

        logger.info(f"R2 客戶端初始化成功，使用 {self.auth_method} 認證")

    def _determine_auth_method(self) -> str:
        """確定使用哪種認證方式"""
        if self.api_token:
            return 'api_token'
        elif self.access_key_id and self.secret_access_key:
            return 's3_compatible'
        else:
            return 'none'

    def _init_api_token_client(self):
        """初始化 API Token 客戶端"""
        self.api_base_url = f"https://api.cloudflare.com/client/v4/accounts/{self.account_id}/r2/buckets/{self.bucket_name}/objects"
        self.headers = {
            'Authorization': f'Bearer {self.api_token}',
            'Content-Type': 'application/octet-stream'
        }
        logger.info("使用 Cloudflare API Token 認證")

    def _init_s3_client(self):
        """初始化 S3 兼容客戶端"""
        try:
            # 配置 S3 兼容客戶端
            self.s3_client = boto3.client(
                's3',
                endpoint_url=f'https://{self.account_id}.r2.cloudflarestorage.com',
                aws_access_key_id=self.access_key_id,
                aws_secret_access_key=self.secret_access_key,
                region_name='auto',
                config=Config(
                    signature_version='s3v4',
                    retries={'max_attempts': 3}
                )
            )
            logger.info("使用 S3 兼容認證")
        except Exception as e:
            raise R2ClientError(f"S3 客戶端初始化失敗: {str(e)}")

    async def test_connection(self) -> Dict[str, Any]:
        """測試連接"""
        try:
            if self.auth_method == 'api_token':
                return await self._test_api_token_connection()
            else:
                return await self._test_s3_connection()
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'auth_method': self.auth_method
            }

    async def _test_api_token_connection(self) -> Dict[str, Any]:
        """測試 API Token 連接"""
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

    async def _test_s3_connection(self) -> Dict[str, Any]:
        """測試 S3 連接"""
        try:
            # 列出 buckets 來測試連接
            response = self.s3_client.list_buckets()
            buckets = [bucket['Name'] for bucket in response.get('Buckets', [])]

            return {
                'success': True,
                'auth_method': 's3_compatible',
                'buckets': buckets,
                'target_bucket': self.bucket_name,
                'bucket_exists': self.bucket_name in buckets
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'S3 連接測試失敗: {str(e)}',
                'auth_method': 's3_compatible'
            }

    async def upload_file(self, key: str, data: bytes, content_type: str = 'application/octet-stream') -> Dict[str, Any]:
        """上傳檔案"""
        try:
            if self.auth_method == 'api_token':
                return await self._upload_via_api_token(key, data, content_type)
            else:
                return await self._upload_via_s3(key, data, content_type)
        except Exception as e:
            raise R2ClientError(f"檔案上傳失敗: {str(e)}")

    async def _upload_via_api_token(self, key: str, data: bytes, content_type: str) -> Dict[str, Any]:
        """透過 API Token 上傳檔案"""
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

    async def _upload_via_s3(self, key: str, data: bytes, content_type: str) -> Dict[str, Any]:
        """透過 S3 API 上傳檔案"""
        try:
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=data,
                ContentType=content_type
            )

            return {
                'success': True,
                'key': key,
                'size': len(data),
                'method': 's3_compatible'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'S3 上傳失敗: {str(e)}',
                'method': 's3_compatible'
            }

    async def store_chunk_blob(self, session_id: UUID, chunk_sequence: int, blob_data: bytes, db: AsyncSession = None) -> Dict[str, Any]:
        """
        存儲音檔切片到 Cloudflare R2 並更新資料庫記錄

        Args:
            session_id: 會話 ID
            chunk_sequence: 切片序號
            blob_data: 音檔二進制資料
            db: 資料庫會話（可選）

        Returns:
            Dict: 包含成功狀態、檔案資訊和錯誤信息
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

            except Exception as e:
                logger.error(f"上傳異常，第 {attempt + 1} 次嘗試: {str(e)}")
                if attempt == max_retries - 1:
                    upload_result = {
                        'success': False,
                        'error': f'上傳失敗，已重試 {max_retries} 次: {str(e)}'
                    }

        if not upload_result['success']:
            return {
                'success': False,
                'error': f'R2 上傳失敗: {upload_result.get("error")}',
                'session_id': session_id,
                'chunk_sequence': chunk_sequence
            }

        # 更新資料庫記錄
        if db is None:
            async with get_async_session() as db:
                return await self._update_database_record(db, session_id, chunk_sequence, r2_key, blob_data, upload_result)
        else:
            return await self._update_database_record(db, session_id, chunk_sequence, r2_key, blob_data, upload_result)

    async def _update_database_record(self, db: AsyncSession, session_id: UUID, chunk_sequence: int, r2_key: str, blob_data: bytes, upload_result: Dict[str, Any]) -> Dict[str, Any]:
        """更新資料庫記錄的輔助方法"""
        try:
            # 檢查是否已存在該切片記錄
            from sqlalchemy import select
            stmt = select(AudioFile).where(
                AudioFile.session_id == session_id,
                AudioFile.chunk_sequence == chunk_sequence
            )
            result = await db.execute(stmt)
            existing_audio = result.scalar_one_or_none()

            if existing_audio:
                # 更新現有記錄
                existing_audio.r2_key = r2_key
                existing_audio.r2_bucket = self.bucket_name
                existing_audio.file_size = len(blob_data)
                logger.info(f"更新現有音檔記錄: session_id={session_id}, chunk={chunk_sequence}")
            else:
                # 建立新記錄
                audio_file = AudioFile(
                    session_id=session_id,
                    chunk_sequence=chunk_sequence,
                    r2_key=r2_key,
                    r2_bucket=self.bucket_name,
                    file_size=len(blob_data)
                )
                db.add(audio_file)
                logger.info(f"建立新音檔記錄: session_id={session_id}, chunk={chunk_sequence}")

            await db.commit()

            return {
                'success': True,
                'session_id': session_id,
                'chunk_sequence': chunk_sequence,
                'r2_key': r2_key,
                'r2_bucket': self.bucket_name,
                'file_size': len(blob_data),
                'upload_method': upload_result.get('method')
            }

        except Exception as e:
            await db.rollback()
            logger.error(f"資料庫更新失敗: {str(e)}")
            return {
                'success': False,
                'error': f'資料庫更新失敗: {str(e)}',
                'session_id': session_id,
                'chunk_sequence': chunk_sequence,
                'r2_key': r2_key  # 檔案已上傳但 DB 更新失敗
            }

    def generate_presigned_url(self, key: str, expires_in: int = 3600) -> Dict[str, Any]:
        """
        生成 R2 預簽名下載 URL

        Args:
            key: R2 物件鍵值
            expires_in: 過期時間（秒），預設 1 小時

        Returns:
            Dict: 包含預簽名 URL 或錯誤信息
        """
        try:
            if self.auth_method == 's3_compatible':
                # 使用 S3 客戶端生成預簽名 URL
                presigned_url = self.s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': self.bucket_name, 'Key': key},
                    ExpiresIn=expires_in
                )

                return {
                    'success': True,
                    'presigned_url': presigned_url,
                    'expires_in': expires_in,
                    'method': 's3_compatible'
                }
            else:
                # API Token 方式不支援預簽名 URL
                return {
                    'success': False,
                    'error': 'API Token 認證方式不支援預簽名 URL，請使用 S3 兼容認證',
                    'method': 'api_token'
                }

        except Exception as e:
            logger.error(f"生成預簽名 URL 失敗: {str(e)}")
            return {
                'success': False,
                'error': f'生成預簽名 URL 失敗: {str(e)}',
                'key': key
            }

def get_r2_client() -> R2Client:
    """獲取 R2 客戶端實例"""
    return R2Client()

def generate_audio_key(session_id: str, chunk_sequence: int) -> str:
    """生成音檔儲存鍵名"""
    return f"audio/{session_id}/chunk_{chunk_sequence:04d}.webm"
