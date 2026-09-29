import type { ResearchLabel, ResearchPoint } from './pose-research'

export type BlindedLabel = Exclude<ResearchLabel, 'UNLABELED'>
export type ReviewHistory = { originalLabel: BlindedLabel; committedAt: string; revealedAt?: string; adjudications: Array<{ originalLabel: BlindedLabel; revisedLabel: BlindedLabel; reason: string; at: string }> }
export type Reviewable = { id: string; label: ResearchLabel; note: string; review?: ReviewHistory }
export type ReviewAction = { type: 'commit'; label: BlindedLabel; note: string; at: string } | { type: 'reveal'; at: string } | { type: 'adjudicate'; label: BlindedLabel; reason: string; at: string }
const labels = ['COHERENT', 'MALFORMED', 'UNCERTAIN']

// Pure research annotation transitions. The blinded label stays authoritative after reveal.
export function reviewAction<T extends Reviewable>(row: T, action: ReviewAction): T {
  if (action.type === 'commit') {
    if (row.review?.revealedAt || !labels.includes(action.label)) throw new Error('Blinded label is locked.')
    return { ...row, label: action.label, note: action.note.slice(0, 500), review: { originalLabel: action.label, committedAt: action.at, adjudications: [] } }
  }
  if (row.label === 'UNLABELED') throw new Error('Commit a visual label first.')
  const review = row.review ?? { originalLabel: row.label as BlindedLabel, committedAt: action.at, adjudications: [] }
  if (action.type === 'reveal') return { ...row, review: { ...review, revealedAt: review.revealedAt ?? action.at } }
  if (!review.revealedAt || !action.reason.trim() || !labels.includes(action.label)) throw new Error('Adjudication requires a revealed record, revised label and reason.')
  return { ...row, review: { ...review, adjudications: [...review.adjudications, { originalLabel: review.originalLabel, revisedLabel: action.label, reason: action.reason.trim().slice(0, 1000), at: action.at }] } }
}

export function reviewIds(rows: Array<Reviewable & { stage: string }>, unlabeledOnly: boolean) {
  return rows.filter(row => row.stage === 'raw' && (!unlabeledOnly || row.label === 'UNLABELED')).map(row => row.id)
}
export function adjacentReview(ids: string[], current: string | null, direction: -1 | 1) {
  if (!ids.length) return null
  const index = ids.indexOf(current ?? '')
  return ids[Math.max(0, Math.min(ids.length - 1, index < 0 ? 0 : index + direction))]
}

export type ViewBox = { x: number; y: number; width: number; height: number }
export function rawDisplayPoints(points: ResearchPoint[], width: number, height: number, offsetX: number) {
  return points.map(point => ({ x: point.x * width + offsetX, y: point.y * height }))
}
export function poseBounds(points: Array<{ x: number; y: number }>): ViewBox | null {
  const finite = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!finite.length) return null
  const x = Math.min(...finite.map(p => p.x)), y = Math.min(...finite.map(p => p.y))
  return { x, y, width: Math.max(...finite.map(p => p.x)) - x, height: Math.max(...finite.map(p => p.y)) - y }
}
export function fitPlayer(points: Array<{ x: number; y: number }>, width: number, height: number): ViewBox {
  const b = poseBounds(points)
  if (!b) return { x: 0, y: 0, width, height }
  const margin = Math.max(b.width, b.height, 20) * .55
  const left = Math.max(0, Math.min(width - 1, b.x - margin)), top = Math.max(0, Math.min(height - 1, b.y - margin))
  return { x: left, y: top, width: Math.max(1, Math.min(width, b.x + b.width + margin) - left), height: Math.max(1, Math.min(height, b.y + b.height + margin) - top) }
}
export function zoomView(view: ViewBox, factor: number, frameWidth: number, frameHeight: number): ViewBox {
  const width = Math.min(frameWidth * 2, Math.max(8, view.width * factor)), height = width * view.height / view.width
  return { x: view.x + (view.width - width) / 2, y: view.y + (view.height - height) / 2, width, height: Math.min(frameHeight * 2, height) }
}

// Keep the capture export helper frozen; add only explicitly allowed annotation history here.
export function withReviewHistory(baseJson: string, rows: Reviewable[]) {
  const result = JSON.parse(baseJson)
  const histories = new Map(rows.filter(row => row.review).map(row => [row.id, row.review]))
  result.rows = result.rows.map((row: { id: string }) => histories.has(row.id) ? { ...row, review: histories.get(row.id) } : row)
  return JSON.stringify(result, null, 2)
}
