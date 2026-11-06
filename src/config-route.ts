/**
 * dsh-record — host-side config route.
 *
 * 单条路由 `GET /dsh-record/config`：把 Loader Config（format）下发给浏览器半。
 * 没有落盘路由——本版本只支持“录音→附加”，不写磁盘。
 * same-origin 守卫与 dsh-voice 同款（Origin/Referer 必须匹配 Host）。
 */

export interface RecordRouteConfig {
  format: 'mp3' | 'wav' | 'webm'
  tempDir: string
}

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

function writeJson(res: { writeHead(status: number, headers: Record<string, string>): unknown; end(body?: string): unknown }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export function createConfigHandler(config: RecordRouteConfig) {
  return async function configHandler(
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
  }
}
