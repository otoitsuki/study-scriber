import { render, fireEvent, waitFor } from '@testing-library/react'
import ExportButton from './ExportButton'

jest.mock('@/hooks/use-session', () => ({
    useSession: () => ({ waitUntilCompleted: jest.fn() }),
}))
jest.mock('@/lib/api', () => ({
    notesAPI: { updateNote: jest.fn() },
}))
jest.mock('@/utils/export', () => ({
    downloadZip: jest.fn(),
}))
jest.mock('@/hooks/use-toast', () => ({
    toast: jest.fn(),
}))

const { useSession } = require('@/hooks/use-session')
const { notesAPI } = require('@/lib/api')
const { downloadZip } = require('@/utils/export')
const { toast } = require('@/hooks/use-toast')

describe('ExportButton', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('calls waitUntilCompleted and downloads on success', async () => {
        useSession.mockReturnValue({ waitUntilCompleted: jest.fn().mockResolvedValue(true) })
        notesAPI.updateNote.mockResolvedValue({})
        downloadZip.mockResolvedValue()
        const { getByText } = render(<ExportButton sid="sid" editorContent="abc" />)
        fireEvent.click(getByText(/Export/))
        await waitFor(() => expect(notesAPI.updateNote).toHaveBeenCalledWith('sid', { content: 'abc' }))
        expect(downloadZip).toHaveBeenCalledWith('sid')
    })

    it('shows toast if waitUntilCompleted returns false', async () => {
        useSession.mockReturnValue({ waitUntilCompleted: jest.fn().mockResolvedValue(false) })
        const { getByText } = render(<ExportButton sid="sid" editorContent="abc" />)
        fireEvent.click(getByText(/Export/))
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/後端仍在處理/) })))
    })

    it('shows error toast if updateNote fails', async () => {
        useSession.mockReturnValue({ waitUntilCompleted: jest.fn().mockResolvedValue(true) })
        notesAPI.updateNote.mockRejectedValue(new Error('fail'))
        const { getByText } = render(<ExportButton sid="sid" editorContent="abc" />)
        fireEvent.click(getByText(/Export/))
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    })

    it('shows error toast if downloadZip fails', async () => {
        useSession.mockReturnValue({ waitUntilCompleted: jest.fn().mockResolvedValue(true) })
        notesAPI.updateNote.mockResolvedValue({})
        downloadZip.mockRejectedValue(new Error('fail'))
        const { getByText } = render(<ExportButton sid="sid" editorContent="abc" />)
        fireEvent.click(getByText(/Export/))
        await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })))
    })

    it('does not trigger export when busy', async () => {
        useSession.mockReturnValue({ waitUntilCompleted: jest.fn().mockResolvedValue(true) })
        notesAPI.updateNote.mockResolvedValue({})
        downloadZip.mockResolvedValue()
        const { getByText } = render(<ExportButton sid="sid" editorContent="abc" />)
        const btn = getByText(/Export/)
        fireEvent.click(btn)
        fireEvent.click(btn)
        await waitFor(() => expect(notesAPI.updateNote).toHaveBeenCalledTimes(1))
    })
})
