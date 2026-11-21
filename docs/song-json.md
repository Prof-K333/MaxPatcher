# Song JSON

MaxPatcher is meant to be used in two ways:

1. **Patching in the UI** — drop nodes on the canvas, cable them together, twist knobs.
2. **Prompting an LLM for a song JSON** — give it your lyrics (and this schema), and import the file it writes.

The second path is a first-class way to find unusual instrument combinations, not a side note. A full `format: "patcher"` file is a node graph with positions, cable handles, and packed sequencer strings like `.".0.3...|0100...`. Language models get that wrong. `format: "patcher-song"` is the format you ask an LLM to write.

Import accepts both. File import, share links, and `deserialize()` all go through the same path. A song file is expanded into a wired, playable patch: sequencer → Vocal Synth, plus whatever instruments you asked for, into a mixer and Master Out. Export of a hand-patched graph stays as `patcher`.

## A short example

Complete files live in [`examples/row-your-boat.song.json`](./examples/row-your-boat.song.json) and [`examples/yankee-doodle.song.json`](./examples/yankee-doodle.song.json) (a 64-bar memory-chain march). The first is a public-domain nursery song. A compact shape looks like this:

```json
{
  "format": "patcher-song",
  "version": 1,
  "name": "Row, Row, Row Your Boat",
  "bpm": 108,
  "key": "C",
  "root": "C4",
  "lyrics": "Row, row, row your boat gently down the stream.",
  "voice": { "body": "female", "vowel": "ah", "breath": 0.72 },
  "bars": [
    { "notes": "C4 C4 C4 D4 E4", "lyrics": "Row row row your boat" },
    { "notes": "E4 D4 E4 F4 G4", "lyrics": "gent-ly down the stream" }
  ],
  "arrangement": [0, 1],
  "loopBars": 64,
  "drums": {
    "presets": ["Four on the floor", "House"],
    "order": [0, 1],
    "bars": 64
  },
  "instruments": {
    "pad": { "wave": "sawtooth", "cutoff": 900 },
    "fx": ["reverb"]
  }
}
```

Notes are readable names (`C4`, `F#3`, `Bb4`). A rest is `.`, `rest`, or `-`. Add `!` for an accent (`E4!`). Each melody slot is one 16-beat bar by default (you can pass more notes, up to 128 steps). The 16-beat grid in the UI does not grow; long forms come from **chaining memory slots**.

## 64-bar and 128-bar loops

Both the Arp / Sequencer (melody) and the 808 Sequencer (drums) keep a 16-beat grid and a bank of memory slots. A playable `order` lists which slots play, and `bars` / `loopBars` is the length of one full loop.

- 8 slots, repeated 8 times = **64 bars**
- 8 slots, repeated 16 times = **128 bars**

If `order` is missing and you only asked for a loop length, import fills the chain from the slots or drum presets you listed. If `order` is missing or empty and you did not ask for a loop length, playback stays on the selected slot — the same behaviour as older patches.

## Field-by-field

| Field | Required | What it is |
| --- | --- | --- |
| `format` | yes | Must be `"patcher-song"`. |
| `version` | no | Currently `1`. Newer versions are rejected. |
| `name` | no | Patch name. Defaults to `"Untitled song"`. |
| `bpm` | no | Tempo, 40–260. Default 120. |
| `key` | no | Concert key, like `"C"` or `"A minor"`. Used if `root` is omitted. |
| `root` | no | Sequence root as a note name, like `"C3"` or `"C4"`. The piano roll is one octave above this root. |
| `lyrics` | no | Plain text. Copied onto the Vocal Synth, and onto melody slot 1 if that slot has no words of its own. Empty lyrics: the singer holds the default vowel (`ah`). |
| `voice` | no | `{ body, vowel, breath, volume }`. `body` is `"male"`, `"female"` (default), or `"child"`. `vowel` is `ah`, `ee`, `oo`, `oh`, `eh`, `ih`, or `uh`. |
| `bars` | no | Melody slots: an array of `{ notes, lyrics?, length? }`, or an array of note strings. |
| `melody` | no | `{ slots, order, bars / loopBars }` if you want the chain spelled out. `melody.bars` may be the slot list *or* the loop length; `loopBars` is always the loop length. |
| `arrangement` | no | Melody memory chain, e.g. `[0, 0, 1, 2]`. |
| `loopBars` | no | Melody loop length in bars, typically `64` or `128`. |
| `drums` | no | `true`, or `{ presets, pattern, order, bars / loopBars, swing, volume }`. Preset names are the shipped beats: `"Four on the floor"`, `"Boom bap"`, `"Trap"`, `"House"`, `"Breakbeat"`, `"Electro"`, `"Half time"`, `"Clave"`. Indices work too. |
| `instruments` | no | Other voices and routing. See below. |

### `instruments`

Invent something. The defaults are only a starting point.

| Field | What it adds |
| --- | --- |
| `keys` | A Keyboard node. Default is on; set `false` to omit it. `{ name, octave }` is allowed. |
| `drums` | Same shape as top-level `drums` (top-level wins if both are present). An 808 Sequencer and a TR-808, chained if you gave an order. |
| `bass` | An FM bass (or `{ type: "oscillator" }`). Pass `notes` and a second sequencer plays that line. |
| `pad` | A held oscillator through a filter. `{ wave, cutoff, volume }`. |
| `lead` | Another FM (or oscillator) voice, driven by the melody sequencer or the keyboard. |
| `fx` | An array such as `["reverb", "delay", "filter", "spatial"]`, or an object `{ reverb: true, delay: true }`. Unknown names warn and are skipped. |
| `mixer` | `"mixer"` (four channels, the default when there is more than one source), `"performanceMixer"`, or `false`. |
| `extras` | An open list of official node types: `{ type, id?, params?, to? }`. Unknown types warn and are skipped. This is the hook for unusual configurations. |

Unknown optional fields never crash import. They produce a warning, and the rest of the song still loads.

## Ready-to-paste LLM prompt

Copy this, attach your lyrics, and paste the JSON the model returns into **Patches → Import**.

```
You are writing a MaxPatcher song file. Return ONLY valid JSON, no markdown.

The schema is format "patcher-song", version 1. Do not write a format "patcher" graph (no node positions, no cable handles, no packed step strings like "0.3.7.|1010").

Required:
- "format": "patcher-song"
- "name", "bpm", "key", "root" (a note name such as "C4")
- "lyrics": the lyrics I give you, as plain text
- "voice": { "body": "male" | "female" | "child", "vowel": "ah"|"ee"|"oo"|"oh"|"eh"|"ih"|"uh", "breath": 0..1 }

Melody:
- "bars": an array of { "notes": "C4 E4 G4 . A4 ...", "lyrics": "optional syllables for this bar" }
  Notes are scientific pitch names. A rest is "." or "rest". Accent a note with "!".
  Each bar is 16 sixteenth notes unless you set "length".
- "arrangement": which bar slots play, in order, e.g. [0, 0, 1, 2]
- "loopBars": 64 or 128 (an 8-slot chain repeated 8 times is 64 bars; repeated 16 times is 128)

Drums (optional but encouraged):
- "drums": {
    "presets": ["Four on the floor", "Boom bap", "Trap", "House", "Breakbeat", "Electro", "Half time", "Clave"],
    "order": [0, 1, 2, 3, 4, 5, 6, 7],
    "bars": 64 or 128
  }

Instruments — invent a unique configuration, not only singer + drums. Choose from:
- "instruments": {
    "keys": { "octave": 4 },
    "bass": { "type": "fmsynth" | "oscillator", "notes": "C2 G2 C2 E2", "wave": "sine" },
    "pad": { "wave": "sawtooth"|"triangle"|"square"|"sine", "cutoff": 200-4000 },
    "lead": { "type": "fmsynth" | "oscillator" },
    "fx": ["reverb", "delay", "filter", "spatial"],
    "mixer": "mixer" | "performanceMixer" | false,
    "extras": [{ "type": "<any official MaxPatcher node type>", "params": {}, "to": "mix" }]
  }

Prefer unusual, musical combinations (a granular cloud on the pad, a tape looper in the extras, a sidechain compressor, a filter swept by an LFO in extras, etc.) when they serve the song. If a type or preset is unknown it will be skipped with a warning, so stay within real node types and the drum names listed above.

Here are the lyrics:

<PASTE LYRICS HERE>
```

## Trying a song file

1. Press **Start Audio**.
2. **Patches → Import** and choose the JSON (or paste it if you are loading from a file you saved).
3. Press **▶ PLAY** on the Arp / Sequencer if it is not already running (song import starts it).
4. The Vocal Synth should sing. Patch more cables if you want to play along on the Keyboard.

The singer is one live instance only — the voice model is heavy. A second Vocal Synth node will say so rather than starting another engine.
