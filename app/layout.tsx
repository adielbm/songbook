import type { Metadata } from 'next'
import { Miriam_Libre } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const miriam = Miriam_Libre({
  subsets: ['latin', 'hebrew'],
  variable: '--font-miriam',
  weight: ['400', '700'],
})

export const metadata: Metadata = {
  title: 'Songbook',
  description: 'Private chord collection reader with offline browser sync',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={miriam.variable} suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
