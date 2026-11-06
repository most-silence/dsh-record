/**
 * dsh-record — browser half (v0.4.0).
 *
 * 输入框右侧（`conversation.input.right` 座位）的麦克风按钮：
 *   - 录音（webm/opus 原生采集）→ 按配置的格式转码 → 会话附件挂进输入框。
 *   - **格式在插件设置页（Loader Config）选择**：mp3（默认）/ wav / webm。
 *     客户端启动时 fetch `GET /dsh-record/config` 读宿主解析后的配置；
 *     路由不可达时回退 mp3。composer 座位上不摆格式下拉框。
 *   - 悬停提示跟随界面语言：locale 服务注册 zh/en 词典，中文界面显示
 *     "录音"，英文界面显示 "Record"（宿主 locale 切换时自动重渲染）。
 *   - 录音中显示计时；文件名「结尾时间 + 时长」实时预览。
 *   - 转码失败自动附加原始 webm；Esc / ✕ / 切走标签页 = 丢弃。
 *
 * @module dsh-record/client
 */
import { encodeMp3, encodeWav, type AudioData, type RecordFormat } from './encoders'
import {
  RecordSettingsCard,
  createRecordCardController,
  dictionaries as settingsDictionaries,
  ENTRY_ID,
  NS as SETTINGS_NS,
} from './settings'

// 设置页组件对外导出，便于测试与潜在复用。
export { RecordSettingsCard } from './settings'

const React = require('react') as any
const { useState, useEffect, useRef, useCallback } = React

export const name = 'dsh-record'
export const inject = ['slots', 'locale']

/** 包名 = `plugins.bundle.config` 的 key，也是 profile 里的 bundle 名。 */
const PACKAGE_NAME = 'dsh-record'

// ---- locale 词典（zh/en 双份；宿主 locale 服务按界面语言挑选） --------------
const NS = 'dsh-record'
const zh = {
  mic: '录音',
  stop: '停止',
  cancel: '取消录音（丢弃，不附加）',
  cancelDone: '已取消录音',
  stopHint: 'Esc 取消',
  attached: '已附加',
  tooShort: '录音太短，已丢弃',
  noSession: '当前页面没有可用会话，无法处理录音',
  transcodeFailed: '转码失败，已附加原始 webm',
  deviceError: '录音设备出错',
  leavePage: '页面离开，已取消录音',
  notSupported: '当前环境不支持录音（无 getUserMedia / MediaRecorder）',
  micDenied: '麦克风权限被拒绝',
  micUnavailable: '无法打开麦克风',
  recorderFail: '录音器创建失败',
  startFail: '录音启动失败',
  submitting: '正在提交，稍后再试（录音未附加）',
  attachFailed: '附加失败',
}
const en = {
  mic: 'Record',
  stop: 'Stop',
  cancel: 'Cancel recording (discard, nothing attached)',
  cancelDone: 'Recording cancelled',
  stopHint: 'Esc to cancel',
  attached: 'Attached',
  tooShort: 'Recording too short, discarded',
  noSession: 'No session available on this page, cannot attach',
  transcodeFailed: 'transcode failed, attached the original webm',
  deviceError: 'Recording device error',
  leavePage: 'Page left, recording cancelled',
  notSupported: 'Recording is not supported here (no getUserMedia / MediaRecorder)',
  micDenied: 'Microphone permission denied',
  micUnavailable: 'Could not open the microphone',
  recorderFail: 'Failed to create the recorder',
  startFail: 'Failed to start recording',
  submitting: 'Submitting now — try again later (nothing attached)',
  attachFailed: 'Attach failed',
}

// ---- 宿主配置读取（格式在插件设置页选择） -----------------------------------
export async function loadHostFormat(timeoutMs = 3000): Promise<RecordFormat> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch('/dsh-record/config', { signal: ctrl.signal })
    clearTimeout(timer)
    const data: any = await res.json()
    if (data && data.ok && (data.format === 'mp3' || data.format === 'wav' || data.format === 'webm')) {
      return data.format as RecordFormat
    }
  } catch { /* 路由不可达/超时：回退默认 */ }
  return 'mp3'
}

// ---- 文件名 ----------------------------------------------------------------
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function buildFileName(end: Date, durationMs: number, ext: string): string {
  const secs = Math.max(1, Math.round(durationMs / 1000))
  const stamp =
    `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}` +
    `-${pad2(end.getHours())}${pad2(end.getMinutes())}${pad2(end.getSeconds())}`
  return `rec-${stamp}-${secs}s.${ext}`
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${pad2(s)}`
}

// ---- 原生容器选择（转码由 encoders 做） --------------------------------------
const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

function pickMime(): string {
  const MR: any = (globalThis as any).MediaRecorder
  if (typeof MR !== 'function' || typeof MR.isTypeSupported !== 'function') return ''
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']
  for (const c of cands) {
    try {
      if (MR.isTypeSupported(c)) return c
    } catch { /* skip */ }
  }
  return ''
}

function extOf(mime: string): string {
  for (const key of Object.keys(EXT_BY_MIME)) {
    if (mime.startsWith(key)) return EXT_BY_MIME[key]
  }
  return 'webm'
}

// ---- 转码 ------------------------------------------------------------------
async function decodeAudio(blob: Blob): Promise<AudioData> {
  const OAC: any = (globalThis as any).OfflineAudioContext
  if (typeof OAC !== 'function') throw new Error('OfflineAudioContext unavailable')
  const bytes = await blob.arrayBuffer()
  const ctx = new OAC(1, 1, 44100)
  return await ctx.decodeAudioData(bytes)
}

async function transcode(blob: Blob, format: RecordFormat): Promise<Blob> {
  if (format === 'webm') return blob
  const audio = await decodeAudio(blob)
  const bytes = format === 'mp3' ? encodeMp3(audio) : encodeWav(audio)
  const type = format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
  return new Blob([bytes as any], { type })
}

// ---- 样式 ------------------------------------------------------------------
const CSS = `
[data-dsh-record-seat]{position:relative;display:inline-flex;align-items:center;gap:2px;}
[data-dsh-record-mic],[data-dsh-record-stop]{display:inline-flex;align-items:center;gap:5px;
  height:26px;padding:0 7px;border:1px solid transparent;border-radius:6px;background:transparent;
  color:var(--dsw-alias-label-secondary,#8a8a8a);font:inherit;font-size:12px;cursor:pointer;}
[data-dsh-record-mic]:hover,[data-dsh-record-stop]:hover{background:rgba(127,127,127,.14);
  color:var(--dsw-alias-label-primary,#ddd);}
[data-dsh-record-mic][data-recording="1"]{color:var(--dsw-alias-state-error-primary,#e5484d);}
[data-dsh-record-mic] svg{display:block;}
[data-dsh-record-timer]{font-variant-numeric:tabular-nums;}
[data-dsh-record-note]{position:absolute;bottom:calc(100% + 6px);right:0;white-space:nowrap;
  padding:3px 8px;border-radius:6px;font-size:12px;line-height:1.5;
  background:var(--dsw-alias-bg-overlay,#2a2a2a);color:var(--dsw-alias-label-primary,#eee);
  border:1px solid var(--dsw-alias-border-l1,#444);box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:30;}
[data-dsh-record-note][data-tone="ok"]{border-color:var(--dsw-alias-state-success-primary,#46a758);}
`
let cssInjected = false
function ensureCss() {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const style = document.createElement('style')
  style.dataset['dshRecordStyles'] = '1'
  style.textContent = CSS
  document.head.appendChild(style)
}

// ---- Icons -----------------------------------------------------------------
const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
)

const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" />
  </svg>
)

// ---- Component -------------------------------------------------------------
type Phase = 'idle' | 'recording' | 'stopping'

interface SessionProps {
  sessionId?: string
  inputActions?: { addAttachments(ids: string[]): boolean }
  attachRecording?: (
    sessionId: string,
    blob: Blob,
    name: string,
    addAttachments: (ids: string[]) => boolean,
  ) => string | null
  /** 读宿主配置（插件设置页选择的格式）。async：首次触发 fetch，之后走缓存。 */
  getFormat?: () => Promise<RecordFormat>
  /** locale 绑定（跟随界面语言）。 */
  t?: (key: string) => string
}

function RecordButton(props: SessionProps) {
  const { sessionId } = props
  const t = props.t ?? ((key: string) => (zh as Record<string, string>)[key] ?? key)
  const [phase, setPhase] = useState('idle' as Phase)
  const [elapsed, setElapsed] = useState(0)
  const [note, setNote] = useState(null as { text: string; tone: 'err' | 'ok' } | null)
  const [liveName, setLiveName] = useState('')

  const streamRef = useRef(null as any)
  const recorderRef = useRef(null as any)
  const chunksRef = useRef([] as Blob[])
  const startRef = useRef(0)
  const mimeRef = useRef('')
  const cancelRef = useRef(false)
  const timerRef = useRef(null as any)
  const noteTimerRef = useRef(null as any)
  const attachedRef = useRef(false)
  const startingRef = useRef(false)
  const disposedRef = useRef(false)

  const showNote = useCallback((text: string, tone: 'err' | 'ok') => {
    setNote({ text, tone })
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => setNote(null), 3500)
  }, [])

  const releaseMic = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    recorderRef.current = null
    if (stream) {
      for (const track of stream.getTracks ? stream.getTracks() : []) {
        try { track.stop() } catch { /* stopped */ }
      }
    }
  }, [])

  useEffect(() => () => {
    disposedRef.current = true
    cancelRef.current = true
    if (timerRef.current) clearInterval(timerRef.current)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    releaseMic()
  }, [releaseMic])

  const abort = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      cancelRef.current = true
      try { recorderRef.current.stop() } catch { releaseMic() }
    } else {
      releaseMic()
      setPhase('idle')
    }
  }, [releaseMic])

  const start = useCallback(async () => {
    ensureCss()
    if (phase !== 'idle' || startingRef.current) return
    startingRef.current = true
    attachedRef.current = false
    cancelRef.current = false
    const md: any = typeof navigator !== 'undefined' ? (navigator as any).mediaDevices : null
    const MR: any = (globalThis as any).MediaRecorder
    if (!md || typeof md.getUserMedia !== 'function' || typeof MR !== 'function') {
      startingRef.current = false
      showNote(t('notSupported'), 'err')
      return
    }
    let stream: any
    try {
      stream = await md.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
    } catch (err: any) {
      startingRef.current = false
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      showNote(denied ? t('micDenied') : t('micUnavailable'), 'err')
      return
    }
    if (disposedRef.current) {
      for (const track of stream.getTracks()) {
        try { track.stop() } catch { /* stopped */ }
      }
      startingRef.current = false
      return
    }
    streamRef.current = stream
    const mime = pickMime()
    mimeRef.current = mime
    let recorder: any
    try {
      recorder = new MR(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      try {
        recorder = new MR(stream)
      } catch (err: any) {
        startingRef.current = false
        releaseMic()
        showNote(`${t('recorderFail')}: ${err?.message ?? String(err)}`, 'err')
        return
      }
    }
    chunksRef.current = []
    recorder.ondataavailable = (e: any) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      const durationMs = Date.now() - startRef.current
      const chunks = chunksRef.current
      chunksRef.current = []
      const type = mimeRef.current || (recorder.mimeType as string) || 'audio/webm'
      releaseMic()
      const finish = () => setPhase('idle')
      if (cancelRef.current) {
        cancelRef.current = false
        finish()
        return
      }
      const rawBlob = new Blob(chunks, { type })
      if (!attachedRef.current) {
        attachedRef.current = true
        if (rawBlob.size === 0 || durationMs < 500) {
          showNote(t('tooShort'), 'err')
          finish()
          return
        }
        if (sessionId === undefined || props.attachRecording === undefined || props.inputActions === undefined) {
          showNote(t('noSession'), 'err')
          finish()
          return
        }
        // 插件设置页选择的格式（fetch 失败已在 loadHostFormat 内回退 mp3）
        const currentFormat = props.getFormat ? await props.getFormat() : 'mp3'
        let targetBlob = rawBlob
        let targetExt = extOf(type)
        let transcodeFailed: string | null = null
        if (currentFormat !== 'webm') {
          try {
            targetBlob = await transcode(rawBlob, currentFormat)
            targetExt = currentFormat
          } catch (err: any) {
            targetExt = 'webm'
            transcodeFailed = err?.message ?? String(err)
          }
        }
        const name = buildFileName(new Date(), durationMs, targetExt)
        const err = props.attachRecording(
          sessionId,
          targetBlob,
          name,
          (ids) => props.inputActions!.addAttachments(ids),
        )
        if (err === null) {
          const base = `${t('attached')} ${name}`
          showNote(transcodeFailed ? `${base} · ${currentFormat} ${t('transcodeFailed')} (${transcodeFailed})` : base, 'ok')
        } else {
          showNote(err, 'err')
        }
      }
      finish()
    }
    recorder.onerror = () => {
      showNote(t('deviceError'), 'err')
    }
    recorderRef.current = recorder
    startRef.current = Date.now()
    setElapsed(0)
    const ext = extOf(mime || 'audio/webm')
    setLiveName(buildFileName(new Date(startRef.current), 1000, ext))
    try {
      recorder.start(250)
    } catch {
      try {
        recorder.start()
      } catch (err: any) {
        startingRef.current = false
        releaseMic()
        showNote(`${t('startFail')}: ${err?.message ?? String(err)}`, 'err')
        return
      }
    }
    setPhase('recording')
    startingRef.current = false
    timerRef.current = setInterval(() => {
      const now = Date.now()
      const dur = now - startRef.current
      setElapsed(dur)
      setLiveName(buildFileName(new Date(now), dur, ext))
    }, 500)
  }, [phase, sessionId, props.attachRecording, props.inputActions, props.getFormat, t, releaseMic, showNote])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      setPhase('stopping')
      try { recorder.stop() } catch { releaseMic(); setPhase('idle') }
    } else {
      releaseMic()
      setPhase('idle')
    }
  }, [releaseMic])

  // Escape cancels recording
  useEffect(() => {
    if (phase !== 'recording') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        abort()
        showNote(t('cancelDone'), 'err')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, abort, showNote, t])

  // Tab hidden cancels recording
  useEffect(() => {
    if (phase !== 'recording') return
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        abort()
        showNote(t('leavePage'), 'err')
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phase, abort, showNote, t])

  const recording = phase === 'recording' || phase === 'stopping'
  const micTitle = recording
    ? liveName ? `${t('stop')} → ${liveName}（${t('stopHint')}）` : `${t('stop')}（${t('stopHint')}）`
    : t('mic')

  return (
    <span {...{ 'data-dsh-record-seat': '' }}>
      {recording ? (
        <button
          type="button"
          {...{ 'data-dsh-record-stop': '', 'aria-label': t('cancel'), title: t('cancel') }}
          onClick={abort}
        >
          ✕
        </button>
      ) : null}
      <button
        type="button"
        {...{ 'data-dsh-record-mic': '', 'data-recording': recording ? '1' : '0', 'aria-label': t('mic'), title: micTitle }}
        onClick={recording ? stop : start}
        disabled={!recording && (sessionId === undefined || props.attachRecording === undefined)}
      >
        {recording ? <StopIcon /> : <MicIcon />}
        {recording ? <span {...{ 'data-dsh-record-timer': '' }}>{fmtElapsed(elapsed)}</span> : null}
      </button>
      {note ? <span {...{ 'data-dsh-record-note': '', 'data-tone': note.tone }}>{note.text}</span> : null}
    </span>
  )
}

// ---- Assembly --------------------------------------------------------------
export function apply(ctx: any): void {
  ensureCss()
  const slots = ctx.slots
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-record: dictionaries')
  // 宿主配置（插件设置页选的格式）：只取一次，Promise 缓存；失败回退 mp3。
  const hostFormat = loadHostFormat()
  const t = ctx.locale.bind(NS)

  // ---- 设置页：设置 → 插件 → 点开 dsh-record 详情页 -------------------------
  // 座位用 `plugins.bundle.config`（keyed by 包名），它渲染在**该 bundle 自己的
  // 详情页**里（描述与行之间，view: 'page'）；而 `plugins.item` 是平铺列表，
  // 会把卡片直接堆在内置插件（如终端）下面——那是错的。
  // 与内置终端插件同款范式：configForms 建表单，whileServed 保证宿主未提供
  // 该 namespace 时页面上不留痕迹。
  ctx.inject(['configForms'], (settingsScope: any) => {
    const configForms = settingsScope.get('configForms')
    if (configForms === undefined) return
    const tSettings = ctx.locale.bind(SETTINGS_NS)
    ctx.effect(() => ctx.locale.register(SETTINGS_NS, settingsDictionaries), 'dsh-record: settings dictionaries')
    const card = createRecordCardController(configForms)
    ctx.effect(() => () => card.dispose(), 'dsh-record: settings form subscription')
    ctx.effect(() => configForms.whileServed([ENTRY_ID], () => slots.inject('plugins.bundle.config', () => slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      order: 60,
      label: () => tSettings('title'),
      locale: SETTINGS_NS,
      inject: () => card.inject(),
    }, RecordSettingsCard))), 'dsh-record: bundle settings page')
  })

  ctx.inject(['conversation'], (scope: any) => {
    const conversation = scope.get('conversation')
    if (conversation === undefined || typeof conversation.createDrafts !== 'function') {
      console.warn('[dsh-record] conversation 服务不可用，麦克风入口不会注册')
      return
    }
    const attachRecording = (
      sessionId: string,
      blob: Blob,
      fileName: string,
      addAttachments: (ids: string[]) => boolean,
    ): string | null => {
      let drafts: Array<{ id: string }> = []
      try {
        const file = new File([blob], fileName, { type: blob.type || 'audio/webm' })
        drafts = conversation.createDrafts(sessionId, [file])
        const ids = drafts.map((draft) => draft.id)
        if (!addAttachments(ids)) {
          conversation.releaseDraftAttachments(drafts)
          return t('submitting')
        }
        return null
      } catch (err: any) {
        if (drafts.length > 0) {
          try { conversation.releaseDraftAttachments(drafts) } catch { /* released */ }
        }
        return `${t('attachFailed')}: ${err?.message ?? String(err)}`
      }
    }
    slots.inject('conversation.input.right', () =>
      slots.register(
        {
          name: 'conversation.input.right',
          id: 'dsh-record',
          order: 10,
          label: () => t('mic'),
          inject: () => ({ attachRecording, getFormat: () => hostFormat, t }),
        },
        RecordButton,
      ),
    )
  })
}
