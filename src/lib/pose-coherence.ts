/** Shadow v0: derived image-space measurements only. Never eligibility or identity.
 * Provisional geometric regions, not fitted dataset cutoffs:
 * |torso angle| > 90 degrees means shoulder midpoint below hip midpoint.
 * side-vector cosine < 0 means shoulder/hip left-to-right vectors oppose (>90°).
 * These are distinct longitudinal/transverse observations, not independent
 * statistical evidence. Inversion, twisting, projection or camera roll can be
 * legitimate. Even their conjunction must NEVER reject or certify a pose.
 */
export type ShadowStatus = 'NO_OBVIOUS_ANOMALY' | 'SUSPICIOUS' | 'STRONGLY_SUSPICIOUS' | 'INSUFFICIENT_EVIDENCE'
export type ShadowReasonCode = 'INVERTED_IMAGE_TORSO' | 'SHOULDER_HIP_VECTOR_OPPOSITION' | 'INSUFFICIENT_GEOMETRY'
export type ShadowReason = {
  code: ShadowReasonCode
  tier: 0 | 1
  measurements: Record<string, number | null>
  explanation: string
}
export type ShadowAssessment = {
  version: 'shadow-v0'
  authority: 'NONE'
  status: ShadowStatus
  reasons: ShadowReason[]
  diagnostics: Record<string, unknown>
}

// Machine arithmetic tolerance only, not a structural classification boundary.
const COSINE_ROUNDOFF = 1e-12
const diagnosticFields = [
  'bodyHeight', 'bboxAspect', 'bboxArea', 'torsoLength', 'torsoAngle',
  'sideVectorCosine', 'shoulderHipOrdering', 'shoulderHipDeltaY',
  'limbTorsoRatios', 'largestLeftRightAsymmetry', 'distalTorsoMin',
  'distalTorsoMax', 'elbowAngles', 'kneeAngles', 'torsoBboxDiagonal',
  'maxSinglePointAreaInfluence', 'maxRetainedIou', 'minVisibility',
  'maxConnectedVisibilityGap',
] as const

export function assessPoseCoherence(input: unknown): ShadowAssessment {
  const m = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : {}
  const diagnostics: Record<string, unknown> = {}
  // Explicit allowlist: no pose index, source, label, player, video or timestamp.
  for (const key of diagnosticFields) {
    const value = m[key]
    if (typeof value === 'number') diagnostics[key] = Number.isFinite(value) ? value : null
    else if (Array.isArray(value)) diagnostics[key] = value.map(v => typeof v === 'number' && Number.isFinite(v) ? v : null)
    else if (key === 'shoulderHipOrdering' && ['ABOVE', 'BELOW', 'LEVEL'].includes(value as string)) diagnostics[key] = value
  }
  const invalid: Record<string, number | null> = {}
  const required = (key: string, valid: (v: number) => boolean) => {
    const v = m[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || !valid(v)) invalid[key] = typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  // Positive extents/denominators are mathematical prerequisites, not body-size gates.
  for (const key of ['bodyHeight', 'bboxAspect', 'bboxArea', 'torsoLength']) required(key, v => v > 0)
  required('torsoAngle', v => Math.abs(v) <= 180)
  required('sideVectorCosine', v => Math.abs(v) <= 1 + COSINE_ROUNDOFF)
  if (m.unavailable !== undefined || Object.keys(invalid).length) {
    return { version: 'shadow-v0', authority: 'NONE', status: 'INSUFFICIENT_EVIDENCE', diagnostics,
      reasons: [{ code: 'INSUFFICIENT_GEOMETRY', tier: 0, measurements: invalid,
        explanation: 'Required derived geometry is missing, non-finite, outside its mathematical domain, or has a zero/invalid extent or denominator. No structural conclusion.' }] }
  }
  const reasons: ShadowReason[] = []
  const angle = m.torsoAngle as number
  const cosine = Math.max(-1, Math.min(1, m.sideVectorCosine as number))
  if (Math.abs(angle) > 90) reasons.push({ code: 'INVERTED_IMAGE_TORSO', tier: 1,
    measurements: { torsoAngle: angle }, explanation: 'Shoulder midpoint projects below hip midpoint. Camera orientation or legitimate inverted motion can also cause this.' })
  if (cosine < 0) reasons.push({ code: 'SHOULDER_HIP_VECTOR_OPPOSITION', tier: 1,
    measurements: { sideVectorCosine: cosine }, explanation: 'Projected shoulder and hip left-to-right vectors point into opposing half-planes. Twisting or projection can also cause this.' })
  // No Tier 2 promotion in v0. Correlated/unsafe weak measurements never vote.
  // Each structural family contributes at most one reason; no derived double counting.
  return { version: 'shadow-v0', authority: 'NONE', diagnostics, reasons,
    status: reasons.length === 2 ? 'STRONGLY_SUSPICIOUS' : reasons.length === 1 ? 'SUSPICIOUS' : 'NO_OBVIOUS_ANOMALY' }
}
