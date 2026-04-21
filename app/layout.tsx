import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'


export const metadata: Metadata = {
  title: 'Songbook',
  description: 'Private chord collection reader with offline browser sync',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
