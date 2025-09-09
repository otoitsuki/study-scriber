"use client"

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Loader2, CheckCircle, XCircle, Info, Eye, EyeOff } from 'lucide-react'
import { useToast } from './ui/use-toast'
import {
    LLMConfig,
    LLMConfigFormData,
    LLMTestResponse,
    DEFAULT_LLM_CONFIGS,
    COMMON_MODELS,
    LLM_CONFIG_STORAGE_KEYS
} from '@/types/llm-config'
import { sessionAPI } from '@/lib/api'

interface LLMSettingsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (config: LLMConfig) => void
}

export function LLMSettingsDialog({ open, onOpenChange, onSave }: LLMSettingsDialogProps) {
    const { toast } = useToast()

    // 表單狀態
    const [formData, setFormData] = useState<LLMConfigFormData>({
        baseUrl: '',
        apiKey: '',
        model: '',
        apiVersion: ''
    })

    // UI 狀態
    const [testing, setTesting] = useState(false)
    const [testResult, setTestResult] = useState<LLMTestResponse | null>(null)
    const [showApiKey, setShowApiKey] = useState(false)
    const [isDirty, setIsDirty] = useState(false)

    // 載入 localStorage 的設定
    useEffect(() => {
        if (open) {
            const savedConfig = {
                baseUrl: localStorage.getItem(LLM_CONFIG_STORAGE_KEYS.BASE_URL) || DEFAULT_LLM_CONFIGS.openai.baseUrl,
                apiKey: localStorage.getItem(LLM_CONFIG_STORAGE_KEYS.API_KEY) || '',
                model: localStorage.getItem(LLM_CONFIG_STORAGE_KEYS.MODEL) || DEFAULT_LLM_CONFIGS.openai.model,
                apiVersion: localStorage.getItem(LLM_CONFIG_STORAGE_KEYS.API_VERSION) || ''
            }
            setFormData(savedConfig)
            setTestResult(null)
            setIsDirty(false)
        }
    }, [open])

    // 表單變更處理
    const handleInputChange = (field: keyof LLMConfigFormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        setIsDirty(true)
        setTestResult(null) // 清除測試結果
    }

    // 快速設定預設值
    const applyPreset = (preset: 'openai' | 'azure') => {
        const config = DEFAULT_LLM_CONFIGS[preset]
        setFormData(prev => ({
            ...prev,
            baseUrl: config.baseUrl,
            model: config.model,
            apiVersion: config.apiVersion
        }))
        setIsDirty(true)
        setTestResult(null)
    }

    // 測試連線
    const handleTest = async () => {
        if (!formData.baseUrl || !formData.apiKey || !formData.model) {
            toast({
                title: "設定不完整",
                description: "請填寫 Endpoint URL、API Key 和 Model",
                variant: "destructive"
            })
            return
        }

        setTesting(true)
        try {
            // 使用 axios 客戶端（自動帶入 NEXT_PUBLIC_API_URL）
            const result: LLMTestResponse = await sessionAPI.testLLMConnection({
                baseUrl: formData.baseUrl,
                apiKey: formData.apiKey,
                model: formData.model,
                apiVersion: formData.apiVersion || undefined,
            })
            setTestResult(result)

            if (result.success) {
                toast({
                    title: "連線測試成功！",
                    description: `偵測到 ${result.detectedProvider} provider，STT 方法：${result.detectedSttMethod}`
                })
            } else {
                toast({
                    title: "連線測試失敗",
                    description: result.error || result.errors?.transcription || result.errors?.chat || "請檢查設定是否正確",
                    variant: "destructive"
                })
            }
        } catch (error) {
            const respData = (error as any)?.response?.data
            const serverMessage = typeof respData?.message === 'string' ? respData.message : undefined
            const serverError = typeof respData?.error === 'string' ? respData.error : undefined
            const errMsg = serverMessage || serverError || (error as Error)?.message || '網路錯誤'
            const resp = respData as Partial<LLMTestResponse> | undefined
            toast({
                title: "測試失敗",
                description: typeof errMsg === 'string' ? errMsg : '請稍後再試',
                variant: "destructive"
            })
            setTestResult({
                success: false,
                detectedProvider: resp?.detected_provider as any || 'unknown',
                detectedSttMethod: resp?.detected_stt_method as any || 'unknown',
                capabilities: resp?.capabilities || { transcription: false },
                error: typeof errMsg === 'string' ? errMsg : '網路錯誤',
                errors: resp?.errors as any
            })
        } finally {
            setTesting(false)
        }
    }

    // 儲存設定
    const handleSave = () => {
        if (!formData.baseUrl || !formData.apiKey || !formData.model) {
            toast({
                title: "設定不完整",
                description: "請填寫必要欄位",
                variant: "destructive"
            })
            return
        }

        // 儲存到 localStorage
        localStorage.setItem(LLM_CONFIG_STORAGE_KEYS.BASE_URL, formData.baseUrl)
        localStorage.setItem(LLM_CONFIG_STORAGE_KEYS.API_KEY, formData.apiKey)
        localStorage.setItem(LLM_CONFIG_STORAGE_KEYS.MODEL, formData.model)
        localStorage.setItem(LLM_CONFIG_STORAGE_KEYS.API_VERSION, formData.apiVersion)

        // 回傳配置給父元件
        onSave({
            baseUrl: formData.baseUrl,
            apiKey: formData.apiKey,
            model: formData.model,
            apiVersion: formData.apiVersion || undefined
        })

        toast({
            title: "設定已儲存",
            description: "LLM 配置將在下次建立會話時生效"
        })

        onOpenChange(false)
        setIsDirty(false)
    }

    // 遮罩 API Key 顯示
    const maskApiKey = (key: string) => {
        if (!key || key.length < 8) return '••••••••'
        return `${key.slice(0, 3)}${'•'.repeat(key.length - 6)}${key.slice(-3)}`
    }

    // 偵測 provider 類型
    const detectProvider = (url: string) => {
        if (url.includes('openai.azure.com')) return 'Azure OpenAI'
        if (url.includes('api.openai.com')) return 'OpenAI'
        return '自訂 API'
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>LLM 設定</DialogTitle>
                    <DialogDescription>
                        設定自訂的 OpenAI API 端點、模型與金鑰，將覆蓋環境變數設定
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* 快速設定預設值 */}
                    <Card className="bg-white text-neutral-900 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:border-neutral-700">
                        <CardHeader>
                            <CardTitle className="text-sm">快速設定</CardTitle>
                            <CardDescription>選擇常見的 API 提供商預設值</CardDescription>
                        </CardHeader>
                        <CardContent className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => applyPreset('openai')}
                            >
                                OpenAI
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => applyPreset('azure')}
                            >
                                Azure OpenAI
                            </Button>
                        </CardContent>
                    </Card>

                    {/* 基本設定 */}
                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="baseUrl">Endpoint URL *</Label>
                            <Input
                                id="baseUrl"
                                value={formData.baseUrl}
                                onChange={(e) => handleInputChange('baseUrl', e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                className="font-mono text-sm bg-white text-neutral-900 placeholder:text-neutral-400 dark:bg-neutral-900 dark:text-neutral-50"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                                偵測到：{detectProvider(formData.baseUrl)}
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="apiKey">API Key *</Label>
                            <div className="relative">
                                <Input
                                    id="apiKey"
                                    type={showApiKey ? "text" : "password"}
                                    value={formData.apiKey}
                                    onChange={(e) => handleInputChange('apiKey', e.target.value)}
                                    placeholder="sk-..."
                                    className="font-mono text-sm pr-10 bg-white text-neutral-900 placeholder:text-neutral-400 dark:bg-neutral-900 dark:text-neutral-50"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                >
                                    {showApiKey ? (
                                        <EyeOff className="h-4 w-4" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                            {formData.apiKey && !showApiKey && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    顯示：{maskApiKey(formData.apiKey)}
                                </p>
                            )}
                        </div>

                        <div>
                            <Label htmlFor="model">Model *</Label>
                            <Input
                                id="model"
                                value={formData.model}
                                onChange={(e) => handleInputChange('model', e.target.value)}
                                placeholder="whisper-1, gpt-4o, 或您的 Azure 部署名稱"
                                className="font-mono text-sm bg-white text-neutral-900 placeholder:text-neutral-400 dark:bg-neutral-900 dark:text-neutral-50"
                            />
                            <div className="flex flex-wrap gap-1 mt-2">
                                {Object.entries(COMMON_MODELS).map(([category, models]) =>
                                    models.map(model => (
                                        <Badge
                                            key={model}
                                            variant="outline"
                                            className="text-xs cursor-pointer hover:bg-accent"
                                            onClick={() => handleInputChange('model', model)}
                                        >
                                            {model}
                                        </Badge>
                                    ))
                                )}
                            </div>
                        </div>

                        <div>
                            <Label htmlFor="apiVersion">API Version (Azure 專用，選填)</Label>
                            <Input
                                id="apiVersion"
                                value={formData.apiVersion}
                                onChange={(e) => handleInputChange('apiVersion', e.target.value)}
                                placeholder="2024-06-01"
                                className="font-mono text-sm bg-white text-neutral-900 placeholder:text-neutral-400 dark:bg-neutral-900 dark:text-neutral-50"
                            />
                        </div>
                    </div>

                    {/* 測試連線結果 */}
                    {testResult && (
                        <Card className="bg-white text-neutral-900 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-50 dark:border-neutral-700">
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    {testResult.success ? (
                                        <CheckCircle className="h-4 w-4 text-green-500" />
                                    ) : (
                                        <XCircle className="h-4 w-4 text-red-500" />
                                    )}
                                    連線測試結果
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2">
                                <div className="flex gap-2">
                                    <Badge variant={testResult.success ? "default" : "destructive"}>
                                        {testResult.success ? "成功" : "失敗"}
                                    </Badge>
                                    <Badge variant="outline">{testResult.detectedProvider}</Badge>
                                    <Badge variant="outline">{testResult.detectedSttMethod}</Badge>
                                </div>

                                <div className="text-sm space-y-1">
                                    <p>轉錄支援：{testResult.capabilities.transcription ? "✅" : "❌"}</p>
                                </div>

                                {testResult.error && (
                                    <p className="text-sm text-red-600 bg-red-50 p-2 rounded">
                                        {testResult.error}
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 注意事項 */}
                    <Card className="bg-blue-50 border-blue-200">
                        <CardContent className="pt-4">
                            <div className="flex gap-2">
                                <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                <div className="text-sm text-blue-800">
                                    <p className="font-medium mb-1">注意事項：</p>
                                    <ul className="space-y-1 text-xs">
                                        <li>• API Key 僅儲存在瀏覽器本地，不會上傳到伺服器</li>
                                        <li>• 設定將在下次建立會話時生效</li>
                                        <li>• 建議先測試連線確保設定正確</li>
                                        <li>• 使用自己的 API Key 可能產生費用</li>
                                    </ul>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 pt-4">
                        <Button
                            onClick={handleTest}
                            disabled={testing}
                            variant="outline"
                            className="flex-1"
                        >
                            {testing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    測試中...
                                </>
                            ) : (
                                "測試連線"
                            )}
                        </Button>

                        <Button
                            onClick={handleSave}
                            className="flex-1"
                            disabled={!isDirty}
                        >
                            儲存設定
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

