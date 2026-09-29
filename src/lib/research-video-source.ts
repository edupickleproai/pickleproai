// Server-only, read-only source for the development research inspector.
import { createHash } from 'node:crypto'
import { readdir, realpath, lstat, open } from 'node:fs/promises'
import * as path from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' }
type Entry = { id: string; filename: string; url: string; size: number; modified: number; file: string; mime: string }
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' }

async function index(): Promise<Entry[]> {
  if (process.env.NODE_ENV !== 'development' || !process.env.PICKLEPRO_RESEARCH_VIDEO_DIR) throw new Error('Unavailable')
  const configured = process.env.PICKLEPRO_RESEARCH_VIDEO_DIR
  if (!path.isAbsolute(configured)) throw new Error('Unavailable')
  const root = await realpath(configured)
  const entries: Entry[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const mime = MIME[path.extname(entry.name).toLowerCase()]
    if (!entry.isFile() || !mime) continue
    const file = path.join(root, entry.name)
    const stat = await lstat(file)
    // Never follow a symlink/junction or enumerate nested directories.
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(file) !== file) continue
    const id = createHash('sha256').update(JSON.stringify([entry.name, stat.size, stat.mtimeMs])).digest('hex')
    entries.push({ id, filename: entry.name, url: `/pose-test/research-videos/${id}`, size: stat.size, modified: stat.mtimeMs, file, mime })
  }
  return entries.sort((a, b) => a.filename.localeCompare(b.filename))
}

function localRequest(request: Request) {
  const url = new URL(request.url)
  // Next may normalize request.url to localhost; validate the actual Host as well.
  const host = request.headers.get('host')
  if (host) {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return false
    url.host = host
  }
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    (!request.headers.has('origin') || request.headers.get('origin') === url.origin) &&
    !['cross-site'].includes(request.headers.get('sec-fetch-site') ?? '')
}

export async function researchVideoIndex(request: Request): Promise<Response> {
  try {
    if (!localRequest(request)) throw new Error('Unavailable')
    const videos = (await index()).map(({ id, filename, url }) => ({ id, filename, url }))
    return Response.json({ videos }, { headers })
  } catch { return new Response('Research video source unavailable.', { status: 404, headers }) }
}

export function videoRange(range: string | null, size: number): { start: number; end: number } | null {
  if (range === null) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2]) || size === 0) throw new Error('Invalid range')
  const a = Number(match[1]), b = Number(match[2])
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error('Invalid range')
  const start = match[1] ? a : Math.max(0, size - b)
  const end = match[1] && match[2] ? Math.min(b, size - 1) : size - 1
  if (start >= size || start < 0 || end < start) throw new Error('Invalid range')
  return { start, end }
}

export async function researchVideo(request: Request, id: string): Promise<Response> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    if (!localRequest(request) || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Unavailable')
    const entry = (await index()).find(video => video.id === id)
    if (!entry) throw new Error('Unavailable')
    handle = await open(entry.file, 'r')
    const stat = await handle.stat()
    // Refuse files replaced between enumeration and open (including link swaps).
    const current = await lstat(entry.file)
    if (!stat.isFile() || current.isSymbolicLink() || stat.ino !== current.ino || stat.dev !== current.dev ||
        stat.size !== entry.size || stat.mtimeMs !== entry.modified || await realpath(entry.file) !== entry.file) throw new Error('Unavailable')
    const base = { ...headers, 'Content-Type': entry.mime, 'Accept-Ranges': 'bytes' }
    let range: ReturnType<typeof videoRange>
    try { range = videoRange(request.headers.get('range'), stat.size) }
    catch {
      await handle.close(); handle = undefined
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${stat.size}`, 'Content-Length': '0' } })
    }
    const responseHeaders = { ...base, 'Content-Length': String(range ? range.end - range.start + 1 : stat.size),
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}` } : {}) }
    if (request.method === 'HEAD' || stat.size === 0) {
      await handle.close(); handle = undefined
      return new Response(null, { status: range ? 206 : 200, headers: responseHeaders })
    }
    const stream = handle.createReadStream({ ...(range ?? {}), autoClose: true })
    handle = undefined // Stream owns the descriptor, including cancellation cleanup.
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers: responseHeaders })
  } catch {
    await handle?.close()
    return new Response('Research video source unavailable.', { status: 404, headers })
  }
}
