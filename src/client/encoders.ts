/**
 * dsh-record — audio encoders shared by the browser half and node tests.
 *
 * 浏览器只能原生录 webm/opus；mp3/wav 由这里从解码后的 PCM 转码：
 *   - `encodeWav`：16-bit PCM WAV 封装（无损中间格式，无依赖）；
 *   - `encodeMp3`：lamejs 编码（@breezystack/lamejs，分块 1152 采样）。
 *
 * 输入统一为最小 `AudioData` 形状（AudioBuffer 的结构子集），node 测试
 * 可以喂桩对象，不依赖 DOM。
 */

/** Minimal structural subset of AudioBuffer (DOM-free). */
export interface AudioData {
  readonly numberOfChannels: number
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

const WAV_HEADER_BYTES = 44
const MP3_CHUNK_FRAMES = 1152

function clamp16(sample: number): number {
  const s = sample < -1 ? -1 : sample > 1 ? 1 : sample
  return Math.round(s < 0 ? s * 0x8000 : s * 0x7fff)
}

function interleave16(channels: readonly Float32Array[]): Int16Array {
  const frames = channels[0].length
  const count = channels.length
  const out = new Int16Array(frames * count)
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < count; ch++) {
      out[i * count + ch] = clamp16(channels[ch][i])
    }
  }
  return out
}

/** Mixdown is never applied: channels pass through 1:1 (mono stays mono). */
export function encodeWav(buffer: AudioData): Uint8Array {
  const count = Math.min(2, buffer.numberOfChannels)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < count; ch++) channels.push(buffer.getChannelData(ch))
  const sampleRate = buffer.sampleRate
  const pcm = interleave16(channels)
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(out.buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, count, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * count * 2, true)
  view.setUint16(32, count * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true)
  return out
}

/** MP3 (CBR, default 128 kbps) via lamejs; imported lazily by the caller? No —
 * static import: the client bundle must stay single-file (no dynamic import). */
import lamejs from '@breezystack/lamejs'

export function encodeMp3(buffer: AudioData, kbps = 128): Uint8Array {
  const count = Math.min(2, buffer.numberOfChannels)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < count; ch++) channels.push(buffer.getChannelData(ch))
  const sampleRate = buffer.sampleRate
  const encoder = new lamejs.Mp3Encoder(count, sampleRate, kbps)
  // Per-channel Int16 arrays (Mp3Encoder wants one array per channel).
  const perChannel: Int16Array[] = channels.map((data) => {
    const out = new Int16Array(data.length)
    for (let i = 0; i < data.length; i++) out[i] = clamp16(data[i])
    return out
  })
  const parts: Uint8Array[] = []
  const frameSamples = MP3_CHUNK_FRAMES
  for (let offset = 0; offset < perChannel[0].length; offset += frameSamples) {
    const left = perChannel[0].subarray(offset, offset + frameSamples)
    const right = count === 2 ? perChannel[1].subarray(offset, offset + frameSamples) : undefined
    const chunk = right
      ? encoder.encodeBuffer(left, right)
      : encoder.encodeBuffer(left)
    if (chunk.length > 0) parts.push(new Uint8Array(chunk))
  }
  const tail = encoder.flush()
  if (tail.length > 0) parts.push(new Uint8Array(tail))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let cursor = 0
  for (const part of parts) {
    out.set(part, cursor)
    cursor += part.length
  }
  return out
}

export const EXT_BY_FORMAT = { mp3: 'mp3', wav: 'wav', webm: 'webm' } as const
export type RecordFormat = keyof typeof EXT_BY_FORMAT
