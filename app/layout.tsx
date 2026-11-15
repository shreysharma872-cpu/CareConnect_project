import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'CareConnect — Elderly Care & Medication Platform',
  description: 'Smart healthcare management for elderly individuals, caretakers, and family members',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-gray-50">{children}</body>
    </html>
  )
}
