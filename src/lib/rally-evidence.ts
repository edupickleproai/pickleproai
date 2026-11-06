export const MAX_RALLY_SECONDS = 60
export const MAX_RALLY_FRAMES = 8
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
export const RALLY_LIMITATIONS = 'Sparse sampled images, not continuous video tracking. A user selection identifies intent only. Identity across frames may be uncertain. Do not attribute another player’s actions to the intended player. Cite sample timestamps for visible observations; distinguish interpretation. Do not infer ball trajectories, shot contact, exact timing or unseen movements. Abstain when identity or visual evidence is insufficient.'

export function validateDuration(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_RALLY_SECONDS) throw new Error('Upload one rally longer than 0 seconds and no longer than 60 seconds.')
  return duration
}

export function sampleTimes(duration: number): number[] {
  validateDuration(duration)
  const count = Math.min(MAX_RALLY_FRAMES, Math.max(3, Math.ceil(duration / 5) + 1))
  const end = Math.max(0, duration - Math.min(0.25, duration / 10))
  return Array.from({ length: count }, (_, i) => end * i / (count - 1))
}

export type PlayerConfirmation = { confirmed: true; kind: 'user-confirmed'; description: string; representativeTime: number; point: { x: number; y: number } | null; coordinateBasis: 'normalized-displayed-frame'; trackingEstablished: false }
export function playerConfirmation(input: unknown): PlayerConfirmation {
  const p = input as any
  if (p?.confirmed !== true || p.kind !== 'user-confirmed' || typeof p.description !== 'string' || !p.description.trim() || p.description.length > 1000 || p.representativeTime !== 0 || p.coordinateBasis !== 'normalized-displayed-frame' || p.trackingEstablished !== false) throw new Error('Confirm the player shown at the start of the video and provide a description before analysis.')
  if (p.point !== null && (!p.point || !['x', 'y'].every(k => typeof p.point[k] === 'number' && Number.isFinite(p.point[k]) && p.point[k] >= 0 && p.point[k] <= 1))) throw new Error('Player selection coordinates are invalid.')
  return { confirmed: true, kind: 'user-confirmed', description: p.description.trim(), representativeTime: 0, point: p.point === null ? null : { x: p.point.x, y: p.point.y }, coordinateBasis: 'normalized-displayed-frame', trackingEstablished: false }
}
