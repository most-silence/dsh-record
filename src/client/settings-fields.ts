/**
 * dsh-record — settings page contracts (plain TS, no JSX).
 *
 * 与 settings.tsx 分开是为了让这些纯逻辑能在 node 里直接测试：
 * node 只能类型剥离 .ts，不能解析 .tsx。
 *
 * 字段 spec 决定设置表单接受哪些草稿：parse 返回 undefined 会阻止保存。
 */

/** 词典 namespace，与录音按钮（`dsh-record`）刻意区分。 */
export const NS = 'settings.dsh-record'

/** 插件在 profile 里的 entry id —— configForms.get 与 whileServed 都用它寻址。 */
export const ENTRY_ID = 'dsh-record'

export const FORMATS = ['mp3', 'wav', 'webm'] as const

/** 临时目录模式：跟随当前项目空间，或用户自选目录。 */
export const DIR_MODES = ['workspace', 'custom'] as const

/** 设置页词典（en）。 */
export const en: Record<string, string> = {
  title: 'Audio recording',
  description: 'Choose the recorded file format and where recordings are saved.',
  format: 'Default audio format',
  formatHint: 'The recorded file is written in this format.',
  dirMode: 'Recording directory',
  dirModeHint: 'Follow the current workspace, or choose a fixed folder.',
  dirModeWorkspace: 'Follow workspace',
  dirModeCustom: 'Custom folder',
  customDir: 'Custom folder path',
  customDirHint: 'Absolute path to the folder that stores recordings.',
  chooseDir: 'Choose folder…',
  choosingDir: 'Choosing…',
  dirPickFailed: 'Could not open the folder picker.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
}

/** 设置页词典（zh）。 */
export const zh: Record<string, string> = {
  title: '录音',
  description: '选择录音文件格式，以及录音的存放目录。',
  format: '默认语音文件格式',
  formatHint: '录音文件按该格式写入。',
  dirMode: '录音临时目录',
  dirModeHint: '跟随当前项目空间，或指定一个固定目录。',
  dirModeWorkspace: '跟随项目空间',
  dirModeCustom: '自定义目录',
  customDir: '自定义目录路径',
  customDirHint: '存放录音的文件夹绝对路径。',
  chooseDir: '选择文件夹…',
  choosingDir: '正在选择…',
  dirPickFailed: '无法打开文件夹选择器。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
}

/** 语言词典表，供 locale.register 使用。 */
export const dictionaries = { zh, en }

/**
 * 表单框架的文案，从本页词典读取。
 * @param t - 本页的 locale 读取器。
 */
export function formLabels(t: (key: string) => string) {
  return {
    unavailable: t('unavailable'),
    readOnly: t('readOnly'),
    saveFailed: t('saveFailed'),
    save: t('save'),
    saving: t('saving'),
  }
}

/** 允许的格式集合；第一个即默认值。 */
export const DEFAULT_FORMAT = 'mp3'

/** 允许的目录模式；默认跟随项目空间。 */
export const DEFAULT_DIR_MODE = 'workspace'

/**
 * 格式字段：只接受 mp3 / wav / webm（大小写不敏感）。
 *
 * 展示时：未覆盖/未取值一律回显 `mp3`——仅支持这三种格式，且 schema 默认就是
 * mp3，留一个空输入框会让用户以为「没选格式」。
 * 保存时：清空 = 清除覆盖（回落到 schema 默认 mp3）；非法值返回 undefined 阻止保存。
 */
export function settingsFormatField(field: string) {
  return {
    field,
    format: (value: unknown) => {
      if (typeof value !== 'string') return DEFAULT_FORMAT
      const trimmed = value.trim().toLowerCase()
      return (FORMATS as readonly string[]).includes(trimmed) ? trimmed : DEFAULT_FORMAT
    },
    parse: (text: string) => {
      const trimmed = String(text).trim().toLowerCase()
      if (trimmed === '') return { kind: 'clear' as const }
      if (!(FORMATS as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set' as const, value: trimmed }
    },
  }
}

/**
 * 目录模式字段：'workspace'（跟随项目空间）/ 'custom'（自选目录）。
 * 展示时缺省回显 'workspace'（schema 默认），避免出现空选择。
 */
export function settingsDirModeField(field: string) {
  return {
    field,
    format: (value: unknown) => (
      typeof value === 'string' && (DIR_MODES as readonly string[]).includes(value) ? value : 'workspace'
    ),
    parse: (text: string) => {
      const trimmed = String(text).trim()
      if (trimmed === '') return { kind: 'clear' as const }
      if (!(DIR_MODES as readonly string[]).includes(trimmed)) return undefined
      return { kind: 'set' as const, value: trimmed }
    },
  }
}

/**
 * 自定义目录字段：纯文本，空 = 清除覆盖（回退到跟随项目空间）。
 * 是否绝对路径由宿主校验，这里不越权判断。
 */
export function settingsDirField(field: string) {
  return {
    field,
    format: (value: unknown) => (typeof value === 'string' ? value : ''),
    parse: (text: string) => {
      const trimmed = String(text).trim()
      return trimmed === '' ? { kind: 'clear' as const } : { kind: 'set' as const, value: trimmed }
    },
  }
}
