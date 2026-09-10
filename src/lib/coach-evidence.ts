import { formatCoachingBiomechanicsForPrompt, sanitizeCoachingBiomechanicsPayload, type CoachingMetricName } from './coaching-biomechanics'

const labels: Record<CoachingMetricName, string> = {
  leftKneeFlexion: 'left knee flexion', rightKneeFlexion: 'right knee flexion',
  torsoLean: 'torso lean', stanceWidth: 'stance width', shoulderTiltMagnitude: 'shoulder tilt magnitude',
}
const phaseLabels = { ready: 'Ready', contact: 'Contact', recovery: 'Recovery' }

export function buildCoachEvidence(message: string, input: unknown) {
  const payload = sanitizeCoachingBiomechanicsPayload(input)
  const requested: CoachingMetricName[] = []
  if (/\bknees?\b|knee[- ]?flexion/i.test(message)) {
    if (!/\bright knee\b/i.test(message) || /\bleft knee\b/i.test(message)) requested.push('leftKneeFlexion')
    if (!/\bleft knee\b/i.test(message) || /\bright knee\b/i.test(message)) requested.push('rightKneeFlexion')
  }
  if (/\btorso\b|\btrunk\b|\blean(?:ing)?\b/i.test(message)) requested.push('torsoLean')
  if (/\bstance\b|\bfeet.*\bapart\b/i.test(message)) requested.push('stanceWidth')
  if (/\bshoulder(?:s)?\b/i.test(message)) requested.push('shoulderTiltMagnitude')
  const requestedPhases = (['ready', 'contact', 'recovery'] as const).filter((phase) => new RegExp(`\\b${phase}\\b`, 'i').test(message))
  const active = requested.length > 0 || requestedPhases.length > 0
    || /\bvideo\b|\bfootage\b|\bclip\b|\bframe\b|\b(?:notice|noticed|observe|observed|observation|measurements?|biomechanics)\b/i.test(message)
  if (!active) return { active, observation: '', prompt: formatCoachingBiomechanicsForPrompt(payload) }

  const relevant = payload ? sanitizeCoachingBiomechanicsPayload({
    ...payload,
    phases: payload.phases.map((phase) => ({ ...phase, metrics: phase.metrics.filter((metric) =>
      (!requested.length || requested.includes(metric.metric)) && (!requestedPhases.length || requestedPhases.includes(phase.phase))),
    })),
    comparisons: payload.comparisons.filter((comparison) => !requested.length || requested.includes(comparison.metric)),
  }) : null
  const observed = relevant?.phases.filter((phase) => phase.metrics.length) ?? []
  const requestedNames = requested.length ? requested.map((metric) => labels[metric]).join(' or ') : 'biomechanics'
  const observation = observed.length ? observed.map(({ phase, metrics }) => {
    const measurements = metrics.map((metric) => `${labels[metric.metric]} ${metric.value.toFixed(metric.unit === 'ratio' ? 2 : 1)} ${metric.unit}${metric.status === 'coaching_eligible_review' ? ' (REVIEW: uncertain; verify against the frame)' : ''}`).join('; ')
    return `In the ${phaseLabels[phase]} frame, the available coaching-safe measurements are: ${measurements}.`
  }).join('\n\n') : `No coaching-safe ${requestedNames} measurement is available${requestedPhases.length ? ` for ${requestedPhases.map((phase) => phaseLabels[phase]).join(' or ')}` : ' from the stored video analysis'}. I cannot make a measured observation about it.`
  const missingPhases = (['ready', 'contact', 'recovery'] as const).filter((phase) => !observed.some((entry) => entry.phase === phase))
  const limits = observed.length
    ? `${missingPhases.length ? `${missingPhases.map((phase) => phaseLabels[phase]).join(' and ')} measurements are unavailable for this question. ` : ''}${observed.length === 1 ? 'This single frame cannot establish a pattern through the stroke. ' : ''}These measurements alone do not establish a technical fault or a cause.`
    : 'Unavailable measurements must not be treated as zero, normal, or evidence of a fault.'
  const groundedObservation = `${observation}\n\n${limits}`
  const focus = observed.length
    ? [...new Set(observed.flatMap(({ metrics }) => metrics.map(({ metric }) => labels[metric])))].join(', ')
    : requestedNames
  const phaseFocus = observed.map(({ phase }) => phaseLabels[phase]).join(' and ') || requestedPhases.map((phase) => phaseLabels[phase]).join(' and ') || 'requested'
  // Without a validated movement comparison, free-form corrective advice can turn
  // an isolated angle into an unsupported fault. Keep the entire plan bounded,
  // not just the observation preceding otherwise unrestricted model advice.
  const boundedResponse = !relevant?.comparisons.length
    ? `Diagnosis:\nObservation: ${groundedObservation}\n\nInterpretation: ${observed.length ? `The useful first step is to check whether these ${phaseFocus} measurements repeat, before choosing a technique change. I cannot tell from these values alone whether a technique change is needed for ${focus}.` : `I cannot assess your ${focus} from the available evidence. The next step is to obtain a usable measurement, rather than choose a correction without one.`}\n\nDrills:\n- **Frame-and-repeat check** — Record three comfortable repetitions of the same shot. Review the same player's ${phaseFocus} frame in each repetition for ${focus}; use only measurements that pass the reliability checks. If a measurement is marked REVIEW, verify the player and frame before drawing any conclusion.\n\nPractical Tip:\n${observed.length ? 'Keep your usual movement during this check. Do not change your movement just to match a target number from this snapshot.' : 'Keep the relevant body landmarks visible in the recording; a rejected measurement is not evidence that the movement is normal or faulty.'}\n\nNext Step:\n${observed.length ? `Capture another reliable ${phaseFocus} frame and check ${focus} again. Obtain reliable Ready and Contact evidence before assessing how the movement changes through the stroke.` : `Reanalyze a clearly visible ${phaseFocus} frame for ${focus}, then ask again with the accepted measurements.`}`
    : undefined
  return {
    active,
    observation: groundedObservation,
    boundedResponse,
    prompt: `VIDEO-EVIDENCE QUESTION — prioritize this evidence over profile goals.
The server will display this observation before your interpretation:
${groundedObservation}

${formatCoachingBiomechanicsForPrompt(relevant)}

Answer the actual question. In Diagnosis, interpret the relevant observation cautiously and propose one evidence-related next step, not a generic consistency or footwork diagnosis. Reference the reliable phase and requested metric. If no relevant measurement is available, acknowledge that and offer only explicitly general guidance or a way to obtain usable evidence.
A left/right difference in one frame is not proof of a fault, weakness, persistent asymmetry, or a need to equalize the knees. A single angle is not a flexibility or strength test. Do not prescribe increasing/decreasing a measured angle or correcting technique solely from these values. First suggest checking the movement in another reliable frame/repetition if a fault cannot be established.
Do not invent visual observations: this chat receives measurements, not the footage or video-analysis narrative. Keep Observation separate from Interpretation. Do not imply unavailable phases were measured. REVIEW evidence is uncertain and advice based on it must be conditional. Only supplied eligible comparisons permit numeric cross-phase changes.`,
  }
}

export function groundCoachResponse(text: string, evidence: ReturnType<typeof buildCoachEvidence>) {
  if (!evidence.active) return text
  if (evidence.boundedResponse) return evidence.boundedResponse
  // The model cannot silently omit the source measurements or their limits.
  const prefix = `Observation: ${evidence.observation}\n\nInterpretation: `
  return /^\s*Diagnosis:/i.test(text)
    ? text.replace(/^(\s*Diagnosis:\s*)/i, `$1${prefix}`)
    : `Diagnosis:\n${prefix}${text}`
}
