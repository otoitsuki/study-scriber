import type { Metadata } from 'next'
import './globals.css'

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
        {children}
      </body>
    </html>
  )
}
