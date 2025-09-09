import { TranscriptDebugger } from '../../components/transcript-debugger'

export default function DebugPage() {
    return (
        <div className="min-h-screen bg-background p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-8">StudyScriber 診斷工具</h1>
                <TranscriptDebugger />
            </div>
        </div>
    )
}