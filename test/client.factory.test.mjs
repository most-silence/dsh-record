// Node-vm smoke test for dsh-record's client factory contract (0.4.0).
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
      // Host-provided platform module (present in the DSH NEXT seed table).
      if (id === '@deepseek-ai/dsh-client-ui-primitives') {
        return {
          SettingsForm: function SettingsForm() {},
          SettingsValueField: function SettingsValueField() {},
          SettingsFormModel: class {
            constructor() {}
            bind() { return { getSnapshot: () => ({}), subscribe: () => () => {} } }
            shell() { return {} }
            field() { return {} }
            actions() { return { edit() {}, resetField() {}, save() {}, discard() {} } }
            dispose() {}
          },
        }
      }
      throw new Error(`unexpected require(${id})`)
    },
    navigator: { mediaDevices: undefined },
    AbortController: class {
      constructor() { this.signal = { aborted: false, addEventListener() {} } }
      abort() { this.signal.aborted = true }
    },
    // fetch is used by loadHostFormat; default to "unreachable" so it falls back to mp3.
    fetch: async () => { throw new Error('no host') },
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

// A locale stub: bind(NS) returns a translate fn over that namespace's
// registered dictionary, so zh wording is available to assertions.
function makeLocale() {
  const byNs = new Map()
  return {
    register: (ns, dict) => { byNs.set(ns, dict); return () => {} },
    bind: (ns) => (key) => byNs.get(ns)?.zh?.[key] ?? key,
    __dictFor: (ns) => byNs.get(ns),
  }
}

// A configForms stub mirroring the host service surface the settings page uses.
function makeConfigForms() {
  const registered = []
  return {
    __registered: registered,
    get: (_entryId) => ({ getSnapshot: () => ({}), subscribe: () => () => {}, mutate: async () => true }),
    whileServed: (_namespaces, register) => { registered.push(register); return () => {} },
  }
}

function makeCtx({ conversation }) {
  const locale = makeLocale()
  const configForms = makeConfigForms()
  return {
    locale,
    configForms,
    effect: (fn) => fn(),
    slots: {
      inject: (key, cb) => cb(),
      register: (options) => { makeCtx.captured = options.inject; return () => {} },
    },
    inject: (names, cb) => cb({
      get: (name) => (
        name === 'conversation' ? conversation
          : name === 'configForms' ? configForms
            : undefined
      ),
    }),
  }
}

test('exports carry name and slots+locale service injection', () => {
  const { exports } = loadModule()
  assert.equal(exports.name, 'dsh-record')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
  assert.equal(typeof exports.buildFileName, 'function')
})

test('the 0.5.0 surface exposes loadHostFormat and the settings card', () => {
  const { exports } = loadModule()
  assert.equal(typeof exports.loadHostFormat, 'function')
  assert.equal(typeof exports.RecordSettingsCard, 'function')
  // encoders stay module-internal, not re-exported from the client entry
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

test('loadHostFormat falls back to mp3 when the route is unreachable', async () => {
  const { exports } = loadModule()
  assert.equal(await exports.loadHostFormat(), 'mp3')
})

test('loadHostFormat returns the host-chosen format when the route answers', async () => {
  const { exports } = loadModule({
    fetch: async () => ({ json: async () => ({ ok: true, format: 'wav' }) }),
  })
  assert.equal(await exports.loadHostFormat(), 'wav')
})

test('apply registers the mic into conversation.input.right with a list-slot id', () => {
  const { exports } = loadModule()
  const injected = []
  const registrations = []
  const conversation = { createDrafts: () => [], releaseDraftAttachments: () => {} }
  const configForms = makeConfigForms()
  const locale = makeLocale()
  const ctx = {
    locale,
    effect: (fn) => fn(),
    slots: {
      inject: (key, cb) => { injected.push(key); cb() },
      register: (options, component) => {
        registrations.push({ options, component })
        if (options.name === 'conversation.input.right') makeCtx.captured = options.inject
        return () => {}
      },
    },
    inject: (names, cb) => {
      const list = Array.from(names)
      assert.ok(
        JSON.stringify(list) === JSON.stringify(['configForms'])
        || JSON.stringify(list) === JSON.stringify(['conversation']),
        `unexpected inject names: ${JSON.stringify(list)}`,
      )
      cb({
        get: (name) => (
          name === 'conversation' ? conversation
            : name === 'configForms' ? configForms
              : undefined
        ),
      })
    },
  }
  exports.apply(ctx)
  assert.ok(injected.includes('conversation.input.right'), 'mic slot injected')
  const mic = registrations.find((r) => r.options.name === 'conversation.input.right')
  assert.ok(mic, 'mic registration captured')
  assert.equal(mic.options.id, 'dsh-record')
  assert.equal(typeof mic.options.order, 'number')
  assert.equal(typeof mic.component, 'function')
  // zh + en dictionaries registered so the tooltip follows the UI language
  const dict = locale.__dictFor('dsh-record')
  assert.ok(dict && dict.zh && dict.en, 'both locales registered')
  assert.equal(dict.zh.mic, '录音')
  assert.equal(dict.en.mic, 'Record')
  assert.equal(typeof mic.options.label, 'function')
})

test('attachRecording creates a draft and attaches it', () => {
  const { exports: ex } = loadModule()
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
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  assert.equal(typeof face.attachRecording, 'function')
  assert.equal(typeof face.getFormat, 'function')
  assert.equal(typeof face.t, 'function')

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
  const released = []
  const conversation = {
    createDrafts: (sessionId, files) => files.map((f, i) => ({ kind: 'file', id: `id-${i}`, file: f })),
    releaseDraftAttachments: (drafts) => released.push(drafts.map((d) => d.id)),
  }
  const { exports: ex } = loadModule()
  makeCtx.captured = null
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  const result = face.attachRecording('s2', { size: 10, type: 'audio/webm' }, 'rec-y.webm', () => false)
  assert.match(result, /正在提交/)
  assert.equal(released.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(released[0])), ['id-0'])
})

test('attachRecording reports a failure when createDrafts throws', () => {
  const conversation = {
    createDrafts: () => { throw new Error('boom') },
    releaseDraftAttachments: () => {},
  }
  const { exports: ex } = loadModule()
  makeCtx.captured = null
  ex.apply(makeCtx({ conversation }))
  const face = makeCtx.captured()
  const result = face.attachRecording('s3', { size: 10, type: 'audio/webm' }, 'rec-z.webm', () => true)
  assert.match(result, /附加失败.*boom/)
})
