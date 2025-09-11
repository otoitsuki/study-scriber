import { config } from 'dotenv'
import { resolve } from 'path'

// 載入根目錄的 .env 檔案
config({ path: resolve('../.env') })

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // 將根目錄 .env 檔案中的配置注入到前端環境變數
  env: {
    NEXT_PUBLIC_AUDIO_CHUNK_DURATION_SEC: process.env.AUDIO_CHUNK_DURATION_SEC,
    NEXT_PUBLIC_AUDIO_CHUNK_OVERLAP_SEC: process.env.AUDIO_CHUNK_OVERLAP_SEC,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8000/api/:path*',
      },
    ]
  },
}

export default nextConfig
