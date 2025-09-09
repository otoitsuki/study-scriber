"use client"

import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Settings, Brain } from "lucide-react"
import { LLMSettingsDialog } from "./llm-settings-dialog"
import { LLMConfig } from "@/types/llm-config"

interface ProviderContextMenuProps {
    disabled?: boolean
    onLLMConfigChange?: (config: LLMConfig) => void
}

export function ProviderContextMenu({
    disabled = false,
    onLLMConfigChange
}: ProviderContextMenuProps) {
    const [llmDialogOpen, setLlmDialogOpen] = useState(false)

    const handleLLMConfigSave = (config: LLMConfig) => {
        onLLMConfigChange?.(config)
    }

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={disabled}
                        data-testid="settings-button"
                    >
                        <Settings className="w-4 h-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                    <DropdownMenuContent side="bottom" sideOffset={4} className="bg-white rounded-md">
                        {/* 主要的 LLM 設定選項 */}
                        <DropdownMenuItem
                            onClick={() => setLlmDialogOpen(true)}
                            className="flex items-center gap-2"
                        >
                            <Brain className="w-4 h-4" />
                            LLM 設定
                        </DropdownMenuItem>

                    </DropdownMenuContent>
                </DropdownMenuPortal>
            </DropdownMenu>

            {/* LLM 設定對話框 */}
            <LLMSettingsDialog
                open={llmDialogOpen}
                onOpenChange={setLlmDialogOpen}
                onSave={handleLLMConfigSave}
            />
        </>
    )
}
