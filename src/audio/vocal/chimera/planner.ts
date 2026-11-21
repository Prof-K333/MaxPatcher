/**
 * Planning helpers the Vocal Synth needs: lyrics to syllables, and note on/off
 * gestures. Kept separate from Chimera\'s full engine.ts so this module can load
 * without talking to the wasm (and without the creature catalogue UI).
 */
import { call } from './chimera'
import type { BodyMix, Gesture, Lang, Syllable } from './types'

export type { BodyMix, Gesture, Lang, Syllable }

/** Default sung vowel when lyrics are empty. */
export const AH: Syllable = {
  text: 'ah',
  onset: [],
  nucleus: { ipa: 'ɑ', stress: 1 },
  coda: [],
  wordEnd: true,
  phraseEnd: false,
}

export const EXHALE_LABEL = 'exhale'

export const BODY_MIX: Record<'male' | 'female' | 'child', BodyMix> = {
  male: { female: 0, child: 0 },
  female: { female: 1, child: 0 },
  child: { female: 0, child: 1 },
}

/** Friendly vowel names on the node, mapped to IPA nuclei. */
export const VOWEL_IPA: Record<string, string> = {
  ah: 'ɑ',
  ee: 'i',
  oo: 'u',
  oh: 'o',
  eh: 'ɛ',
  ih: 'ɪ',
  uh: 'ʌ',
  ae: 'æ',
}

export const VOWEL_NAMES = ['ah', 'ee', 'oo', 'oh', 'eh', 'ih', 'uh'] as const
export type VowelName = (typeof VOWEL_NAMES)[number]

export function defaultSyllable(vowel = 'ah'): Syllable {
  const ipa = VOWEL_IPA[vowel] ?? VOWEL_IPA.ah
  return { ...AH, text: vowel, nucleus: { ipa, stress: 1 } }
}

export function lyricsToSyllables(text: string, lang: Lang = 'en'): Syllable[] {
  return call('lyricsToSyllables', { text, lang })
}

export function planNoteOn(
  syl: Syllable,
  midi: number,
  options: { body: BodyMix; vibrato: number; tag: number; legatoFrom?: { syl: Syllable; midi: number } },
): Gesture[] {
  return call('planNoteOn', { syl, midi, options })
}

export function planMelisma(midi: number, options: { vibrato: number; tag: number }): Gesture[] {
  return call('planMelisma', { midi, options })
}

export function planNoteOff(syl: Syllable, midi: number, body: BodyMix): Gesture[] {
  return call('planNoteOff', { syl, midi, body })
}
