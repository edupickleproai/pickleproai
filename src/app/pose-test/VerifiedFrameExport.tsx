"use client"

import { useState } from 'react'
import { prepareVerifiedFrameExport, downloadVerifiedFrameArtifact, type FrameExportInput } from '@/lib/research-frame-export'
import { prepareCompletePoseEvidence, type EvidenceTrace } from '@/lib/research-pose-export'

export default function VerifiedFrameExport({ input, trace }: { input: FrameExportInput; trace: EvidenceTrace }) {
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareVerifiedFrameExport>> | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [evidence, setEvidence] = useState<Awaited<ReturnType<typeof prepareCompletePoseEvidence>> | null>(null)
  if (process.env.NODE_ENV !== 'development') return null
  const prepare = async () => {
    setBusy(true); setPrepared(null)
    try {
      setPrepared(await prepareVerifiedFrameExport(input))
      setMessage('Original JPEG bytes verified. Download the JPEG and its provenance separately.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Frame export failed.') }
    finally { setBusy(false) }
  }
  const download = (kind: 'jpeg' | 'provenance', trusted: boolean) => {
    if (!prepared) return
    try {
      downloadVerifiedFrameArtifact(prepared[kind], `${prepared.filename}.${kind === 'jpeg' ? 'jpg' : 'json'}`, trusted)
      setMessage(`${kind === 'jpeg' ? 'JPEG' : 'Provenance'} download requested. Verify the saved file; this does not confirm disk persistence.`)
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Download failed.') }
  }
  const prepareEvidence = async () => {
    setBusy(true); setEvidence(null)
    try { setEvidence(await prepareCompletePoseEvidence(input, trace)); setMessage('Complete pose evidence prepared. Download preserves the existing candidate and landmark order.') }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Evidence export failed.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Verified frame export">
    <button disabled={busy} onClick={prepare}>Export Verified Frame</button>
    <button disabled={busy} onClick={prepareEvidence}>Export Complete Pose Evidence</button>
    {evidence && <>
      <button onClick={e => { try { downloadVerifiedFrameArtifact(evidence.blob, evidence.filename, e.nativeEvent.isTrusted); setMessage('Evidence download requested; verify the saved checksum.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Download failed.') } }}>Download complete pose evidence JSON</button>
      <p>Evidence JSON SHA-256: {evidence.sha256}</p>
      <details><summary>Complete pose evidence preview</summary><textarea aria-label="Complete pose evidence JSON" readOnly value={evidence.json} rows={8}/></details>
    </>}
    {prepared && <>
      <button onClick={e => download('jpeg', e.nativeEvent.isTrusted)}>Download original JPEG</button>
      <button onClick={e => download('provenance', e.nativeEvent.isTrusted)}>Download frame provenance</button>
    </>}
    <p role="status">{message}</p>
    <p>Research only. Video ID is the recorded source name; source ID and capture transaction identify this capture. No image or landmarks are modified.</p>
  </section>
}
