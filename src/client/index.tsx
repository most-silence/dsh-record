/**
 * dsh-record — browser half (v0.3.0: three-format recording).
 *
 * 输入框右侧（`conversation.input.right` 座位）的麦克风按钮 + 格式选择器：
 *   - 支持 mp3（默认，浏览器端 lamejs 转码）、wav（16-bit PCM 无损）、
 *     webm（浏览器原生 Opus，不转码）。
 *   - 格式选择持久化到 localStorage（key: `dsh-record.format`），刷新后保持。
 *   - 录音中显示计时；文件名按「结尾时间 + 时长」实时预览，
 *     例如 `rec-20261104-214711-4s.mp3`。
 *   - 停止后：webm 直接附加；mp3/wav 先解码再转码，然后走宿主附件通道。
 *   - 转码失败时自动回退附加原始 webm，不让录音丢失。
 *   - Esc / ✕ / 切走标签页 = 丢弃录音。
 *
 * **安全设计**：宿主半保持空壳（无 Config schema、无路由），格式配置完全
 * 在浏览器端用 localStorage 管理。这彻底规避了 schemastery API 不匹配
 * 导致 profile 启动失败的风险（2026-11-04 事故根因）。
 *
 * @module dsh-record/client
 */
import { encodeMp3, encodeWav, EXT_BY_FORMAT, type AudioData, type RecordFormat } from './encoders'

const React = require('react') as any
const { useState, useEffect, useRef, useCallback } = React

export const name = 'dsh-record'
export const inject = ['slots']

// ---- 格式配置（localStorage 持久化） ----------------------------------------
const STORAGE_KEY = 'dsh-record.format'
const VALID_FORMATS: RecordFormat[] = ['mp3', 'wav', 'webm']

function loadFormat(): RecordFormat {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw && VALID_FORMATS.includes(raw as RecordFormat)) return raw as RecordFormat
  } catch { /* localStorage 不可用 */ }
  return 'mp3'
}

function saveFormat(fmt: RecordFormat): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, fmt)
  } catch { /* 忽略 */ }
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

// ---- 原生编码选择 ----------------------------------------------------------
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
[data-dsh-record-seat]{position:relative;display:inline-flex;align-items:center;gap:4px;}
[data-dsh-record-select]{height:26px;padding:0 4px;border:1px solid var(--dsw-alias-border-l1,#444);
  border-radius:6px;background:var(--dsw-alias-bg-overlay,#2a2a2a);color:var(--dsw-alias-label-primary,#eee);
  font:inherit;font-size:12px;cursor:pointer;outline:none;}
[data-dsh-record-select]:focus{border-color:var(--dsw-alias-state-info-primary,#52a9ff);}
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
}

function RecordButton(props: SessionProps) {
  const { sessionId } = props
  const [phase, setPhase] = useState('idle' as Phase)
  const [elapsed, setElapsed] = useState(0)
  const [note, setNote] = useState(null as { text: string; tone: 'err' | 'ok' } | null)
  const [liveName, setLiveName] = useState('')
  const [format, setFormat] = useState(loadFormat)

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

  const onFormatChange = useCallback((e: any) => {
    const val = e.target.value as RecordFormat
    if (VALID_FORMATS.includes(val)) {
      setFormat(val)
      saveFormat(val)
    }
  }, [])

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
      showNote('当前环境不支持录音（无 getUserMedia / MediaRecorder）', 'err')
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
      showNote(denied ? '麦克风权限被拒绝' : '无法打开麦克风', 'err')
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
        showNote(`录音器创建失败：${err?.message ?? String(err)}`, 'err')
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
          showNote('录音太短，已丢弃', 'err')
          finish()
          return
        }
        if (sessionId === undefined || props.attachRecording === undefined || props.inputActions === undefined) {
          showNote('当前页面没有可用会话，无法附加录音', 'err')
          finish()
          return
        }
        // Transcode if needed
        const currentFormat = loadFormat() // re-read in case user changed mid-recording
        let targetBlob = rawBlob
        let targetExt = extOf(type)
        let transcoded = false
        if (currentFormat !== 'webm') {
          try {
            targetBlob = await transcode(rawBlob, currentFormat)
            targetExt = currentFormat
            transcoded = true
          } catch (err: any) {
            // Fallback to raw webm
            targetExt = 'webm'
            showNote(`${currentFormat} 转码失败（${err?.message ?? String(err)}），已附加原始 webm`, 'err')
          }
        }
        const name = buildFileName(new Date(), durationMs, targetExt)
        const err = props.attachRecording(
          sessionId,
          targetBlob,
          name,
          (ids) => props.inputActions!.addAttachments(ids),
        )
        const msg = err === null
          ? `已附加 ${name}${transcoded ? '' : ' (原始webm)'}`
          : err
        showNote(msg, err === null ? 'ok' : 'err')
      }
      finish()
    }
    recorder.onerror = () => {
      showNote('录音设备出错', 'err')
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
        showNote(`录音启动失败：${err?.message ?? String(err)}`, 'err')
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
  }, [phase, sessionId, props.attachRecording, props.inputActions, releaseMic, showNote])

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
        showNote('已取消录音', 'err')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, abort, showNote])

  // Tab hidden cancels recording
  useEffect(() => {
    if (phase !== 'recording') return
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        abort()
        showNote('页面离开，已取消录音', 'err')
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [phase, abort, showNote])

  const recording = phase === 'recording' || phase === 'stopping'

  return (
    <span {...{ 'data-dsh-record-seat': '' }}>
      {/* Format selector — disabled during recording */}
      <select
        {...{ 'data-dsh-record-select': '', 'aria-label': '录音格式' }}
        value={format}
        onChange={onFormatChange}
        disabled={recording}
      >
        <option value="mp3">MP3</option>
        <option value="wav">WAV</option>
        <option value="webm">WebM</option>
      </select>

      {recording ? (
        <button
          type="button"
          {...{ 'data-dsh-record-stop': '', 'aria-label': '取消录音', title: '取消录音（丢弃，不附加）' }}
          onClick={abort}
        >
          ✕
        </button>
      ) : null}
      <button
        type="button"
        {...{ 'data-dsh-record-mic': '', 'data-recording': recording ? '1' : '0', 'aria-label': '录音',
          title: recording
            ? (liveName ? `停止并处理为 ${liveName}（Esc 取消）` : '停止录音并处理（Esc 取消）')
            : 'Record / 录音'
        }}
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
          return '正在提交，稍后再试（录音未附加）'
        }
        return null
      } catch (err: any) {
        if (drafts.length > 0) {
          try { conversation.releaseDraftAttachments(drafts) } catch { /* released */ }
        }
        return `附加失败：${err?.message ?? String(err)}`
      }
    }
    slots.inject('conversation.input.right', () =>
      slots.register(
        {
          name: 'conversation.input.right',
          id: 'dsh-record',
          order: 10,
          label: 'dsh-record 录音',
          inject: () => ({ attachRecording }),
        },
        RecordButton,
      ),
    )
  })
}
