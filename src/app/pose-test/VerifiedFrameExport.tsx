"use client"

import { useState } from 'react'
import { prepareVerifiedFrameExport, downloadVerifiedFrameArtifact, type FrameExportInput } from '@/lib/research-frame-export'

export default function VerifiedFrameExport({ input }: { input: FrameExportInput }) {
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareVerifiedFrameExport>> | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
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
  return <section aria-label="Verified frame export">
    <button disabled={busy} onClick={prepare}>Export Verified Frame</button>
    {prepared && <>
      <button onClick={e => download('jpeg', e.nativeEvent.isTrusted)}>Download original JPEG</button>
      <button onClick={e => download('provenance', e.nativeEvent.isTrusted)}>Download frame provenance</button>
    </>}
    <p role="status">{message}</p>
    <p>Research only. Video ID is the recorded source name; source ID and capture transaction identify this capture. No image or landmarks are modified.</p>
  </section>
}
