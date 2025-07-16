"use client"
import { useNetworkRestorer } from '@/hooks/useNetworkRestorer'

export function NetworkRestorerClient() {
    useNetworkRestorer()
    return null
}
