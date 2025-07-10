"use client"

import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Settings, Mic, Zap } from "lucide-react"
import { STTProvider } from "@/lib/api"

interface ProviderContextMenuProps {
    currentProvider: STTProvider
    onProviderChange: (provider: STTProvider) => void
    disabled?: boolean
}

export function ProviderContextMenu({ currentProvider, onProviderChange, disabled = false }: ProviderContextMenuProps) {
    const providerDisplayName = {
        whisper: "Whisper (Azure)",
        gemini: "Gemini 2.5 Pro (Vertex AI)"
    }

    return (
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
                    <DropdownMenuItem disabled>Config</DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Switch Provider</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="bg-white rounded-md">
                            <DropdownMenuRadioGroup value={currentProvider} onValueChange={(value) => onProviderChange(value as STTProvider)}>
                                <DropdownMenuRadioItem value="whisper">
                                    <Mic className="w-4 h-4 mr-2" />
                                    {providerDisplayName.whisper}
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="gemini">
                                    <Zap className="w-4 h-4 mr-2" />
                                    {providerDisplayName.gemini}
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    )
}
