// Tests for the shared audio encoders (src/client/encoders.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav, encodeMp3 } from '../src/client/encoders.ts'

/** Build a mono sine at the given sample rate. */
function sine(rate, seconds = 1, channels = 1) {
  const data = []
  for (let ch = 0; ch < channels; ch++) {
    const samples = new Float32Array(rate * seconds)
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5
    }
    data.push(samples)
  }
  return {
    numberOfChannels: channels,
    sampleRate: rate,
    getChannelData: (ch) => data[ch],
  }
}

test('encodeWav produces a canonical 16-bit PCM header', () => {
  const buffer = sine(48000, 0.5)
  const bytes = encodeWav(buffer)
  const text = (start, len) => String.fromCharCode(...bytes.slice(start, start + len))
  assert.equal(text(0, 4), 'RIFF')
  assert.equal(text(8, 4), 'WAVE')
  assert.equal(text(12, 4), 'fmt ')
  assert.equal(text(36, 4), 'data')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint16(20, true), 1) // PCM
  assert.equal(view.getUint16(22, true), 1) // mono
  assert.equal(view.getUint32(24, true), 48000)
  assert.equal(view.getUint16(34, true), 16) // bits
  assert.equal(view.getUint32(40, true), 48000 * 0.5 * 2) // data bytes
  assert.equal(bytes.length, 44 + 48000)
})

test('encodeWav clamps out-of-range samples into Int16', () => {
  const buffer = {
    numberOfChannels: 1,
    sampleRate: 8000,
    getChannelData: () => Float32Array.of(-3, 0, 3),
  }
  const bytes = encodeWav(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getInt16(44, true), -32768)
  assert.equal(view.getInt16(46, true), 0)
  assert.equal(view.getInt16(48, true), 32767)
})

test('encodeMp3 emits an MPEG frame stream', () => {
  const buffer = sine(44100, 1)
  const bytes = encodeMp3(buffer, 128)
  assert.ok(bytes.length > 1000, `mp3 too small: ${bytes.length}`)
  const isFrameSync = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
  const isId3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
  assert.ok(isFrameSync || isId3, `no MPEG frame sync at byte 0: ${bytes[0]},${bytes[1]},${bytes[2]}`)
})

test('encodeMp3 handles stereo input', () => {
  const buffer = sine(48000, 0.5, 2)
  const bytes = encodeMp3(buffer, 128)
  assert.ok(bytes.length > 1000)
})

test('encodeMp3 matches expected CBR size within 15%', () => {
  const buffer = sine(44100, 2)
  const bytes = encodeMp3(buffer, 128)
  const expected = (128_000 / 8) * 2
  assert.ok(Math.abs(bytes.length - expected) / expected < 0.15, `size ${bytes.length} vs expected ${expected}`)
})
