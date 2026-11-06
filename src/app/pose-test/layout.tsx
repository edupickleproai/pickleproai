import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

// Route handlers retain their own development guards.
export default function ResearchLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound()
  return children
}
