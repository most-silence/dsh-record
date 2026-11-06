// Tests for the plugin settings page contracts (src/client/settings-fields.ts).
// The specs decide which drafts the settings form accepts; a wrong spec either
// silently writes an invalid format or blocks a valid one.
// Imported from the plain .ts module: node strips types in .ts but cannot
// parse the JSX in settings.tsx.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  settingsFormatField,
  settingsDirField,
  formLabels,
  dictionaries,
  FORMATS,
  ENTRY_ID,
  NS,
} from '../src/client/settings-fields.ts'

test('format field accepts mp3/wav/webm and normalizes case', () => {
  const spec = settingsFormatField('format')
  for (const value of FORMATS) {
    assert.deepEqual(spec.parse(value), { kind: 'set', value })
  }
  assert.deepEqual(spec.parse('MP3'), { kind: 'set', value: 'mp3' })
  assert.deepEqual(spec.parse(' Wav '), { kind: 'set', value: 'wav' })
})

test('format field clears on blank and rejects anything else', () => {
  const spec = settingsFormatField('format')
  assert.deepEqual(spec.parse(''), { kind: 'clear' })
  assert.deepEqual(spec.parse('   '), { kind: 'clear' })
  // Invalid drafts return undefined, which blocks the form's save.
  assert.equal(spec.parse('flac'), undefined)
  assert.equal(spec.parse('mp4'), undefined)
  assert.equal(spec.parse('123'), undefined)
})

test('format field formats missing values as the default (mp3), not blank', () => {
  const spec = settingsFormatField('format')
  assert.equal(spec.format('mp3'), 'mp3')
  // 仅支持三种格式，输入框永远显示一个有效选择——undefined/null/非字符串
  // 一律回显 schema 默认 mp3，而不是留空。
  assert.equal(spec.format(undefined), 'mp3')
  assert.equal(spec.format(null), 'mp3')
  assert.equal(spec.format(42), 'mp3')
  assert.equal(spec.format('bogus'), 'mp3')
})

test('dir field trims, accepts absolute paths, and clears on blank', () => {
  const spec = settingsDirField('tempDir')
  assert.deepEqual(spec.parse('  E:\\Recordings  '), { kind: 'set', value: 'E:\\Recordings' })
  assert.deepEqual(spec.parse('/home/me/rec'), { kind: 'set', value: '/home/me/rec' })
  assert.deepEqual(spec.parse(''), { kind: 'clear' })
  // The dir field does not decide absolute-vs-relative; the host validates.
  assert.deepEqual(spec.parse('relative/dir'), { kind: 'set', value: 'relative/dir' })
})

test('formLabels derives every frame label from the namespace dictionary', () => {
  const t = (key) => dictionaries.zh[key] ?? key
  const labels = formLabels(t)
  for (const key of ['unavailable', 'readOnly', 'saveFailed', 'save', 'saving']) {
    assert.equal(typeof labels[key], 'string')
    assert.notEqual(labels[key], key, `missing zh copy for ${key}`)
  }
})

test('settings namespace and entry id stay distinct from the mic locale namespace', () => {
  assert.equal(ENTRY_ID, 'dsh-record')
  assert.equal(NS, 'settings.dsh-record')
  assert.notEqual(NS, ENTRY_ID)
})

test('both dictionaries cover the same keys (no untranslated field)', () => {
  const en = Object.keys(dictionaries.en).sort()
  const zh = Object.keys(dictionaries.zh).sort()
  assert.deepEqual(zh, en)
  for (const key of en) {
    assert.equal(typeof dictionaries.en[key], 'string')
    assert.equal(typeof dictionaries.zh[key], 'string')
    assert.notEqual(dictionaries.en[key], '', `empty en copy for ${key}`)
    assert.notEqual(dictionaries.zh[key], '', `empty zh copy for ${key}`)
  }
})
