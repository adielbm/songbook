import type { Metadata } from 'next'
import { Miriam_Libre, Roboto_Condensed } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'
import './globals.scss'

const miriamLibre = Miriam_Libre({
  subsets: ['latin', 'hebrew'],
  weight: ['400', '700'],
  variable: '--font-miriam-libre',
  display: 'swap',
})

const robotoCondensed = Roboto_Condensed({
  subsets: ['latin'],
  variable: '--font-roboto-condensed',
  weight: ['400', '700'],
  display: 'swap',
})


export const metadata: Metadata = {
  title: 'Songbook',
  description: 'Private chord collection reader with offline browser sync',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${miriamLibre.variable} ${robotoCondensed.variable} bg-background text-foreground`}
        style={{
          ['--body-font' as string]: miriamLibre.style.fontFamily,
          ['--chord-font' as string]: robotoCondensed.style.fontFamily,
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
