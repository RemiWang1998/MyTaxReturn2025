import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getLocale } from 'next-intl/server'
import './globals.css'
import { Sidebar } from '@/components/layout/sidebar'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'US Tax Return 2025',
  description: 'Local-first tax return agent — all data stays on your machine',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  return (
    <html lang={locale} className={`${inter.variable} h-full antialiased`}>
      <body className="h-full flex bg-background text-foreground">
        <NextIntlClientProvider messages={messages}>
          <Sidebar />
          <main className="flex-1 overflow-auto p-6"><ErrorBoundary>{children}</ErrorBoundary></main>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
