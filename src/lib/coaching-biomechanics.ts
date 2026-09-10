export const COACHING_BIOMECHANICS_STORAGE_KEY = 'picklepro:coaching-biomechanics:v1'

export type CoachingPhase = 'ready' | 'contact' | 'recovery'
export type CoachingMetricName = 'leftKneeFlexion' | 'rightKneeFlexion' | 'torsoLean' | 'stanceWidth' | 'shoulderTiltMagnitude'
export type CoachingMetricStatus = 'coaching_eligible' | 'coaching_eligible_review'
export type CoachingWarningCode = 'large_phase_change' | 'review_required'

export type CoachingBiomechanicsMetric = {
  metric: CoachingMetricName
  value: number
  unit: 'degrees' | 'ratio'
  status: CoachingMetricStatus
  warnings: CoachingWarningCode[]
}

export type CoachingBiomechanicsComparison = {
  compatibility: 'image_geometry_checked'
  metric: CoachingMetricName
  fromPhase: CoachingPhase
  toPhase: CoachingPhase
  delta: number
  unit: 'degrees' | 'ratio'
  status: CoachingMetricStatus
  warnings: CoachingWarningCode[]
}

export type CoachingBiomechanicsPayload = {
  schemaVersion: '1.0'
  source: { kind: 'pose-test'; videoFingerprint: string | null }
  phases: Array<{ phase: CoachingPhase; metrics: CoachingBiomechanicsMetric[] }>
  comparisons: CoachingBiomechanicsComparison[]
}

type CanonicalMetric = {
  value?: unknown
  unit?: unknown
  source?: unknown
  coachingEligible?: unknown
  diagnostics?: {
    orientationSignature?: {
      shoulderSpanToTorso?: unknown
      hipSpanToTorso?: unknown
    }
  }
}

export type CoachingComparisonEvaluation = {
  status: 'COACHING ELIGIBLE' | 'COACHING ELIGIBLE — REVIEW' | 'NOT RELIABLE' | 'N/A'
  delta: number | null
  unit: 'degrees' | 'ratio' | null
  reason: string
  warnings: CoachingWarningCode[]
}

type CanonicalPhase = {
  kneeLeft?: CanonicalMetric
  kneeRight?: CanonicalMetric
  torso?: CanonicalMetric
  stance?: CanonicalMetric
  shoulder?: CanonicalMetric
} | null

const phaseOrder: CoachingPhase[] = ['ready', 'contact', 'recovery']
const metricDefinitions: Array<{ name: CoachingMetricName; key: keyof NonNullable<CanonicalPhase>; unit: 'degrees' | 'ratio'; orientationSensitive: boolean }> = [
  { name: 'leftKneeFlexion', key: 'kneeLeft', unit: 'degrees', orientationSensitive: false },
  { name: 'rightKneeFlexion', key: 'kneeRight', unit: 'degrees', orientationSensitive: false },
  { name: 'torsoLean', key: 'torso', unit: 'degrees', orientationSensitive: true },
  { name: 'stanceWidth', key: 'stance', unit: 'ratio', orientationSensitive: true },
  { name: 'shoulderTiltMagnitude', key: 'shoulder', unit: 'degrees', orientationSensitive: true },
]

const metricBounds: Record<CoachingMetricName, [number, number]> = {
  leftKneeFlexion: [0, 180],
  rightKneeFlexion: [0, 180],
  torsoLean: [0, 90],
  stanceWidth: [0, 20],
  shoulderTiltMagnitude: [0, 90],
}

function validValue(metric: CoachingMetricName, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const [min, max] = metricBounds[metric]
  return value >= min && value <= max
}

function canonicalUnitMatches(unit: unknown, expected: 'degrees' | 'ratio') {
  return unit === expected || unit === (expected === 'degrees' ? '°' : 'x')
}

function orientationCompatible(from: CanonicalMetric, to: CanonicalMetric) {
  const a = from.diagnostics?.orientationSignature
  const b = to.diagnostics?.orientationSignature
  if (!a || !b) return false
  const values = [a.shoulderSpanToTorso, a.hipSpanToTorso, b.shoulderSpanToTorso, b.hipSpanToTorso]
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return false
  const relativeChange = (x: number, y: number) => Math.max(x, y) / Math.max(Math.min(x, y), 0.001)
  return relativeChange(a.shoulderSpanToTorso as number, b.shoulderSpanToTorso as number) <= 1.35
    && relativeChange(a.hipSpanToTorso as number, b.hipSpanToTorso as number) <= 1.35
}

export function evaluateCoachingComparison(from: CanonicalMetric | null | undefined, to: CanonicalMetric | null | undefined, metric: CoachingMetricName): CoachingComparisonEvaluation {
  const definition = metricDefinitions.find((entry) => entry.name === metric)
  if (!definition || !from || !to) return { status: 'N/A', delta: null, unit: null, reason: 'One or both phase metrics are unavailable.', warnings: [] }
  if (from.coachingEligible !== true || to.coachingEligible !== true) {
    return { status: 'NOT RELIABLE', delta: null, unit: null, reason: 'One or both phase metrics are not coaching eligible.', warnings: [] }
  }
  if (from.source !== 'image' || to.source !== 'image' || from.unit !== to.unit || !canonicalUnitMatches(from.unit, definition.unit)) {
    return { status: 'N/A', delta: null, unit: null, reason: 'Metric sources or units are incompatible.', warnings: [] }
  }
  if (!validValue(metric, from.value) || !validValue(metric, to.value)) {
    return { status: 'N/A', delta: null, unit: null, reason: 'One or both phase values are invalid.', warnings: [] }
  }
  if (definition.orientationSensitive && !orientationCompatible(from, to)) {
    return { status: 'NOT RELIABLE', delta: null, unit: null, reason: 'Cross-phase projected shoulder/hip geometry is not compatible.', warnings: [] }
  }
  const delta = to.value - from.value
  const warnings: CoachingWarningCode[] = !definition.orientationSensitive && Math.abs(delta) > 45 ? ['large_phase_change'] : []
  return {
    status: warnings.length ? 'COACHING ELIGIBLE — REVIEW' : 'COACHING ELIGIBLE',
    delta,
    unit: definition.unit,
    reason: '',
    warnings,
  }
}

export function videoFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function biomechanicsForVideo(input: unknown, fingerprint: string | null): CoachingBiomechanicsPayload | null {
  const payload = sanitizeCoachingBiomechanicsPayload(input)
  return fingerprint && payload?.source.videoFingerprint === fingerprint ? payload : null
}

// Read at send time so another tab's latest result is used. Storage access and
// JSON parsing both fail closed; invalid data never needs to be rewritten.
export function readStoredCoachingBiomechanics(getStorage: () => Pick<Storage, 'getItem'>, fingerprint?: string | null): CoachingBiomechanicsPayload | null {
  try {
    const raw = getStorage().getItem(COACHING_BIOMECHANICS_STORAGE_KEY)
    if (!raw) return null
    const input: unknown = JSON.parse(raw)
    return fingerprint === undefined ? sanitizeCoachingBiomechanicsPayload(input) : biomechanicsForVideo(input, fingerprint)
  } catch {
    return null
  }
}

export function clearStoredVideoBiomechanics(getStorage: () => Pick<Storage, 'getItem' | 'removeItem'>, fingerprint: string | null) {
  try {
    const storage = getStorage()
    if (fingerprint && readStoredCoachingBiomechanics(() => storage, fingerprint)) storage.removeItem(COACHING_BIOMECHANICS_STORAGE_KEY)
  } catch {
    // Storage is optional, including when access itself is denied.
  }
}

export function appendVideoBiomechanics(form: FormData, file: Pick<File, 'name' | 'size' | 'lastModified'>, getStorage: () => Pick<Storage, 'getItem'>) {
  form.set('videoLastModified', String(file.lastModified))
  const payload = readStoredCoachingBiomechanics(getStorage, videoFingerprint(file))
  form.delete('coachingBiomechanics')
  if (payload) form.set('coachingBiomechanics', JSON.stringify(payload))
  return payload
}

export function readVideoBiomechanicsForm(form: FormData): CoachingBiomechanicsPayload | null {
  try {
    const file = form.get('video')
    const modified = form.get('videoLastModified')
    const raw = form.get('coachingBiomechanics')
    if (!file || typeof file === 'string' || typeof modified !== 'string' || !/^\d+$/.test(modified) || typeof raw !== 'string') return null
    const lastModified = Number(modified)
    if (!Number.isSafeInteger(lastModified)) return null
    return biomechanicsForVideo(JSON.parse(raw), videoFingerprint({ name: file.name, size: file.size, lastModified }))
  } catch {
    return null
  }
}

export function buildCoachingBiomechanicsPayload(canonical: Record<CoachingPhase, CanonicalPhase>, sourceVideoFingerprint: string | null = null): CoachingBiomechanicsPayload {
  const phases: CoachingBiomechanicsPayload['phases'] = phaseOrder.map((phase) => ({
    phase,
    metrics: metricDefinitions.flatMap((definition) => {
      const candidate = canonical[phase]?.[definition.key]
      if (!candidate || candidate.coachingEligible !== true || candidate.source !== 'image' || !canonicalUnitMatches(candidate.unit, definition.unit) || !validValue(definition.name, candidate.value)) return []
      const metric: CoachingBiomechanicsMetric = { metric: definition.name, value: candidate.value, unit: definition.unit, status: 'coaching_eligible', warnings: [] }
      return [metric]
    }),
  }))

  const comparisons: CoachingBiomechanicsComparison[] = []
  for (const [fromPhase, toPhase] of [['ready', 'contact'], ['contact', 'recovery']] as Array<[CoachingPhase, CoachingPhase]>) {
    for (const definition of metricDefinitions) {
      const from = canonical[fromPhase]?.[definition.key]
      const to = canonical[toPhase]?.[definition.key]
      const evaluation = evaluateCoachingComparison(from, to, definition.name)
      if (evaluation.delta === null || !evaluation.unit || (evaluation.status !== 'COACHING ELIGIBLE' && evaluation.status !== 'COACHING ELIGIBLE — REVIEW')) continue
      const warnings = evaluation.warnings
      const status: CoachingMetricStatus = warnings.length ? 'coaching_eligible_review' : 'coaching_eligible'
      comparisons.push({ compatibility: 'image_geometry_checked', metric: definition.name, fromPhase, toPhase, delta: evaluation.delta, unit: evaluation.unit, status, warnings })

      if (warnings.length) {
        const destination = phases.find((entry) => entry.phase === toPhase)?.metrics.find((entry) => entry.metric === definition.name)
        if (destination) {
          destination.status = 'coaching_eligible_review'
          destination.warnings = [...warnings]
        }
      }
    }
  }

  return { schemaVersion: '1.0', source: { kind: 'pose-test', videoFingerprint: sourceVideoFingerprint }, phases, comparisons }
}

export function sanitizeCoachingBiomechanicsPayload(input: unknown): CoachingBiomechanicsPayload | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<CoachingBiomechanicsPayload>
  if (candidate.schemaVersion !== '1.0' || candidate.source?.kind !== 'pose-test' || !Array.isArray(candidate.phases) || !Array.isArray(candidate.comparisons)) return null
  const fingerprint = candidate.source.videoFingerprint
  if (fingerprint !== null && (typeof fingerprint !== 'string' || !fingerprint.length || fingerprint.length > 1024)) return null
  const source = { kind: 'pose-test' as const, videoFingerprint: fingerprint }

  // Treat these as untrusted JSON, including fields from older/debug schemas.
  const safety = (entry: any): { status: CoachingMetricStatus; warnings: CoachingWarningCode[] } | null => {
    if (!entry || (entry.status !== 'coaching_eligible' && entry.status !== 'coaching_eligible_review')) return null
    if (entry.source !== undefined && entry.source !== 'image') return null
    if (entry.coachingEligible !== undefined && entry.coachingEligible !== true) return null
    if (entry.experimental === true || entry.debug === true || entry.reliability === 'Low' || entry.reliability === 'NOT RELIABLE' || entry.reliability === 'N/A') return null
    if (!Array.isArray(entry.warnings) || entry.warnings.some((warning: unknown) => warning !== 'large_phase_change' && warning !== 'review_required')) return null
    const warnings: CoachingWarningCode[] = [...new Set<CoachingWarningCode>(entry.warnings)]
    if (entry.status === 'coaching_eligible_review' && !warnings.length) warnings.push('review_required')
    return { status: warnings.length ? 'coaching_eligible_review' : 'coaching_eligible', warnings }
  }

  const phases = phaseOrder.map((phase) => {
    const matches = candidate.phases.filter((entry) => entry?.phase === phase)
    const source = matches.length === 1 ? matches[0] : null
    const metrics = Array.isArray(source?.metrics) ? source.metrics.flatMap((metric) => {
      const definition = metricDefinitions.find((entry) => entry.name === metric?.metric)
      if (!definition || metric.unit !== definition.unit || !validValue(definition.name, metric.value)) return []
      if (source.metrics.filter((entry) => entry?.metric === definition.name).length !== 1) return []
      const checked = safety(metric)
      if (!checked) return []
      return [{ metric: definition.name, value: metric.value, unit: definition.unit, ...checked }]
    }) : []
    return { phase, metrics }
  })

  const comparisons = [...candidate.comparisons].sort((a, b) => phaseOrder.indexOf(a?.fromPhase) - phaseOrder.indexOf(b?.fromPhase)).flatMap((comparison) => {
    const definition = metricDefinitions.find((entry) => entry.name === comparison?.metric)
    if (!definition || comparison.unit !== definition.unit || typeof comparison.delta !== 'number' || !Number.isFinite(comparison.delta)) return []
    if (!phaseOrder.includes(comparison.fromPhase) || !phaseOrder.includes(comparison.toPhase)) return []
    const validPair = (comparison.fromPhase === 'ready' && comparison.toPhase === 'contact') || (comparison.fromPhase === 'contact' && comparison.toPhase === 'recovery')
    if (!validPair || (comparison.status !== 'coaching_eligible' && comparison.status !== 'coaching_eligible_review')) return []
    if (candidate.comparisons.filter((entry) => entry?.metric === comparison.metric && entry?.fromPhase === comparison.fromPhase && entry?.toPhase === comparison.toPhase).length !== 1) return []
    // Older comparisons without compatibility evidence fail closed. Never infer
    // compatibility from phase values alone (especially for projected geometry).
    if (comparison.compatibility !== 'image_geometry_checked') return []
    const from = phases.find((entry) => entry.phase === comparison.fromPhase)?.metrics.find((entry) => entry.metric === definition.name)
    const to = phases.find((entry) => entry.phase === comparison.toPhase)?.metrics.find((entry) => entry.metric === definition.name)
    if (!from || !to || Math.abs(comparison.delta - (to.value - from.value)) > 0.000001) return []
    const checked = safety(comparison)
    if (!checked) return []
    const warnings = [...new Set<CoachingWarningCode>([...checked.warnings, ...from.warnings, ...to.warnings])]
    if (!definition.orientationSensitive && Math.abs(comparison.delta) > 45 && !warnings.includes('large_phase_change')) warnings.push('large_phase_change')
    if (warnings.length) {
      to.status = 'coaching_eligible_review'
      to.warnings = [...new Set([...to.warnings, ...warnings])]
    }
    return [{ compatibility: 'image_geometry_checked' as const, metric: definition.name, fromPhase: comparison.fromPhase, toPhase: comparison.toPhase, delta: to.value - from.value, unit: definition.unit, status: warnings.length ? 'coaching_eligible_review' as const : 'coaching_eligible' as const, warnings }]
  })

  if (!phases.some((phase) => phase.metrics.length) && !comparisons.length) return null
  return { schemaVersion: '1.0', source, phases, comparisons }
}

const metricLabels: Record<CoachingMetricName, string> = {
  leftKneeFlexion: 'Left knee flexion',
  rightKneeFlexion: 'Right knee flexion',
  torsoLean: 'Torso lean',
  stanceWidth: 'Stance width',
  shoulderTiltMagnitude: 'Shoulder tilt magnitude',
}

export function coachingReviewNotice(input: unknown): string {
  const payload = sanitizeCoachingBiomechanicsPayload(input)
  if (!payload?.phases.some((phase) => phase.metrics.some((metric) => metric.status === 'coaching_eligible_review'))
    && !payload?.comparisons.some((comparison) => comparison.status === 'coaching_eligible_review')) return ''
  return 'Biomechanics review required: flagged measurements are uncertain. Verify the selected player, phase frames, and visible movement before relying on advice based on them.'
}

export function addCoachingReviewNotice(text: string, input: unknown): string {
  const notice = coachingReviewNotice(input)
  if (!notice) return text
  return /^\s*Diagnosis:/i.test(text)
    ? text.replace(/^(\s*Diagnosis:\s*)/i, `$1${notice}\n\n`)
    : `${notice}\n\n${text}`
}

export function formatCoachingBiomechanicsForPrompt(payload: CoachingBiomechanicsPayload | null): string {
  payload = sanitizeCoachingBiomechanicsPayload(payload)
  if (!payload) return 'No trusted biomechanics supplied.'
  const lines = [
    'Trusted biomechanics (whitelisted coaching payload):',
    'These measurements describe only the selected player and phases in the stored pose analysis. They are not general facts about the player or measurements of other footage.',
    'Use only explicitly listed comparisons. Do not calculate additional numeric phase changes from individual metrics; omitted comparisons may have incompatible sources or orientation.',
    'Omitted measurements are unavailable, not zero or normal. Separate qualitative video observations from measured biomechanics. Phase labels refer to the selected pose frames, which may differ from the video preview frames.',
    'For any REVIEW value, explicitly state its uncertainty in the diagnosis. Do not use it to assert that flexibility, technique, or movement quality is good or bad; give conditional advice pending verification.',
  ]
  const headerLength = lines.length
  for (const phase of payload.phases) {
    for (const metric of phase.metrics) {
      const suffix = metric.status === 'coaching_eligible_review' ? ' [COACHING ELIGIBLE — REVIEW: interpret cautiously; verify against visible footage]' : ' [COACHING ELIGIBLE]'
      lines.push(`- ${phase.phase}: ${metricLabels[metric.metric]} = ${metric.value.toFixed(metric.unit === 'ratio' ? 2 : 1)} ${metric.unit}${suffix}`)
    }
  }
  for (const comparison of payload.comparisons) {
    const suffix = comparison.status === 'coaching_eligible_review' ? ' [COACHING ELIGIBLE — REVIEW: interpret cautiously; verify phase selection and visible footage]' : ' [COACHING ELIGIBLE]'
    lines.push(`- ${comparison.fromPhase} to ${comparison.toPhase}: ${metricLabels[comparison.metric]} delta = ${comparison.delta.toFixed(2)} ${comparison.unit}${suffix}`)
  }
  return lines.length === headerLength ? 'No trusted biomechanics supplied.' : lines.join('\n')
}
