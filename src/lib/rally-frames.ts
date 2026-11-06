import { spawn } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import path from 'path'
import ffmpeg from 'ffmpeg-static'
import { sampleTimes, validateDuration } from './rally-evidence'

export type RallyFrame = { path: string; timestamp: number }
function run(binary: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { windowsHide: true })
    let stdout = '', stderr = '', expired = false
    const timer = setTimeout(() => { expired = true; child.kill(); reject(new Error('Video processing timed out.')) }, timeout)
    child.stdout.on('data', data => { stdout += data; if (stdout.length > 1_000_000) { child.kill(); reject(new Error('Unexpected video metadata size.')) } })
    child.stderr.on('data', data => { stderr += data; if (stderr.length > 1_000_000) { child.kill(); reject(new Error('Unexpected video diagnostic size.')) } })
    child.on('error', () => { clearTimeout(timer); reject(new Error('Video tools are unavailable. Configure FFmpeg and FFprobe on the server.')) })
    child.on('close', code => { clearTimeout(timer); if (!expired) code === 0 ? resolve({ stdout, stderr }) : reject(new Error('Video could not be decoded. Use a supported video file.')) })
  })
}

export async function extractRallyFrames(input: string, directory: string) {
  const binary = process.env.FFMPEG_PATH || ffmpeg
  if (!binary) throw new Error('FFmpeg is unavailable.')
  const sibling = path.join(path.dirname(binary), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const probe = process.env.FFPROBE_PATH || (existsSync(sibling) ? sibling : 'ffprobe')
  const metadata = await run(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration,width,height:format=duration', '-of', 'json', input], 10000)
  const info = JSON.parse(metadata.stdout)
  if (!info.streams?.length) throw new Error('No video stream was found.')
  const duration = validateDuration(Number(info.format?.duration ?? info.streams[0].duration))
  if (!(info.streams[0].width > 0 && info.streams[0].height > 0) || info.streams[0].width * info.streams[0].height > 3840 * 2160) throw new Error('Video resolution must be no larger than 4K.')
  const requested = sampleTimes(duration)
  await fs.mkdir(directory, { recursive: true })
  // Select the first decoded frame at/after each target. showinfo records actual
  // presentation timestamps after resetting the stream origin, before any resize.
  const selection = requested.map((t, i) => i === 0 ? 'isnan(prev_selected_t)' : `gte(t,${t})*lt(prev_selected_t,${t})`).join('+')
  const result = await run(binary, ['-nostdin', '-y', '-i', input, '-map', '0:v:0', '-an', '-vf', `setpts=PTS-STARTPTS,select='${selection}',showinfo,scale=512:512:force_original_aspect_ratio=decrease`, '-fps_mode', 'vfr', '-frames:v', String(requested.length), '-q:v', '2', path.join(directory, 'frame_%03d.jpg')], 60000)
  const times = [...result.stderr.matchAll(/\bn:\s*\d+\s+pts:\s*\S+\s+pts_time:([\d.e+-]+)/g)].map(m => Number(m[1]))
  const files = (await fs.readdir(directory)).filter(f => /^frame_\d+\.jpg$/.test(f)).sort()
  if (files.length !== requested.length || times.length !== files.length || times.some((t, i) => !Number.isFinite(t) || t < 0 || t >= duration || (i > 0 && t <= times[i - 1]))) throw new Error('Could not verify ordered frame coverage; no analysis was performed.')
  return { duration, frames: files.map((f, i) => ({ path: path.join(directory, f), timestamp: times[i] })), requested }
}
