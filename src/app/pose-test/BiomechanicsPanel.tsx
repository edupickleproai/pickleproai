import React from 'react'

export default function BiomechanicsPanel({ phases, analyses, selectedPoseIndex, canvasSizes, metrics, delta, calculateBiomechanics, canonicalMetrics }: any) {
  const confLabel = (v: number) => {
    if (v >= 0.7) return 'HIGH'
    if (v >= 0.4) return 'MEDIUM'
    return 'LOW'
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
            {metrics.map((m: any) => (
              <div key={m.key} className="flex items-center justify-between">
                <div className="text-slate-300">{m.key}</div>
                <div className="text-slate-200">
                  {`Ready -> Contact: ${isNaN(m.a) || isNaN(m.b) ? 'N/A' : `${delta(m.a, m.b).toFixed(2)}${m.unit}`}  |  Contact -> Recovery: ${isNaN(m.b) || isNaN(m.c) ? 'N/A' : `${delta(m.b, m.c).toFixed(2)}${m.unit}`}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
