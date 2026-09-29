"use client"

import { useEffect, useRef, useState } from 'react'

export type ResearchVideo = { id: string; filename: string; url: string }

export default function ResearchVideoSource({ onChange }: { onChange: (source: ResearchVideo | null, ready: boolean) => void }) {
  const [videos, setVideos] = useState<ResearchVideo[]>([])
  const [selected, setSelected] = useState<ResearchVideo | null>(null)
  const [status, setStatus] = useState('Loading research video list…')
  const generation = useRef(0)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    const abort = new AbortController()
    fetch('/pose-test/research-videos', { signal: abort.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() })
      .then(data => { if (!abort.signal.aborted) { setVideos(data.videos); setStatus(`${data.videos.length} research videos available.`) } })
      .catch(() => { if (!abort.signal.aborted) setStatus('Research video source unavailable. Configure PICKLEPRO_RESEARCH_VIDEO_DIR in .env.development.local and restart the development server.') })
    return () => { abort.abort(); generation.current++ }
  }, [])
  if (process.env.NODE_ENV !== 'development') return null
  const token = generation.current
  return <div className="border border-cyan-700 p-3 space-y-2">
    <p>RESEARCH ONLY — local video source. Does not change the uploaded product video.</p>
    <label>Research video source <select aria-label="Research video source" className="bg-slate-800" value={selected?.id ?? ''} onChange={event => {
      generation.current++
      const found = videos.find(video => video.id === event.target.value)
      // Use the browser origin, not Next's normalized request host. The frozen harness compares video.src literally.
      const next = found ? { ...found, url: new URL(found.url, window.location.href).href } : null
      setSelected(next); setStatus(next ? `Loading ${next.filename}…` : 'Using the uploaded video.'); onChange(next, false)
    }}><option value="">Use uploaded video</option>{videos.map(video => <option key={video.id} value={video.id}>{video.filename}</option>)}</select></label>
    <p aria-label="Research video metadata">{status}</p>
    {selected && <video key={`${selected.id}-${token}`} aria-label="Research source preview" src={selected.url} controls muted preload="auto" className="max-h-72 max-w-full" onLoadedMetadata={event => {
      if (token !== generation.current) return
      const media = event.currentTarget
      if (!Number.isFinite(media.duration) || media.duration <= 0 || !media.videoWidth || !media.videoHeight) { setStatus('Research video metadata is invalid.'); onChange(selected, false); return }
      setStatus(`${selected.filename} · ${media.duration.toFixed(6)}s · ${media.videoWidth}×${media.videoHeight} · source ${selected.id}`)
      onChange(selected, true)
    }} onError={() => { if (token === generation.current) { setStatus('Research video could not load.'); onChange(selected, false) } }}/>}
  </div>
}
