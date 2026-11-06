/**
 * dsh-record — host-side HTTP routes.
 *
 * 两条路由，注册在 `ctx.webServer`：
 *   - `GET  /dsh-record/config`：把解析后的 Loader Config 下发给浏览器半
 *     （format / dirMode / customDir）；
 *   - `POST /dsh-record/save`：把录音字节写入目标目录，返回落盘路径。
 *     目录由客户端按 dirMode 解析后经 `x-dsh-record-dir` 传入（项目空间根目录
 *     或用户自定义目录）；文件名经 basename 清洗、目录拒绝 `..` 穿越。
 *
 * same-origin 守卫与 dsh-voice 同款：Origin/Referer 必须匹配 Host。
 */

import { basename, isAbsolute, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

export interface RecordRouteConfig {
  format: 'mp3' | 'wav' | 'webm'
  dirMode: 'workspace' | 'custom'
  customDir: string
}

/** 单次录音上限：64 MB ≈ 30 分钟 16-bit 立体声。 */
export const MAX_BODY_BYTES = 64 * 1024 * 1024

export class BodyTooLargeError extends Error {}

export function isTrustedCaller(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const headers = req.headers ?? {}
  const secSite = String(headers['sec-fetch-site'] ?? '').toLowerCase()
  if (secSite === 'cross-site' || secSite === 'same-site') return false
  const host = String(headers.host ?? '').toLowerCase()
  for (const raw of [headers.origin, headers.referer]) {
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

/** 读取请求体，带硬上限。 */
export function readBody(req: { on(event: string, cb: (chunk?: Buffer | Error) => void): unknown }, maxBytes: number): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let exceeded = false
    req.on('data', (chunk?: Buffer | Error) => {
      if (exceeded || !(chunk instanceof Uint8Array)) return
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
    req.on('error', (err?: Buffer | Error) => {
      if (!exceeded && err instanceof Error) reject(err)
    })
  })
}

/**
 * 清洗文件名：只取 basename，限制字符集，拒绝隐藏文件与 `.`/`..`。
 * 空格允许（录音文件名不含中文，但保留通用性）。
 */
export function sanitizeFileName(name: string): string | null {
  const base = basename(String(name ?? '').trim())
  if (!base || base === '.' || base === '..') return null
  if (!/^[A-Za-z0-9._()\[\] -]+$/u.test(base)) return null
  if (base.startsWith('.')) return null
  return base
}

/**
 * 解析目标目录：必须是绝对路径，且**原始输入**里不能含 `..`
 * （必须先查再 resolve，resolve 会把 `..` 悄悄折叠掉）。
 */
export function sanitizeDir(dir: string): string | null {
  const value = String(dir ?? '').trim()
  if (!value || !isAbsolute(value)) return null
  if (value.split(/[\\/]/u).includes('..')) return null
  return resolve(value)
}

function writeJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body?: string): unknown }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export interface SaveDeps {
  writeFile?: typeof writeFile
  mkdir?: typeof mkdir
}

export function createRoutes(config: RecordRouteConfig, deps: SaveDeps = {}) {
  const doWrite = deps.writeFile ?? writeFile
  const doMkdir = deps.mkdir ?? mkdir
  return {
    /** `GET /dsh-record/config` */
    async configHandler(
      req: { method?: string; headers?: Record<string, string | string[] | undefined> },
      res: Parameters<typeof writeJson>[0],
    ): Promise<void> {
      if (!isTrustedCaller(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      if (req.method !== 'GET') {
        writeJson(res, 405, { ok: false, error: 'GET only' })
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
      const name = sanitizeFileName(String(req.headers?.['x-dsh-record-name'] ?? ''))
      if (!name) {
        writeJson(res, 400, { ok: false, error: 'invalid file name' })
        return
      }
      const headerDir = String(req.headers?.['x-dsh-record-dir'] ?? '').trim()
      const dir = headerDir
        ? sanitizeDir(headerDir)
        : config.dirMode === 'custom' && config.customDir
          ? sanitizeDir(config.customDir)
          : null
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