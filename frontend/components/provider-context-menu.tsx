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
import { PROVIDERS } from "../constants/providers"

interface ProviderContextMenuProps {
    currentProvider: STTProvider
    onProviderChange: (provider: STTProvider) => void
    disabled?: boolean
}

export function ProviderContextMenu({ currentProvider, onProviderChange, disabled = false }: ProviderContextMenuProps) {
    const providerDisplayName = Object.fromEntries(PROVIDERS.map(p => [p.code, p.label]))

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
                                {PROVIDERS.map((p) => (
                                    <DropdownMenuRadioItem value={p.code} key={p.code}>
                                        {p.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    )
}
