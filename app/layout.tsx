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
  icons: {
    icon: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '16x16',
        type: 'image/jpeg',
      },
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '32x32',
        type: 'image/jpeg',
      },
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '48x48',
        type: 'image/jpeg',
      },
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '192x192',
        type: 'image/jpeg',
      },
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '512x512',
        type: 'image/jpeg',
      },
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: 'any',
        type: 'image/jpeg',
      },
    ],
    shortcut: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        type: 'image/jpeg',
      },
    ],
    apple: [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f9/KYTARISTA%2C_1959%2C_olej_na_pl%C3%A1tn%C4%9B%2C_120_x_98_cm.jpg',
        sizes: '180x180',
        type: 'image/jpeg',
      },
    ],
  },
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
