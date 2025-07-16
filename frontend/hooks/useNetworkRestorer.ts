"use client"
import { useEffect } from 'react'
import { emit } from '@/utils/event-bus'

export function useNetworkRestorer() {
    useEffect(() => {
        const handler = () => emit('network:restored')
        window.addEventListener('online', handler)
        return () => window.removeEventListener('online', handler)
    }, [])
}
