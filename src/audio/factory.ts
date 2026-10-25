import * as Tone from 'tone'
import { NodeImpl, ToneNodeImpl } from './NodeImpl'
import { FMSynthImpl } from './nodes/FMSynthImpl'
import { KeyboardImpl } from './nodes/KeyboardImpl'
import { SamplerImpl } from './nodes/SamplerImpl'
import { LooperImpl } from './nodes/LooperImpl'
import { GranularImpl } from './nodes/GranularImpl'
import { DrumMachine808Impl } from './nodes/DrumMachine808Impl'
import { MixerImpl } from './nodes/MixerImpl'
import { BusCompressorImpl } from './nodes/BusCompressorImpl'
import { PerformanceMixerImpl } from './nodes/PerformanceMixerImpl'
import { LiveLooperImpl } from './nodes/LiveLooperImpl'
import { DrumSequencerImpl } from './nodes/DrumSequencerImpl'
import { ArpImpl } from './nodes/ArpImpl'
import { MasterOutImpl } from './nodes/MasterOutImpl'

/** Builds the implementation behind one node type. */
export function createNode(type: string, master: Tone.ToneAudioNode): NodeImpl {
  switch (type) {
    case 'oscillator': {
      const osc = new Tone.Oscillator()
      return new ToneNodeImpl(osc, osc)
    }
    case 'noise': {
      const noise = new Tone.Noise()
      return new ToneNodeImpl(noise, noise)
    }
    case 'lfo': {
      const lfo = new Tone.LFO()
      return new ToneNodeImpl(lfo, lfo)
    }
    case 'gain':
      return new ToneNodeImpl(new Tone.Gain(1))
    case 'filter': {
      const filter = new Tone.Filter()
      filter.rolloff = -24
      return new ToneNodeImpl(filter, undefined, (key, value) => {
        if (key !== 'rolloff') return false
        // The select hands us a string; Tone wants one of its literal numbers.
        filter.rolloff = Number(value) as Tone.FilterRollOff
        return true
      })
    }
    case 'delay':
      return new ToneNodeImpl(new Tone.FeedbackDelay())
    case 'reverb': {
      const reverb = new Tone.Reverb()
      return new ToneNodeImpl(reverb, undefined, (key, value) => {
        if (key !== 'decay') return false
        reverb.decay = Number(value)
        // Reverb has to re-render its impulse response after a decay change.
        reverb.generate().catch(() => {})
        return true
      })
    }
    case 'fmsynth':
      return new FMSynthImpl()
    case 'keyboard':
      return new KeyboardImpl()
    case 'sampler':
      return new SamplerImpl()
    case 'looper':
      return new LooperImpl()
    case 'granular':
      return new GranularImpl(master)
    case 'drums808':
      return new DrumMachine808Impl()
    case 'mixer':
      return new MixerImpl()
    case 'performanceMixer':
      return new PerformanceMixerImpl()
    case 'busCompressor':
      return new BusCompressorImpl()
    case 'liveLooper':
      return new LiveLooperImpl()
    case 'drumSeq':
      return new DrumSequencerImpl()
    case 'arp':
      return new ArpImpl()
    case 'destination':
      return new MasterOutImpl(master)
    default:
      throw new Error(`Unknown audio node type: ${type}`)
  }
}
