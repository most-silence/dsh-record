/**
 * dsh-record — host-side HTTP routes.
 *
 * 两条路由，注册在 `ctx.webServer`（same-origin 守卫参考 dsh-voice 的
 * http-util）：
 *   - `GET /dsh-record/config`：把 Loader Config（format/saveMode/saveDir）
 *     交给浏览器半，客户端据此决定转码格式与落盘位置。
 *   - `POST /dsh-record/save`：接收录音字节（任意 format），写到目标目录。
 *     目录优先取请求头 `x-dsh-record-dir`（workspace 模式由客户端解析会话
 *     cwd），缺省用 Config 的 saveDir（custom 模式）。文件名经 basename
 *     清洗，拒绝路径分隔符与 `..`。
 */

import { basename, isAbsolute, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

export interface RecordRouteConfig {
  format: 'mp3' | 'wav' | 'webm'
  saveMode: 'workspace' | 'custom' | 'off'
  saveDir: string
}

/** Max accepted recording payload: 64 MB ≈ 30+ minutes of 16-bit stereo. */
export const MAX_BODY_BYTES = 64 * 1024 * 1024

export class BodyTooLargeError extends Error {}

/** Collect the request body as one Buffer with a hard size cap. */
export function readBody(req: { on(event: string, cb: (chunk?: Buffer | Error) => void): unknown }, maxBytes: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let exceeded = false
    req.on('data', (chunk: Buffer) => {
      if (exceeded) return
      size += chunk.length
      if (size > maxBytes) {
        exceeded = true
        reject(new BodyTooLargeError('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!exceeded) resolvePromise(Buffer.concat(chunks))
    })
    req.on('error', (err: Error) => {
      if (!exceeded) reject(err)
    })
  })
}

/**
 * Same-origin guard: Origin/Referer (when present) must match the Host header,
 * cross-site fetches are rejected. Mirrors dsh-voice's isTrustedCaller core.
 */
export function isTrustedCaller(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const headers = req.headers ?? {}
  const secSite = String(headers['sec-fetch-site'] ?? '').toLowerCase()
  if (secSite === 'cross-site' || secSite === 'same-site') return false
  const host = String(headers.host ?? '').toLowerCase()
  const candidates = [headers.origin, headers.referer]
  for (const raw of candidates) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.host.toLowerCase() !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * Sanitize the requested file name: basename only, printable safe charset,
 * never empty, never `.`-only. Returns null when the name is unusable.
 */
export function sanitizeFileName(name: string): string | null {
  const base = basename(String(name ?? '').trim())
  if (!base || base === '.' || base === '..') return null
  if (!/^[A-Za-z0-9._()\[\] -]+$/u.test(base)) return null
  if (base.startsWith('.')) return null
  return base
}

/**
 * Resolve the target directory. The client-supplied dir (workspace mode) must
 * be absolute and free of `..` segments in its RAW form (checked before
 * normalization — resolve() would silently collapse them).
 */
export function sanitizeDir(dir: string): string | null {
  const value = String(dir ?? '').trim()
  if (!value || !isAbsolute(value)) return null
  if (value.split(/[\\/]/u).includes('..')) return null
  return resolve(value)
}

/** Minimal writeJson helper (same shape as dsh-voice's). */
function writeJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body?: string): unknown }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export interface SaveDeps {
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
}

/** Build the two route handlers; fs injectable for tests. */
export function createRoutes(config: RecordRouteConfig, deps: SaveDeps = {}) {
  const doWrite = deps.writeFile ?? writeFile
  const doMkdir = deps.mkdir ?? mkdir
  return {
    /** `GET /dsh-record/config` */
    async configHandler(req: { method?: string; headers?: Record<string, string | string[] | undefined> }, res: Parameters<typeof writeJson>[0]): Promise<void> {
      if (!isTrustedCaller(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      writeJson(res, 200, { ok: true, ...config })
    },
    /** `POST /dsh-record/save` */
    async saveHandler(
      req: {
        method?: string
        headers?: Record<string, string | string[] | undefined>
        on(event: string, cb: (chunk?: Buffer | Error) => void): unknown
        resume?(): unknown
        removeListener?(event: string, cb: unknown): unknown
      },
      res: Parameters<typeof writeJson>[0],
    ): Promise<void> {
      if (!isTrustedCaller(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      let body: Buffer
      try {
        body = await readBody(req, MAX_BODY_BYTES)
      } catch (err) {
        const tooLarge = err instanceof BodyTooLargeError
        writeJson(res, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body too large' : String(err) })
        return
      }
      if (body.length === 0) {
        writeJson(res, 400, { ok: false, error: 'empty body' })
        return
      }
      const rawName = String(req.headers?.['x-dsh-record-name'] ?? '')
      const name = sanitizeFileName(rawName)
      if (!name) {
        writeJson(res, 400, { ok: false, error: 'invalid file name' })
        return
      }
      const headerDir = String(req.headers?.['x-dsh-record-dir'] ?? '').trim()
      const dir = headerDir ? sanitizeDir(headerDir) : config.saveMode === 'custom' && config.saveDir ? sanitizeDir(config.saveDir) : null
      if (!dir) {
        writeJson(res, 400, { ok: false, error: headerDir ? 'invalid directory' : 'no save directory configured' })
        return
      }
      const target = resolve(dir, name)
      try {
        await doMkdir(dir, { recursive: true })
        await doWrite(target, body)
      } catch (err) {
        writeJson(res, 500, { ok: false, error: String(err) })
        return
      }
      writeJson(res, 200, { ok: true, path: target, bytes: body.length })
    },
  }
}
