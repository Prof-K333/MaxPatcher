import * as Tone from 'tone'

export const AUDIO_ACCEPT = '.wav,.mp3,.flac,.aif,.aiff,.m4a,.mp4,.ogg,.webm,audio/*'

/**
 * Decodes a dropped or picked file into an AudioBuffer.
 *
 * Which container formats actually decode is up to the browser, so a failure
 * here is a normal outcome (a .flac in Safari, say) rather than a bug — the
 * caller surfaces the message instead of leaving a silent node.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer()
  const ctx = Tone.getContext().rawContext as unknown as AudioContext
  try {
    return await ctx.decodeAudioData(bytes)
  } catch {
    throw new Error(`Could not decode "${file.name}" — this browser may not support that format.`)
  }
}

/** Peak pairs per pixel column, for waveform drawing. */
export function computePeaks(buffer: AudioBuffer, columns: number): Array<[number, number]> {
  const data = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(data.length / columns))
  const peaks: Array<[number, number]> = []
  for (let c = 0; c < columns; c++) {
    let min = 0
    let max = 0
    const start = c * block
    for (let i = start, end = Math.min(start + block, data.length); i < end; i++) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    peaks.push([min, max])
  }
  return peaks
}
