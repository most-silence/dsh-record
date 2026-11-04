/**
 * dsh-record — browser half.
 *
 * 输入框右侧（`conversation.input.right` 座位）的麦克风按钮：
 *   - 点击开始实时录音（MediaRecorder，webm/opus 优先，按浏览器能力回退）。
 *   - 录音中显示计时；文件名按「结尾时间 + 时长」实时预览，
 *     例如 `rec-20261104-214711-4s.mp3`。
 *   - 再次点击（停止）后按宿主 Config 依次执行：
 *       1) 转码：mp3（lamejs，默认）/ wav（无损）/ webm（原生 Opus 不转码）；
 *       2) 附加：File 走宿主会话附件通道（createDrafts + addAttachments），
 *          显示为草稿文件卡随 Prompt 发送；
 *       3) 落盘：POST /dsh-record/save 写到项目空间 recordings/ 或自定义目录
 *          （saveMode=off 时不落盘）。
 *   - Esc / ✕ / 切走标签页 = 丢弃录音，不附加也不落盘。
 *
 * 依赖的宿主契约（0.2.1-rc.2，均从打包出的模块表/会话 standard props 读取）：
 *   - slot `conversation.input.right`：list / session，由 ui-conversation 声明；
 *   - session scope props：`sessionId`（ui-session）、`inputActions`
 *     （ui-conversation 经 uiSession.provide 注入）；
 *   - root services `conversation`（createDrafts / releaseDraftAttachments）、
 *     `sessions`（list.getSnapshot().byId[id].cwd — 项目空间根目录）；
 *   - 本插件宿主半路由：`GET /dsh-record/config`、`POST /dsh-record/save`。
 *
 * @module dsh-record/client
 */
import { encodeMp3, encodeWav, EXT_BY_FORMAT, type AudioData, type RecordFormat } from './encoders'

const React = require('react') as any
const { useState, useEffect, useRef, useCallback } = React

export const name = 'dsh-record'
export const inject = ['slots']

// ---- 文件名：结尾时间 + 时长 ------------------------------------------------
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `rec-YYYYMMDD-HHMMSS-<n>s.<ext>` — 结尾时间为停止那一刻的本地时间。 */
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

// ---- 原生编码选择（MediaRecorder 侧永远是 webm/opus 等，转码由 encoders 做） --
const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

/** 优先 webm/opus（Chromium/Edge 全支持），依次回退。 */
function pickMime(): string {
  const MR: any = (globalThis as any).MediaRecorder
  if (typeof MR !== 'function' || typeof MR.isTypeSupported !== 'function') return ''
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']
  for (const c of cands) {
    try {
      if (MR.isTypeSupported(c)) return c
    } catch {
      /* 忽略：继续下一候选 */
    }
  }
  return ''
}

function extOf(mime: string): string {
  for (const key of Object.keys(EXT_BY_MIME)) {
    if (mime.startsWith(key)) return EXT_BY_MIME[key]
  }
  return 'webm'
}

// ---- 宿主配置与落盘 ----------------------------------------------------------
interface HostConfig {
  format: RecordFormat
  saveMode: 'workspace' | 'custom' | 'off'
  saveDir: string
}

const DEFAULT_HOST_CONFIG: HostConfig = { format: 'mp3', saveMode: 'off', saveDir: '' }

/** 读宿主 Config；宿主半缺失/超时时退回默认（mp3、不落盘）。 */
export async function loadHostConfig(timeoutMs = 3000): Promise<HostConfig> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch('/dsh-record/config', { signal: ctrl.signal })
    clearTimeout(timer)
    const data: any = await res.json()
    if (data && data.ok && EXT_BY_FORMAT[data.format as RecordFormat]) {
      return {
        format: data.format as RecordFormat,
        saveMode: data.saveMode === 'custom' || data.saveMode === 'workspace' ? data.saveMode : 'off',
        saveDir: typeof data.saveDir === 'string' ? data.saveDir : '',
      }
    }
  } catch {
    /* 宿主路由不可达：用默认 */
  }
  return DEFAULT_HOST_CONFIG
}

/** 解码任意浏览器音频 blob 为 PCM（AudioBuffer 的结构子集）。 */
async function decodeAudio(blob: Blob): Promise<AudioData> {
  const OAC: any = (globalThis as any).OfflineAudioContext
  if (typeof OAC !== 'function') throw new Error('OfflineAudioContext unavailable')
  const bytes = await blob.arrayBuffer()
  const ctx = new OAC(1, 1, 44100)
  return await ctx.decodeAudioData(bytes)
}

/** webm 原始录音 → 目标格式 blob。 */
async function transcode(blob: Blob, format: RecordFormat): Promise<Blob> {
  if (format === 'webm') return blob
  const audio = await decodeAudio(blob)
  const bytes = format === 'mp3' ? encodeMp3(audio) : encodeWav(audio)
  return new Blob([bytes as any], { type: format === 'mp3' ? 'audio/mpeg' : 'audio/wav' })
}

/** 落盘请求；成功 resolve null，失败 resolve 错误一句话。 */
async function postSave(blob: Blob, fileName: string, dir: string): Promise<string | null> {
  try {
    const res = await fetch('/dsh-record/save', {
      method: 'POST',
      headers: {
        'content-type': blob.type || 'application/octet-stream',
        'x-dsh-record-name': fileName,
        'x-dsh-record-dir': dir,
      },
      body: blob,
    })
    const data: any = await res.json().catch(() => ({}))
    if (res.ok && data.ok) return null
    return data.error || `HTTP ${res.status}`
  } catch (err: any) {
    return err && err.message ? err.message : String(err)
  }
}

function joinRecordingsDir(cwd: string): string {
  return `${cwd.replace(/[/\\]+$/u, '')}/recordings`
}

// ---- 录音状态机（组件内） ----------------------------------------------------
type Phase = 'idle' | 'recording' | 'stopping'

export interface FinalizeResult {
  ok: boolean
  text: string
}

interface SessionProps {
  /** session 座位标准 props（ui-conversation 经 uiSession.provide 注入）。 */
  sessionId?: string
  /** 会话输入框动作面；`addAttachments` 在提交/裁定中返回 false。 */
  inputActions?: {
    addAttachments(ids: string[]): boolean
  }
  /**
   * 由 register({inject}) 注入的终处理：转码 → 附加 → 落盘。
   * `ok` 表示附件已挂进输入框（落盘失败会拼进 text）。
   */
  finalizeRecording?: (
    sessionId: string,
    rawBlob: Blob,
    durationMs: number,
    addAttachments: (ids: string[]) => boolean,
  ) => Promise<FinalizeResult>
}

/** 最小内联样式：一次注入，颜色全部走 dsw 主题变量并带回退。 */
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

function RecordButton(props: SessionProps) {
  const { sessionId } = props
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [note, setNote] = useState<{ text: string; tone: 'err' | 'ok' } | null>(null)
  const [liveName, setLiveName] = useState('')

  const streamRef = useRef<any>(null)
  const recorderRef = useRef<any>(null)
  const chunksRef = useRef<Blob[]>([])
  const startRef = useRef(0)
  const mimeRef = useRef('')
  const cancelRef = useRef(false)
  const timerRef = useRef<any>(null)
  const noteTimerRef = useRef<any>(null)
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
        try { track.stop() } catch { /* 已停止 */ }
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
    // await 期间组件被卸载/座位消失：立刻归还麦克风，不开新录音。
    if (disposedRef.current) {
      for (const track of stream.getTracks()) {
        try { track.stop() } catch { /* 已停止 */ }
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
        showNote(`录音器创建失败：${err && err.message ? err.message : String(err)}`, 'err')
        return
      }
    }
    chunksRef.current = []
    recorder.ondataavailable = (e: any) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
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
      const blob = new Blob(chunks, { type })
      if (!attachedRef.current) {
        attachedRef.current = true
        if (blob.size === 0 || durationMs < 500) {
          showNote('录音太短，已丢弃', 'err')
          finish()
          return
        }
        if (sessionId === undefined || props.finalizeRecording === undefined || props.inputActions === undefined) {
          showNote('当前页面没有可用会话，无法处理录音', 'err')
          finish()
          return
        }
        setPhase('stopping')
        props
          .finalizeRecording(sessionId, blob, durationMs, (ids) => props.inputActions!.addAttachments(ids))
          .then((result) => {
            showNote(result.text, result.ok ? 'ok' : 'err')
            finish()
          })
          .catch((err: any) => {
            showNote(`处理失败：${err && err.message ? err.message : String(err)}`, 'err')
            finish()
          })
        return
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
        showNote(`录音启动失败：${err && err.message ? err.message : String(err)}`, 'err')
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
  }, [phase, sessionId, props.finalizeRecording, props.inputActions, releaseMic, showNote])

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

  // Escape 取消当前录音（官方 voice-input 的同款纪律）。
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

  // 页面切到后台时取消录音，避免幽灵采集。
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
  const seatTitle = recording
    ? liveName ? `停止并处理为 ${liveName}（Esc 取消）` : '停止录音并处理（Esc 取消）'
    : '录音并附加到当前输入框'

  return (
    <span {...{ 'data-dsh-record-seat': '' }}>
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
        {...{ 'data-dsh-record-mic': '', 'data-recording': recording ? '1' : '0', 'aria-label': '录音', title: seatTitle }}
        onClick={recording ? stop : start}
        disabled={!recording && (sessionId === undefined || props.finalizeRecording === undefined)}
      >
        {recording ? <StopIcon /> : <MicIcon />}
        {recording ? <span {...{ 'data-dsh-record-timer': '' }}>{fmtElapsed(elapsed)}</span> : null}
      </button>
      {note ? <span {...{ 'data-dsh-record-note': '', 'data-tone': note.tone }}>{note.text}</span> : null}
    </span>
  )
}

// ---- 装配 --------------------------------------------------------------------
export function apply(ctx: any): void {
  ensureCss()
  const slots = ctx.slots
  // 宿主配置只取一次；失败走默认（mp3、不落盘）。
  const hostConfig = loadHostConfig()
  // 等 conversation/sessions 就绪后再注册座位，避免加载顺序竞态
  // （与 dsh-talk 同款范式：ctx.inject([...], scope => ...)）。
  ctx.inject(['conversation', 'sessions'], (scope: any) => {
    const conversation = scope.get('conversation')
    const sessions = scope.get('sessions')
    if (conversation === undefined || typeof conversation.createDrafts !== 'function') {
      console.warn('[dsh-record] conversation 服务不可用，麦克风入口不会注册')
      return
    }
    const sessionCwd = (sessionId: string): string | undefined => {
      try {
        return sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.cwd
      } catch {
        return undefined
      }
    }
    /**
     * 终处理：转码 → 附加 → 落盘。
     *
     * 附加复刻宿主 InputBar 的 addFiles 流程（ui-conversation 20007-20010）：
     * `createDrafts` 登记并立即启动上传；`addAttachments` 被拒（正在提交/
     * 裁定）时释放附件。落盘目录：workspace = 会话 cwd + /recordings；
     * custom = Config.saveDir。转码失败时附加原始 webm，不让录音丢失。
     */
    const finalizeRecording = async (
      sessionId: string,
      rawBlob: Blob,
      durationMs: number,
      addAttachments: (ids: string[]) => boolean,
    ): Promise<FinalizeResult> => {
      const cfg = await hostConfig
      let target = { blob: rawBlob, ext: 'webm' as string, transcoded: true as boolean }
      if (cfg.format !== 'webm') {
        try {
          target = { blob: await transcode(rawBlob, cfg.format), ext: cfg.format, transcoded: true }
        } catch (err: any) {
          const detail = err && err.message ? err.message : String(err)
          target = { blob: rawBlob, ext: 'webm', transcoded: false }
          const attached = attachOnly(sessionId, target, durationMs, addAttachments)
          return {
            ok: attached.ok,
            text: `${attached.text} · ${cfg.format} 转码失败（${detail}），已附加原始 webm`,
          }
        }
      }
      const attached = attachOnly(sessionId, target, durationMs, addAttachments)
      if (!attached.ok) return attached
      // 落盘（可配置关闭）
      if (cfg.saveMode === 'off') return attached
      const dir = cfg.saveMode === 'workspace'
        ? (() => { const cwd = sessionCwd(sessionId); return cwd ? joinRecordingsDir(cwd) : undefined })()
        : cfg.saveDir
      if (!dir) {
        return { ok: true, text: `${attached.text} · 无法解析保存目录，未落盘` }
      }
      const saveErr = await postSave(target.blob, attached.name!, dir)
      if (saveErr) return { ok: true, text: `${attached.text} · 落盘失败：${saveErr}` }
      return { ok: true, text: `${attached.text} · 已保存到 ${dir}` }
    }
    const attachOnly = (
      sessionId: string,
      target: { blob: Blob; ext: string },
      durationMs: number,
      addAttachments: (ids: string[]) => boolean,
    ): FinalizeResult & { name?: string } => {
      const name = buildFileName(new Date(), durationMs, target.ext)
      let drafts: Array<{ id: string }> = []
      try {
        const file = new File([target.blob as any], name, {
          type: target.blob.type || (target.ext === 'mp3' ? 'audio/mpeg' : 'audio/webm'),
        })
        drafts = conversation.createDrafts(sessionId, [file])
        const ids = drafts.map((draft) => draft.id)
        if (!addAttachments(ids)) {
          conversation.releaseDraftAttachments(drafts)
          return { ok: false, text: '正在提交，稍后再试（录音未附加）' }
        }
        return { ok: true, text: `已附加 ${name}`, name }
      } catch (err: any) {
        if (drafts.length > 0) {
          try { conversation.releaseDraftAttachments(drafts) } catch { /* 已释放 */ }
        }
        return { ok: false, text: `附加失败：${err && err.message ? err.message : String(err)}` }
      }
    }
    slots.inject('conversation.input.right', () =>
      slots.register(
        {
          name: 'conversation.input.right',
          id: 'dsh-record',
          order: 10,
          label: 'dsh-record 录音',
          inject: () => ({ finalizeRecording }),
        },
        RecordButton,
      ),
    )
  })
}
