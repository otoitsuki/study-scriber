import { describe, expect, it, vi } from 'vitest'
import { emit } from '@/utils/event-bus'
import * as uploader from '@/lib/rest-audio-uploader'
import * as tm from '@/lib/transcript-manager'

describe('network restorer', () => {
    it('should retry and reconnect', async () => {
        const spyRetry = vi.spyOn(uploader.restAudioUploader, 'retryFailedSegments').mockResolvedValue({ uploaded: 1, remaining: 0 })
        const spyConnect = vi.spyOn(tm.transcriptManager, 'connect').mockReturnValue(Promise.resolve() as any)
        const spyIsConnected = vi.spyOn(tm.transcriptManager, 'isConnected').mockReturnValue(false)

        emit('network:restored')
        await vi.runAllTicks()

        expect(spyRetry).toHaveBeenCalled()
        expect(spyConnect).toHaveBeenCalled()
    })
})
