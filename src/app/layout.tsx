import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'PicklePro AI - Your AI Pickleball Coach',
  description: 'The ultimate AI-powered pickleball coaching platform for training, video review, tournaments, and daily news.',
  keywords: 'pickleball, AI coach, training, tournament finder, news',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}
