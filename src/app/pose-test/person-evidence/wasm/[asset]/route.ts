import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const allowed = ['vision_wasm_internal.js','vision_wasm_internal.wasm','vision_wasm_nosimd_internal.js','vision_wasm_nosimd_internal.wasm']
export async function GET(request:Request,{params}:{params:{asset:string}}) {
  const url=new URL(request.url),host=request.headers.get('host')??url.host
  if(process.env.NODE_ENV!=='development'||! /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)||!allowed.includes(params.asset)||request.headers.get('sec-fetch-site')==='cross-site') return new Response(null,{status:404})
  url.host=host
  if(request.headers.has('origin')&&request.headers.get('origin')!==url.origin) return new Response(null,{status:404})
  try {
    const bytes=await readFile(path.join(process.cwd(),'node_modules/@mediapipe/tasks-vision/wasm',params.asset))
    return new Response(bytes,{headers:{'Content-Type':params.asset.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'}})
  } catch { return new Response(null,{status:404}) }
}
