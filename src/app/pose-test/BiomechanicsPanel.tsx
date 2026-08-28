import React from 'react'

export default function BiomechanicsPanel({ phases, analyses, selectedPoseIndex, canvasSizes, metrics, calculateBiomechanics, canonicalMetrics }: any) {
  const confLabel = (v: number) => {
    if (v >= 0.7) return 'HIGH'
    if (v >= 0.4) return 'MEDIUM'
    return 'LOW'
  }

  type ComparisonStatus = 'COACHING ELIGIBLE' | 'COACHING ELIGIBLE — REVIEW' | 'NOT RELIABLE' | 'N/A'
  type ComparisonResult = { display: string; status: ComparisonStatus; reason: string; warnings: string[] }

  const compareMetrics = (from: any, to: any, fromLabel: string, toLabel: string, kind: string): ComparisonResult => {
    if (!from || !to) return { display: 'N/A', status: 'N/A', reason: `No metric is available for ${!from ? fromLabel : toLabel}.`, warnings: [] }
    if (!from.coachingEligible || !to.coachingEligible) {
      const reasons = [
        !from.coachingEligible ? `${fromLabel}: ${from.reason || 'NOT RELIABLE'}` : null,
        !to.coachingEligible ? `${toLabel}: ${to.reason || 'NOT RELIABLE'}` : null,
      ].filter(Boolean)
      return { display: 'NOT RELIABLE', status: 'NOT RELIABLE', reason: reasons.join(' '), warnings: [] }
    }
    if (!Number.isFinite(from.value) || !Number.isFinite(to.value)) {
      return { display: 'N/A', status: 'N/A', reason: 'One or both measurements are not finite.', warnings: [] }
    }
    if (from.source !== to.source || from.unit !== to.unit) {
      return { display: 'N/A', status: 'N/A', reason: `Incompatible sources or units (${from.source}/${from.unit} vs ${to.source}/${to.unit}).`, warnings: [] }
    }
    const fromOrientation = from.diagnostics?.orientationSignature
    const toOrientation = to.diagnostics?.orientationSignature
    if (kind === 'orientationSensitive' && fromOrientation && toOrientation) {
      const relativeChange = (a: number, b: number) => Math.max(a, b) / Math.max(Math.min(a, b), 0.001)
      const shoulderSpanDrift = relativeChange(fromOrientation.shoulderSpanToTorso, toOrientation.shoulderSpanToTorso)
      const hipSpanDrift = relativeChange(fromOrientation.hipSpanToTorso, toOrientation.hipSpanToTorso)
      if (shoulderSpanDrift > 1.35 || hipSpanDrift > 1.35) {
        return { display: 'NOT RELIABLE', status: 'NOT RELIABLE', reason: 'Cross-phase projected shoulder/hip geometry changed too much for a compatible orientation-sensitive comparison.', warnings: [] }
      }
    }
    const change = to.value - from.value
    const warnings: string[] = []
    if (kind === 'knee' && Math.abs(change) > 45) {
      warnings.push('Large knee change: review phase selection, player match, and landmark geometry; the measurement is not automatically rejected.')
    }
    return { display: `${change.toFixed(2)}${from.unit}`, status: warnings.length > 0 ? 'COACHING ELIGIBLE — REVIEW' : 'COACHING ELIGIBLE', reason: '', warnings }
  }

  const statusClass = (status: ComparisonStatus) => status === 'COACHING ELIGIBLE'
    ? 'text-emerald-300'
    : status === 'COACHING ELIGIBLE — REVIEW'
      ? 'text-amber-300'
      : status === 'NOT RELIABLE'
        ? 'text-rose-400'
        : 'text-slate-400'

  const reviewWarningsForPhase = (metricKey: string, phase: string) => {
    const metric = metrics.find((candidate: any) => candidate.key === metricKey)
    if (!metric || phase === 'ready') return []
    const result = phase === 'contact'
      ? compareMetrics(metric.ready, metric.contact, 'Ready', 'Contact', metric.kind)
      : compareMetrics(metric.contact, metric.recovery, 'Contact', 'Recovery', metric.kind)
    return result.status === 'COACHING ELIGIBLE — REVIEW' ? result.warnings : []
  }

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
      <h2 className="mb-4 text-xl font-semibold text-slate-100">BIOMECHANICS</h2>
      <div className="mb-2 text-xs text-slate-400">Note: pose indices are per-image detection only; selections are manual per phase. Debug exposes both image-space and experimental world-space metrics when available.</div>
      <div className="space-y-4">
        {phases.map((phase: any) => {
          const analysis = analyses[phase]
          const sel = selectedPoseIndex[phase]
          if (!analysis || !sel) {
            return (
              <div key={phase} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
                <div className="font-semibold text-slate-100">{phase === 'ready' ? 'READY POSITION' : phase === 'contact' ? 'CONTACT POINT' : 'RECOVERY STEP'}</div>
                <div>Select a target player in the {phase} image to calculate biomechanics.</div>
              </div>
            )
          }
          const pose = analysis.poses.find((p: any) => p.poseIndex === sel) ?? null
          if (!pose) {
            return (
              <div key={phase} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-400">
                <div className="font-semibold text-slate-100">{phase === 'ready' ? 'READY POSITION' : phase === 'contact' ? 'CONTACT POINT' : 'RECOVERY STEP'}</div>
                <div>No selected pose available.</div>
              </div>
            )
          }

          const bio = calculateBiomechanics(pose, canvasSizes[phase].width, canvasSizes[phase].height)
          const canonical = (canonicalMetrics && canonicalMetrics[phase]) || null

          // Helper to format canonical metric display
          const showCanonical = (m: any) => {
            if (!m) return <div className="text-xs text-slate-400">No canonical metric</div>
            return (
              <div className="text-sm text-slate-200">
                <div className="font-medium">{m.value && !Number.isNaN(m.value) ? `${m.value.toFixed(m.unit === 'x' ? 2 : 1)}${m.unit}` : 'N/A'}</div>
                <div className="text-xs text-slate-400">{m.source.toUpperCase()} • {m.reliability}</div>
              </div>
            )
          }

          return (
            <div key={phase} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-sm text-slate-300">
              <div className="font-semibold text-slate-100">{phase === 'ready' ? 'READY POSITION' : phase === 'contact' ? 'CONTACT POINT' : 'RECOVERY STEP'}</div>

              <div className="mt-3 grid gap-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">CANONICAL METRICS</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs text-slate-300">Stance Width</div>
                      {showCanonical(canonical?.stance)}
                    </div>
                    <div>
                      <div className="text-xs text-slate-300">Knee Flexion (L / R)</div>
                      <div className="text-sm text-slate-200">{canonical ? `${canonical.kneeLeft.value.toFixed(1)}° / ${canonical.kneeRight.value.toFixed(1)}°` : 'N/A'}</div>
                      <div className="text-xs text-slate-400">{canonical ? `${canonical.kneeLeft.source.toUpperCase()} • ${canonical.kneeLeft.reliability}` : ''}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-300">Torso Lean</div>
                      {showCanonical(canonical?.torso)}
                    </div>
                    <div>
                      <div className="text-xs text-slate-300">Shoulder Tilt</div>
                      {showCanonical(canonical?.shoulder)}
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">METRIC DIAGNOSTICS (debug)</div>
                  <div className="text-xs text-slate-400 mt-2">Exact landmark coords, intermediate calculations, and crop/full-frame comparisons are shown below.</div>
                  <pre className="mt-2 text-xs text-slate-200 whitespace-pre-wrap">{JSON.stringify({
                    leftKneeAngle: bio.leftKneeAngle,
                    leftKneeFlexion: bio.leftKneeFlexion,
                    rightKneeAngle: bio.rightKneeAngle,
                    rightKneeFlexion: bio.rightKneeFlexion,
                    torsoLeanRaw: bio.torsoLeanRaw,
                    torsoLean: bio.torsoLean,
                    worldTorsoLeanRaw: bio.worldTorsoLeanRaw,
                    worldTorsoLean: bio.worldTorsoLean,
                    rawShoulderAngle: bio.rawShoulderAngle,
                    shoulderTilt: bio.shoulderTilt,
                    ankleDistNorm: bio.ankleDistNorm,
                    shoulderDistNorm: bio.shoulderDistNorm,
                    rawStanceRatio: bio.rawStanceRatio,
                    worldStanceRatio: bio.worldStanceRatio,
                    orientationReliability: bio.orientationReliability,
                    orientationReasons: bio.orientationReasons,
                    orientationCautions: bio.orientationCautions,
                    orientationSignature: bio.orientationSignature,
                    stanceDenominatorStable: bio.stanceDenominatorStable,
                    hipDistNorm: bio.hipDistNorm,
                    torsoLengthNorm: bio.torsoLengthNorm,
                    raw: bio.raw,
                    rawCanvas: bio.rawCanvas,
                    perPoseDiagnostics: analyses && analyses[phase] && (analyses[phase] as any).perPoseDiagnostics ? (analyses[phase] as any).perPoseDiagnostics : null,
                  }, null, 2)}</pre>
                </div>
                {/* Knee details */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">Knee (Left)</div>
                  <div className="text-xs text-slate-300">Hip: ({bio.raw.leftHip.x.toFixed(3)}, {bio.raw.leftHip.y.toFixed(3)}) • Knee: ({bio.raw.leftKnee.x.toFixed(3)}, {bio.raw.leftKnee.y.toFixed(3)}) • Ankle: ({bio.raw.leftAnkle.x.toFixed(3)}, {bio.raw.leftAnkle.y.toFixed(3)})</div>
                  <div className="mt-2 text-slate-200">Joint angle: {Number.isNaN(bio.leftKneeAngle) ? 'N/A' : `${bio.leftKneeAngle.toFixed(1)}°`} • Flexion: {Number.isNaN(bio.leftKneeFlexion) ? 'N/A' : `${bio.leftKneeFlexion.toFixed(1)}°`} • Visibility: {confLabel(bio.leftKneeConf)}</div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">Knee (Right)</div>
                  <div className="text-xs text-slate-300">Hip: ({bio.raw.rightHip.x.toFixed(3)}, {bio.raw.rightHip.y.toFixed(3)}) • Knee: ({bio.raw.rightKnee.x.toFixed(3)}, {bio.raw.rightKnee.y.toFixed(3)}) • Ankle: ({bio.raw.rightAnkle.x.toFixed(3)}, {bio.raw.rightAnkle.y.toFixed(3)})</div>
                  <div className="mt-2 text-slate-200">Joint angle: {Number.isNaN(bio.rightKneeAngle) ? 'N/A' : `${bio.rightKneeAngle.toFixed(1)}°`} • Flexion: {Number.isNaN(bio.rightKneeFlexion) ? 'N/A' : `${bio.rightKneeFlexion.toFixed(1)}°`} • Visibility: {confLabel(bio.rightKneeConf)}</div>
                </div>

                {/* Stance details */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">Stance Width</div>
                  <div className="text-xs text-slate-300">Left ankle: ({bio.raw.leftAnkle.x.toFixed(3)}, {bio.raw.leftAnkle.y.toFixed(3)}) • Right ankle: ({bio.raw.rightAnkle.x.toFixed(3)}, {bio.raw.rightAnkle.y.toFixed(3)})</div>
                  <div className="mt-2 text-slate-200">Ankle distance (2D): {Number.isNaN(bio.ankleDistNorm) ? 'N/A' : bio.ankleDistNorm.toFixed(3)} • Shoulder distance (2D): {Number.isNaN(bio.shoulderDistNorm) ? 'N/A' : bio.shoulderDistNorm.toFixed(3)}</div>
                  <div className="text-slate-200">Raw stance ratio (image-space): {Number.isNaN(bio.rawStanceRatio) ? 'N/A' : `${bio.rawStanceRatio.toFixed(2)}x`}</div>
                  {bio.worldStanceRatio ? (
                    <div className="text-slate-200">World stance ratio (3D experimental): {Number.isNaN(bio.worldStanceRatio) ? 'N/A' : `${bio.worldStanceRatio.toFixed(2)}x`}</div>
                  ) : (
                    <div className="text-xs text-slate-400">World landmarks not available for 3D stance calculation.</div>
                  )}
                  <div className="mt-2 text-sm">
                    <strong>Reliability:</strong> <span className={bio.orientationReliability === 'Low' ? 'text-rose-400' : bio.orientationReliability === 'Medium' ? 'text-amber-400' : 'text-emerald-300'}>{bio.orientationReliability}</span>
                    {bio.orientationReliability === 'Low' ? <div className="text-xs text-rose-400">LOW CONFIDENCE — athlete orientation affects measurement</div> : null}
                  </div>
                </div>

                {/* Torso details */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">Torso</div>
                  <div className="text-xs text-slate-300">Mid-shoulder: ({bio.raw.leftShoulder.x && bio.raw.rightShoulder.x ? ((bio.raw.leftShoulder.x + bio.raw.rightShoulder.x) / 2).toFixed(3) : 'N/A'}, {bio.raw.leftShoulder.y && bio.raw.rightShoulder.y ? ((bio.raw.leftShoulder.y + bio.raw.rightShoulder.y) / 2).toFixed(3) : 'N/A'}) • Mid-hip: ({bio.raw.leftHip.x && bio.raw.rightHip.x ? ((bio.raw.leftHip.x + bio.raw.rightHip.x) / 2).toFixed(3) : 'N/A'}, {bio.raw.leftHip.y && bio.raw.rightHip.y ? ((bio.raw.leftHip.y + bio.raw.rightHip.y) / 2).toFixed(3) : 'N/A'})</div>
                  <div className="mt-2 text-slate-200">Raw torso angle (image-space): {Number.isNaN(bio.torsoLeanRaw) ? 'N/A' : `${bio.torsoLeanRaw.toFixed(1)}°`} • Normalized torso lean: {Number.isNaN(bio.torsoLean) ? 'N/A' : `${bio.torsoLean.toFixed(1)}°`}</div>
                  {(!Number.isNaN(bio.worldTorsoLeanRaw) || !Number.isNaN(bio.worldTorsoLean)) ? (
                    <div className="text-slate-200">
                      { !Number.isNaN(bio.worldTorsoLeanRaw) ? <div>Raw world torso angle: {`${bio.worldTorsoLeanRaw.toFixed(1)}°`}</div> : null }
                      { !Number.isNaN(bio.worldTorsoLean) ? <div>Normalized world torso lean: {`${bio.worldTorsoLean.toFixed(1)}°`}</div> : null }
                    </div>
                  ) : null}
                </div>

                {/* Shoulders */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <div className="font-medium text-slate-100">Shoulder Tilt</div>
                  <div className="text-xs text-slate-300">Left: ({bio.raw.leftShoulder.x.toFixed(3)}, {bio.raw.leftShoulder.y.toFixed(3)}) • Right: ({bio.raw.rightShoulder.x.toFixed(3)}, {bio.raw.rightShoulder.y.toFixed(3)})</div>
                  <div className="mt-2 text-slate-200">Raw angle: {Number.isNaN(bio.rawShoulderAngle) ? 'N/A' : `${bio.rawShoulderAngle.toFixed(1)}°`} • Normalized tilt: {Number.isNaN(bio.shoulderTilt) ? 'N/A' : `${bio.shoulderTilt.toFixed(1)}°`} • Visibility: {confLabel(bio.shoulderTiltConf)}</div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Movement Comparison */}
        <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          <div className="font-semibold text-slate-100 mb-2">Movement Comparison</div>
          <div className="space-y-2">
            {metrics.map((m: any) => {
              const readyToContact = compareMetrics(m.ready, m.contact, 'Ready', 'Contact', m.kind)
              const contactToRecovery = compareMetrics(m.contact, m.recovery, 'Contact', 'Recovery', m.kind)
              return (
                <div key={m.key} className="rounded-xl border border-slate-800 p-2">
                  <div className="font-medium text-slate-300">{m.key}</div>
                  <div className="mt-1 text-slate-200">Ready -&gt; Contact: {readyToContact.display} <span className={`ml-2 font-semibold ${statusClass(readyToContact.status)}`}>{readyToContact.status}</span></div>
                  {readyToContact.reason ? <div className="text-xs text-slate-400">{readyToContact.reason}</div> : null}
                  {readyToContact.warnings?.map((warning: string) => <div key={warning} className="text-xs text-amber-400">WARNING: {warning}</div>)}
                  <div className="mt-1 text-slate-200">Contact -&gt; Recovery: {contactToRecovery.display} <span className={`ml-2 font-semibold ${statusClass(contactToRecovery.status)}`}>{contactToRecovery.status}</span></div>
                  {contactToRecovery.reason ? <div className="text-xs text-slate-400">{contactToRecovery.reason}</div> : null}
                  {contactToRecovery.warnings?.map((warning: string) => <div key={warning} className="text-xs text-amber-400">WARNING: {warning}</div>)}
                </div>
              )
            })}
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="font-medium text-slate-100">COACHING-SAFE BIOMECHANICS (development)</div>
            <div className="mt-2 text-xs text-slate-400">Only metrics marked COACHING ELIGIBLE are shown here. Incompatible or unreliable metrics are omitted.</div>
            <div className="mt-3 grid gap-3">
              {phases.map((phase: any) => {
                const canonical = canonicalMetrics && canonicalMetrics[phase]
                const analysis = analyses[phase]
                const sel = selectedPoseIndex[phase]
                // determine detection source for selected pose
                let detectionSource = 'FULL_FRAME'
                if (analysis && sel) {
                  const p = analysis.poses.find((x: any) => x.poseIndex === sel)
                  if (p) detectionSource = p.detectionSource ?? 'FULL_FRAME'
                }
                const leftKneeReviewWarnings = reviewWarningsForPhase('Left Knee Flexion', phase)
                const rightKneeReviewWarnings = reviewWarningsForPhase('Right Knee Flexion', phase)
                return (
                  <div key={`coach-${phase}`} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                    <div className="font-semibold text-slate-100">{phase === 'ready' ? 'READY' : phase === 'contact' ? 'CONTACT' : 'RECOVERY'}</div>
                    {canonical ? (
                      <div className="mt-2 text-sm text-slate-200">
                        <div className="mb-1"><strong>Knee Flexion</strong></div>
                        {canonical.kneeLeft && canonical.kneeLeft.coachingEligible ? (
                          <div className="text-sm">Left: {canonical.kneeLeft.value.toFixed(1)}° • {canonical.kneeLeft.source.toUpperCase()} • {canonical.kneeLeft.reliability} • <span className={leftKneeReviewWarnings.length > 0 ? 'font-semibold text-amber-300' : 'text-emerald-300'}>{leftKneeReviewWarnings.length > 0 ? 'COACHING ELIGIBLE — REVIEW' : 'COACHING ELIGIBLE'}</span>{leftKneeReviewWarnings.map((warning: string) => <div key={warning} className="text-xs text-amber-400">WARNING: {warning}</div>)}</div>
                        ) : <div className="text-xs text-slate-400">Left: NOT RELIABLE • {canonical.kneeLeft?.reason ?? ''}</div>}
                        {canonical.kneeRight && canonical.kneeRight.coachingEligible ? (
                          <div className="text-sm">Right: {canonical.kneeRight.value.toFixed(1)}° • {canonical.kneeRight.source.toUpperCase()} • {canonical.kneeRight.reliability} • <span className={rightKneeReviewWarnings.length > 0 ? 'font-semibold text-amber-300' : 'text-emerald-300'}>{rightKneeReviewWarnings.length > 0 ? 'COACHING ELIGIBLE — REVIEW' : 'COACHING ELIGIBLE'}</span>{rightKneeReviewWarnings.map((warning: string) => <div key={warning} className="text-xs text-amber-400">WARNING: {warning}</div>)}</div>
                        ) : <div className="text-xs text-slate-400">Right: NOT RELIABLE • {canonical.kneeRight?.reason ?? ''}</div>}

                        <div className="mt-2 mb-1"><strong>Torso Lean</strong></div>
                        {canonical.torso && canonical.torso.coachingEligible ? (
                          <div className="text-sm">{canonical.torso.value.toFixed(1)}° • IMAGE • {canonical.torso.reliability} • COACHING ELIGIBLE</div>
                        ) : <div className="text-xs text-slate-400">Torso: NOT RELIABLE • {canonical.torso?.reason ?? ''}</div>}

                        <div className="mt-2 mb-1"><strong>Stance Width</strong></div>
                        {canonical.stance && canonical.stance.coachingEligible ? (
                          <div className="text-sm">{canonical.stance.value.toFixed(2)}x • IMAGE • {canonical.stance.reliability} • COACHING ELIGIBLE</div>
                        ) : <div className="text-xs text-slate-400">Stance: NOT RELIABLE • {canonical.stance?.reason ?? ''}</div>}

                        <div className="mt-2 mb-1"><strong>Shoulder Tilt Magnitude</strong></div>
                        {canonical.shoulder && canonical.shoulder.coachingEligible ? (
                          <div className="text-sm">{canonical.shoulder.value.toFixed(1)}° • IMAGE • {canonical.shoulder.reliability} • COACHING ELIGIBLE</div>
                        ) : <div className="text-xs text-slate-400">Shoulder: NOT RELIABLE • {canonical.shoulder?.reason ?? ''}</div>}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">No canonical metrics available for this phase.</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
