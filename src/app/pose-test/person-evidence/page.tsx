import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'
export default async function PersonEvidencePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const { default: Workspace } = await import('./PersonEvidence')
  return <Workspace />
}
