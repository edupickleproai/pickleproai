'use client'

import { useEffect, useState } from 'react'
import { validateDuration, type PlayerConfirmation as Confirmation } from '@/lib/rally-evidence'

export default function PlayerConfirmation({ file, onChange }: { file: File; onChange: (value: Confirmation | null) => void }) {
  const [url, setUrl] = useState('')
  const [duration, setDuration] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [description, setDescription] = useState('')
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    const source = URL.createObjectURL(file)
    setUrl(source)
    return () => URL.revokeObjectURL(source)
  }, [file])
  const invalidate = () => { setConfirmed(false); onChange(null) }
  return <section className="space-y-3" aria-label="Confirm the player">
    <p>One rally per analysis. Recommended: 10–30 seconds. Maximum: 60 seconds, 100 MB.</p>
    {url && <div className="relative">
      <video src={url} preload="auto" muted playsInline className="w-full h-auto" aria-label="Representative start frame; optionally click the intended player"
        onLoadedMetadata={e => { try { setDuration(validateDuration(e.currentTarget.duration)) } catch (err) { setError((err as Error).message); setReady(false); invalidate() } }}
        onLoadedData={e => { try { validateDuration(e.currentTarget.duration); setReady(true) } catch { setReady(false) } }}
        onError={() => { setError('The preview could not be decoded. Try a supported video format.'); setReady(false); invalidate() }}
        onClick={e => { if (!ready) return; const r = e.currentTarget.getBoundingClientRect(); setPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }); invalidate() }} />
      {point && <span aria-label="Your selected point, not a detected player" className="absolute pointer-events-none text-yellow-300" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%`, transform: 'translate(-50%, -50%)' }}>＋</span>}
    </div>}
    <p className="text-sm text-slate-400">Start frame: 0s{duration !== null ? ` · Duration: ${duration.toFixed(2)}s` : ' · Loading preview…'}. Click a player optionally, then describe them. This does not establish tracking across the rally.</p>
    <label className="block">Player description (required; also the keyboard-accessible fallback)
      <textarea value={description} maxLength={1000} onChange={e => { setDescription(e.target.value); invalidate() }} placeholder="Shirt color, court side, or other visible details" className="block w-full rounded bg-[#0B1321] p-3" />
    </label>
    <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={!ready || !description.trim()} onChange={e => {
      setConfirmed(e.target.checked)
      onChange(e.target.checked ? { confirmed: true, kind: 'user-confirmed', description: description.trim(), representativeTime: 0, point, coordinateBasis: 'normalized-displayed-frame', trackingEstablished: false } : null)
    }} />I confirm this is the player I want coached.</label>
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </section>
}
