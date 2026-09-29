import { researchVideo } from '@/lib/research-video-source'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export function GET(request: Request, { params }: { params: { id: string } }) {
  return researchVideo(request, params.id)
}
export const HEAD = GET
