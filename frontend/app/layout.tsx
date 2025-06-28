import type { Metadata } from 'next'
import './globals.css'
import { AppStateProviderWrapper } from '../providers/app-state-provider-wrapper'

export const metadata: Metadata = {
  title: 'study-scriber',
  description: 'study-scriber',
  generator: 'study-scriber',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <AppStateProviderWrapper>
          {children}
        </AppStateProviderWrapper>
      </body>
    </html>
  )
}
