/**
 * dsh-record — plugin settings page (browser half).
 *
 * 在「设置 → 插件」页为 dsh-record 注册一张卡片，提供两个入口：
 *   - 默认语音文件格式（mp3 / wav / webm）
 *   - 录音临时目录（留空 = 不落盘，只作为会话附件）
 *
 * 完全照抄内置「终端」插件（dsh-client-ui-settings-shell）的范式：
 *   ctx.configForms.get(entryId) → configForm scope
 *   new SettingsFormModel(scope, specs) → 暂存式表单模型
 *   SettingsForm + SettingsValueField（来自 dsh-client-ui-primitives）→ 渲染
 *   注册进根作用域 `plugins.bundle.config` slot（keyed by 包名），它渲染在
 *   **该 bundle 自己的详情页**里；且只在宿主 served 了该 namespace 时才挂载
 *   （ctx.configForms.whileServed）。
 *
 * 纯逻辑（字段 spec / 词典 / formLabels）在 settings-fields.ts，便于 node 测试；
 * 本文件只放 React 组件与控制器。
 */
import {
  SettingsForm,
  SettingsValueField,
  SettingsFormModel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  formLabels,
  settingsDirField,
  settingsDirModeField,
  settingsFormatField,
  DEFAULT_DIR_MODE,
  DEFAULT_FORMAT,
  DIR_MODES,
  FORMATS,
  ENTRY_ID,
} from './settings-fields'

// 重新导出，让入口只需 import 一处。
export {
  NS,
  ENTRY_ID,
  FORMATS,
  DIR_MODES,
  DEFAULT_FORMAT,
  DEFAULT_DIR_MODE,
  dictionaries,
  formLabels,
  settingsFormatField,
  settingsDirModeField,
  settingsDirField,
} from './settings-fields'

const React = require('react') as any

/** 通用下拉：标签行（含覆盖徽标与重置）+ 原生 select + 提示。 */
function LabeledSelect(props: any) {
  const { t, id, value, options, disabled, overridden, onEdit, onReset,
    overriddenLabel, resetLabel, label, hint, uppercase } = props
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement(
        'label',
        {
          htmlFor: id,
          style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', flex: 1 },
        },
        label,
      ),
      overridden
        ? React.createElement(
            'button',
            {
              type: 'button',
              disabled,
              onClick: onReset,
              title: resetLabel,
              style: {
                font: 'inherit', fontSize: 12, background: 'transparent',
                border: 'none', color: 'var(--dsw-alias-label-tertiary)',
                cursor: disabled ? 'default' : 'pointer', padding: 0,
              },
            },
            resetLabel,
          )
        : null,
      overridden
        ? React.createElement(
            'span',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
            overriddenLabel,
          )
        : null,
    ),
    React.createElement(
      'select',
      {
        id,
        value,
        disabled,
        onChange: (event: any) => onEdit(event.target.value),
        style: {
          font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 6,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-primary)',
          cursor: disabled ? 'default' : 'pointer',
        },
      },
      ...(options as string[]).map((option) => React.createElement(
        'option',
        { key: option, value: option },
        uppercase ? option.toUpperCase() : (t(`${option}Label`) || option),
      )),
    ),
    React.createElement(
      'p',
      { style: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
      hint,
    ),
  )
}

/** 路径行：文本输入 + 覆盖徽标/重置。dirMode=custom 时可用。 */
function DirPathRow(props: any) {
  const { t, value, disabled, overridden, onEdit, onReset,
    overriddenLabel, resetLabel, label, hint } = props
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      React.createElement(
        'label',
        {
          htmlFor: 'dsh-record-custom-dir',
          style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)', flex: 1 },
        },
        label,
      ),
      overridden
        ? React.createElement(
            'button',
            {
              type: 'button', disabled, onClick: onReset, title: resetLabel,
              style: {
                font: 'inherit', fontSize: 12, background: 'transparent',
                border: 'none', color: 'var(--dsw-alias-label-tertiary)',
                cursor: disabled ? 'default' : 'pointer', padding: 0,
              },
            },
            resetLabel,
          )
        : null,
      overridden
        ? React.createElement(
            'span',
            { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } },
            overriddenLabel,
          )
        : null,
    ),
    React.createElement('input', {
      id: 'dsh-record-custom-dir',
      type: 'text',
      value,
      disabled,
      placeholder: hint,
      onChange: (event: any) => onEdit(event.target.value),
      style: {
        font: 'inherit', fontSize: 13, padding: '5px 8px', borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
      },
    }),
  )
}

/**
 * 卡片：格式下拉 + 目录模式 + 自定义路径，保存/丢弃。
 *
 * 「点击选择文件夹」需要宿主 directoryPicker 的 remote 能力，本版本不接
 * （下一版加入）；路径先以文本输入，模式选 workspace 时该行禁用。
 */
export function RecordSettingsCard(props: any) {
  const { t } = props
  const state = props.useForm((snapshot: any) => snapshot)
  const disabled = !state.writable
  const formatField = state.formatField ?? {}
  const dirModeField = state.dirModeField ?? {}
  const customDirField = state.customDirField ?? {}
  const dirMode = dirModeField.text ?? DEFAULT_DIR_MODE
  return React.createElement(
    SettingsForm,
    { labels: formLabels(t), state, onSave: props.save, onDiscard: props.discard },
    React.createElement(LabeledSelect, {
      t,
      id: 'dsh-record-format',
      options: FORMATS,
      value: formatField.text ?? DEFAULT_FORMAT,
      overridden: formatField.overridden,
      disabled,
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      label: t('format'),
      hint: t('formatHint'),
      uppercase: true,
      onEdit: (value: string) => props.edit('format', value),
      onReset: () => props.resetField('format'),
    }),
    React.createElement(LabeledSelect, {
      t,
      id: 'dsh-record-dir-mode',
      options: DIR_MODES,
      value: dirMode,
      overridden: dirModeField.overridden,
      disabled,
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      label: t('dirMode'),
      hint: t('dirModeHint'),
      uppercase: false,
      onEdit: (value: string) => props.edit('dirMode', value),
      onReset: () => props.resetField('dirMode'),
    }),
    React.createElement(DirPathRow, {
      t,
      value: customDirField.text ?? '',
      overridden: customDirField.overridden,
      disabled: disabled || dirMode !== 'custom',
      overriddenLabel: t('overridden'),
      resetLabel: t('reset'),
      label: t('customDir'),
      hint: t('customDirHint'),
      onEdit: (text: string) => props.edit('customDir', text),
      onReset: () => props.resetField('customDir'),
      onPick: undefined,
    }),
  )
}

/**
 * 把 configForm scope 桥接成 SettingsFormModel，产出 slot 注入面。
 * 与终端插件的 ShellCardController 同构。
 *
 * 注入面 = { hooks: { form }, edit/resetField/save/discard, pickDirectory }：
 * 卡片用 useForm 读整体状态与各字段，用动作改动草稿；pickDirectory 打开
 * 宿主文件夹选择器。
 */
export function createRecordCardController(configForms: any, directoryPicker?: any) {
  const scope = configForms.get(ENTRY_ID)
  const form = new SettingsFormModel(scope, [
    settingsFormatField('format'),
    settingsDirModeField('dirMode'),
    settingsDirField('customDir'),
  ])
  const store = form.bind(() => ({
    ...form.shell(),
    formatField: form.field('format'),
    dirModeField: form.field('dirMode'),
    customDirField: form.field('customDir'),
  }))
  return {
    inject() {
      return {
        hooks: { form: store },
        ...form.actions(),
        pickDirectory: async (): Promise<string | null> => {
          if (directoryPicker === undefined) return null
          try {
            const result = await directoryPicker.pick()
            if (result === null || result === undefined) return null
            if (typeof result === 'string') return result
            if (result.ok === true) return typeof result.value === 'string' ? result.value : null
            return null
          } catch {
            return null
          }
        },
      }
    },
    dispose() {
      form.dispose()
    },
  }
}
