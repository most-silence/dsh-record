// Tests for the host-side save routes (src/save-route.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoutes, sanitizeFileName, sanitizeDir, isTrustedCaller, readBody, BodyTooLargeError, MAX_BODY_BYTES } from '../src/save-route.ts'

const CONFIG = { format: 'mp3', saveMode: 'workspace', saveDir: '' }

function res() {
  const out = { status: 0, body: null }
  out.writeHead = (status) => { out.status = status }
  out.end = (body) => { out.body = body ? JSON.parse(body) : null }
  return out
}

function req({ method = 'GET', headers = {}, chunks = [] } = {}) {
  const listeners = {}
  return {
    method,
    headers,
    on(event, cb) {
      (listeners[event] ??= []).push(cb)
      if (event === 'data') queueMicrotask(() => { for (const c of chunks) cb(c); cb.listeners = listeners })
      if (event === 'end') queueMicrotask(() => { for (const fn of listeners.end ?? []) fn() })
    },
  }
}

test('sanitizeFileName keeps safe names and rejects traversal/hidden/unsafe', () => {
  assert.equal(sanitizeFileName('rec-20261104-214711-4s.mp3'), 'rec-20261104-214711-4s.mp3')
  assert.equal(sanitizeFileName('a (1).wav'), 'a (1).wav')
  assert.equal(sanitizeFileName('a/b.webm'), 'b.webm') // basename strips the separator — no traversal possible
  assert.equal(sanitizeFileName('..'), null)
  assert.equal(sanitizeFileName('.'), null)
  assert.equal(sanitizeFileName('.hidden'), null)
  assert.equal(sanitizeFileName('a\\b.webm'), 'b.webm')
  assert.equal(sanitizeFileName('bad name!.mp3'), null)
  assert.equal(sanitizeFileName(''), null)
})

test('sanitizeDir requires absolute paths and rejects traversal', () => {
  assert.equal(sanitizeDir('E:\\proj\\recordings'), 'E:\\proj\\recordings')
  // resolve() normalizes forward slashes to backslashes on Windows
  assert.equal(sanitizeDir('E:/proj/recordings'), 'E:\\proj\\recordings')
  assert.equal(sanitizeDir('relative/path'), null)
  assert.equal(sanitizeDir(''), null)
  assert.equal(sanitizeDir('E:\\proj\\..\\..\\Windows'), null) // raw .. rejected before resolve
})

test('isTrustedCaller rejects cross-site and mismatched origin', () => {
  const ok = { headers: { host: '127.0.0.1:43129', origin: 'http://127.0.0.1:43129' } }
  assert.equal(isTrustedCaller(ok), true)
  assert.equal(isTrustedCaller({ headers: { host: '127.0.0.1:43129', origin: 'http://evil:1' } }), false)
  assert.equal(isTrustedCaller({ headers: { host: '127.0.0.1:43129', 'sec-fetch-site': 'cross-site' } }), false)
  // no origin/referer at all (loopback curl) — allowed, same as dsh-voice core
  assert.equal(isTrustedCaller({ headers: { host: '127.0.0.1:43129' } }), true)
})

test('readBody collects chunks and enforces the cap', async () => {
  const body = await readBody(req({ chunks: [Buffer.from('abc'), Buffer.from('def')] }), 10)
  assert.equal(body.toString(), 'abcdef')
  await assert.rejects(
    () => readBody(req({ chunks: [Buffer.alloc(11)] }), 10),
    BodyTooLargeError,
  )
  assert.ok(MAX_BODY_BYTES > 1024)
})

test('configHandler returns the live config', async () => {
  const routes = createRoutes(CONFIG)
  const r = res()
  await routes.configHandler(req({ headers: { host: 'h', origin: 'http://h' } }), r)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { ok: true, ...CONFIG })
})

test('saveHandler writes the payload and reports the path', async () => {
  const written = []
  const routes = createRoutes(CONFIG, {
    writeFile: async (target, body) => { written.push({ target, body }) },
    mkdir: async () => {},
  })
  const payload = Buffer.from('fake-bytes')
  const r = res()
  await routes.saveHandler(
    req({
      method: 'POST',
      headers: {
        host: 'h',
        origin: 'http://h',
        'x-dsh-record-name': 'rec-x.mp3',
        'x-dsh-record-dir': 'E:\\proj\\recordings',
      },
      chunks: [payload],
    }),
    r,
  )
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(written.length, 1)
  assert.equal(written[0].target, 'E:\\proj\\recordings\\rec-x.mp3')
  assert.equal(written[0].body.toString(), 'fake-bytes')
})

test('saveHandler falls back to configured saveDir in custom mode', async () => {
  const written = []
  const routes = createRoutes({ format: 'mp3', saveMode: 'custom', saveDir: 'D:\\Rec' }, {
    writeFile: async (target, body) => { written.push(target) },
    mkdir: async () => {},
  })
  const r = res()
  await routes.saveHandler(
    req({
      method: 'POST',
      headers: { host: 'h', origin: 'http://h', 'x-dsh-record-name': 'a.wav' },
      chunks: [Buffer.from('x')],
    }),
    r,
  )
  assert.equal(r.status, 200)
  assert.equal(written[0], 'D:\\Rec\\a.wav')
})

test('saveHandler rejects bad names, traversal dirs and non-POST', async () => {
  const routes = createRoutes(CONFIG, { writeFile: async () => {}, mkdir: async () => {} })
  const base = { host: 'h', origin: 'http://h' }

  const badName = res()
  await routes.saveHandler(req({ method: 'POST', headers: { ...base, 'x-dsh-record-name': '.env' }, chunks: [Buffer.from('x')] }), badName)
  assert.equal(badName.status, 400)

  const badDir = res()
  await routes.saveHandler(req({ method: 'POST', headers: { ...base, 'x-dsh-record-name': 'a.mp3', 'x-dsh-record-dir': 'relative' }, chunks: [Buffer.from('x')] }), badDir)
  assert.equal(badDir.status, 400)

  const noDir = res()
  await routes.saveHandler(req({ method: 'POST', headers: { ...base, 'x-dsh-record-name': 'a.mp3' }, chunks: [Buffer.from('x')] }), noDir)
  assert.equal(noDir.status, 400)

  const wrongMethod = res()
  await routes.saveHandler(req({ method: 'GET', headers: base, chunks: [] }), wrongMethod)
  assert.equal(wrongMethod.status, 405)

  const forbidden = res()
  await routes.saveHandler(req({ method: 'POST', headers: { host: 'h', origin: 'http://evil' }, chunks: [Buffer.from('x')] }), forbidden)
  assert.equal(forbidden.status, 403)
})
