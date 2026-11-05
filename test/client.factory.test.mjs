// Node-vm smoke test for dsh-record's client factory contract (0.1.0 behavior).
// Runs without a browser: a fake require table + fake ctx drive the same
// code path the web loader uses (window.__ModuleLoader__.load).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// ---- fake react: hooks backed by per-component cells ----
function makeReact() {
  let hookCells = []
  let hookIndex = 0
  const React = {
    __reset(cells) {
      hookCells = cells
      hookIndex = 0
    },
    useState(initial) {
      const cell = hookCells[hookIndex] ?? { value: typeof initial === 'function' ? initial() : initial }
      hookCells[hookIndex] = cell
      hookIndex += 1
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
    },
    useRef(initial) {
      const cell = hookCells[hookIndex] ?? { current: initial }
      hookCells[hookIndex] = cell
      hookIndex += 1
      return cell
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: 'Fragment',
  }
  return React
}

function makeJsxRuntime() {
  return {
    jsx: (type, props) => ({ type, ...props }),
    jsxs: (type, props) => ({ type, ...props }),
    Fragment: 'Fragment',
  }
}

function loadModule(sandboxExtras = {}) {
  let registered = null
  const window = {
    __ModuleLoader__: {
      load: (entry) => { registered = entry },
    },
  }
  const documentStub = {
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => {} },
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const sandbox = createContext({
    window,
    document: documentStub,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: (id) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return jsx
      if (id === '@breezystack/lamejs') return { default: { Mp3Encoder: class { encodeBuffer() { return new Uint8Array(0) } flush() { return new Uint8Array(0) } } } }
      throw new Error(`unexpected require(${id})`)
    },
    navigator: { mediaDevices: undefined },
    AbortController: class {
      constructor() { this.signal = { aborted: false, addEventListener() {} } }
      abort() { this.signal.aborted = true }
    },
    Blob: class Blob {
      constructor(parts, opts) { this.parts = parts; this.type = opts?.type ?? ''; this.size = 10 }
    },
    File: class File {
      constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type ?? ''; this.size = 10 }
    },
    ...sandboxExtras,
  })
  sandbox.globalThis = sandbox
  const react = makeReact()
  const jsx = makeJsxRuntime()
  runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(registered, 'factory not registered')
  assert.equal(registered.id, 'dsh-record')
  const exports = registered.factory(sandbox.require)
  return { exports, react, jsx }
}

function makeCtx({ conversation }) {
  return {
    slots: {
      inject: (key, cb) => cb(),
      register: (options) => { makeCtx.captured = options.inject; return () => {} },
    },
    inject: (names, cb) => cb({
      get: (name) => (name === 'conversation' ? conversation : undefined),
    }),
  }
}

test('exports carry name and slots service injection', () => {
  const { exports } = loadModule()
  assert.equal(exports.name, 'dsh-record')
  assert.deepEqual(Array.from(exports.inject), ['slots'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(typeof exports.buildFileName, 'function')
})

test('the 0.2.0 host-config/transcode surface is gone', () => {
  const { exports } = loadModule()
  assert.equal(exports.loadHostConfig, undefined, 'loadHostConfig must not exist after rollback')
  assert.equal(exports.encodeMp3, undefined)
  assert.equal(exports.encodeWav, undefined)
})

test('buildFileName uses end-time + duration', () => {
  const { exports } = loadModule()
  assert.equal(
    exports.buildFileName(new Date(2026, 10, 4, 19, 38, 59), 12_400, 'webm'),
    'rec-20261104-193859-12s.webm',
  )
  assert.equal(
    exports.buildFileName(new Date(2026, 0, 2, 3, 4, 5), 0, 'ogg'),
    'rec-20260102-030405-1s.ogg',
  )
})

test('apply registers the mic into conversation.input.right with a list-slot id', () => {
  const { exports } = loadModule()
  const injected = []
  const registrations = []
  const conversation = { createDrafts: () => [], releaseDraftAttachments: () => {} }
  const ctx = {
    slots: {
      inject: (key, cb) => { injected.push(key); cb() },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    inject: (names, cb) => {
      assert.deepEqual(Array.from(names), ['conversation'])
      cb({ get: (name) => (name === 'conversation' ? conversation : undefined) })
    },
  }
  exports.apply(ctx)
  assert.deepEqual(JSON.parse(JSON.stringify(injected)), ['conversation.input.right'])
  assert.equal(registrations.length, 1)
  const { options, component } = registrations[0]
  assert.equal(options.name, 'conversation.input.right')
  assert.equal(options.id, 'dsh-record')
  assert.equal(typeof options.order, 'number')
  assert.equal(typeof component, 'function')
})

test('attachRecording creates a raw webm draft and attaches it', () => {
  const { exports } = loadModule()
  const created = []
  const released = []
  const conversation = {
    createDrafts: (sessionId, files) => {
      created.push({ sessionId, names: files.map((f) => f.name), types: files.map((f) => f.type) })
      return files.map((f, i) => ({ kind: 'file', id: `id-${i}`, file: f }))
    },
    releaseDraftAttachments: (drafts) => released.push(drafts.map((d) => d.id)),
  }
  makeCtx.captured = null
  const { exports: ex } = loadModule()
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  assert.equal(typeof face.attachRecording, 'function')

  const blob = { size: 10, type: 'audio/webm' }
  const attached = []
  const result = face.attachRecording('s1', blob, 'rec-x.webm', (ids) => { attached.push(...ids); return true })
  assert.equal(result, null)
  assert.equal(created.length, 1)
  assert.equal(created[0].sessionId, 's1')
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].names)), ['rec-x.webm'])
  assert.deepEqual(JSON.parse(JSON.stringify(attached)), ['id-0'])
  assert.equal(released.length, 0)
})

test('attachRecording releases drafts when addAttachments refuses', () => {
  const { exports } = loadModule()
  const released = []
  const conversation = {
    createDrafts: (sessionId, files) => files.map((f, i) => ({ kind: 'file', id: `id-${i}`, file: f })),
    releaseDraftAttachments: (drafts) => released.push(drafts.map((d) => d.id)),
  }
  makeCtx.captured = null
  const { exports: ex } = loadModule()
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  const result = face.attachRecording('s2', { size: 10, type: 'audio/webm' }, 'rec-y.webm', () => false)
  assert.match(result, /正在提交/)
  assert.equal(released.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(released[0])), ['id-0'])
})

test('attachRecording releases drafts when createDrafts throws', () => {
  const { exports } = loadModule()
  const conversation = {
    createDrafts: () => { throw new Error('boom') },
    releaseDraftAttachments: () => {},
  }
  makeCtx.captured = null
  const { exports: ex } = loadModule()
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  const result = face.attachRecording('s3', { size: 10, type: 'audio/webm' }, 'rec-z.webm', () => true)
  assert.match(result, /附加失败.*boom/)
  void exports
})