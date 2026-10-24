/**
 * Turns captured float samples into a .wav file.
 *
 * WAV rather than the browser's own MediaRecorder output: that gives WebM or
 * Opus depending on the browser, and a tool further down the chain may or may
 * not accept it. A 16-bit PCM wav is understood by everything, and writing
 * the header costs forty lines.
 */

export interface RecordedAudio {
  blob: Blob
  seconds: number
  bytes: number
}

const flatten = (chunks: Float32Array[], total: number): Float32Array => {
  const out = new Float32Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export function encodeWav(left: Float32Array[], right: Float32Array[], sampleRate: number): RecordedAudio {
  const frames = left.reduce((n, c) => n + c.length, 0)
  const l = flatten(left, frames)
  const r = flatten(right, frames)

  const blockAlign = 4 // stereo × 16-bit
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM header length
  view.setUint16(20, 1, true) // uncompressed
  view.setUint16(22, 2, true) // channels
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)

  let at = 44
  for (let i = 0; i < frames; i++) {
    // Clamp before scaling: a patch can easily run hotter than full scale,
    // and wrapping round would turn a loud passage into noise.
    const a = Math.max(-1, Math.min(1, l[i]))
    const b = Math.max(-1, Math.min(1, r[i]))
    view.setInt16(at, a < 0 ? a * 0x8000 : a * 0x7fff, true)
    view.setInt16(at + 2, b < 0 ? b * 0x8000 : b * 0x7fff, true)
    at += 4
  }

  return { blob: new Blob([buffer], { type: 'audio/wav' }), seconds: frames / sampleRate, bytes: buffer.byteLength }
}

/** Offers the recording as a download with a timestamped name. */
export function downloadRecording(audio: RecordedAudio, name = 'patcher') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const url = URL.createObjectURL(audio.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}-${stamp}.wav`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
