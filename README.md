# Patcher

A node-based visual audio patcher in the spirit of Max/MSP. Drag cables between
nodes on a React Flow canvas; the Web Audio graph is rebuilt to match in real time.

## Stack

Vite · React 19 · TypeScript · Tailwind CSS 4 · `@xyflow/react` 12 · Tone.js 15

## Running it

This machine has no system Node, so use the portable build:

```bash
export PATH="/tmp/node-v20.18.0-darwin-arm64/bin:$PATH" && npm run dev --prefix /Users/krapels/Documents/Blockscout/max-patcher
```

The dev server binds every interface (`server.host: true`), not just IPv6
loopback as Vite does by default — otherwise a browser that resolves
`localhost` to `127.0.0.1` is refused and the app looks dead. It is also
reachable from other devices on the network, which is how you would open it
on a phone.

Then open http://localhost:4319 and press **Start Audio** — browsers refuse to
run an AudioContext until a user gesture, so nothing sounds before that.

The starting patch has two halves: a playable voice on the left (keyboard →
phrase looper → FM synth → filter) and a sequenced drum machine on the right
(808 sequencer → TR-808, with the accent lane patched as CV). Both feed the
master. Press **▶ PLAY** on the sequencer for the beat; play the keyboard over
the top. The sequencer starts stopped, so Start Audio alone makes no noise.

## How it fits together

| File | Role |
| --- | --- |
| `src/audio/nodeDefs.ts` | The node registry: ports, params and ranges. One entry per node type. |
| `src/audio/AudioEngine.ts` | Owns the Tone.js graph and diffs it against the visual graph. |
| `src/components/PatchNode.tsx` | Renders *any* node generically from its registry entry. |
| `src/App.tsx` | React Flow canvas; calls `engine.sync(nodes, edges)` whenever either changes. |
| `src/audio/NodeImpl.ts` | The face every node presents to the engine. |
| `src/audio/factory.ts` | Builds the implementation behind each node type. |
| `src/audio/nodes/` | Custom nodes: FM synth, keyboard, sampler, looper, granular. |
| `src/audio/granular/` | Grain scheduler, windows, transient slicing, default buffer. |
| `src/audio/drums/` | The 808 engine, per-voice mixer buses and the ramp helper. |
| `src/audio/sequencer/` | The lookahead clock and the pattern model. |
| `public/looper-processor.js` | The tape looper's DSP, running on the audio thread. |
| `src/components/Piano.tsx` | The playable keyboard, shared by the node and the dock. |
| `src/patch/format.ts` | Patch file format — serialize, and validate untrusted JSON on the way in. |
| `src/patch/storage.ts` | localStorage autosave and named slots. |
| `src/patch/presets.ts` | The five example patches. |

The React layer never touches Tone directly. It calls `engine.sync()` with the
current nodes and edges, and the engine works out the difference — creating,
disposing, re-patching and re-tuning only what actually changed. That keeps the
visual graph as the single source of truth.

### Ports

A handle id says what kind of cable it accepts:

| Prefix | Kind | Colour | Carries |
| --- | --- | --- | --- |
| `in` / `out` | audio | blue | ordinary signal flow |
| `param:<name>` | param | violet | audio-rate modulation, patched onto a Tone Param |
| `cv:<name>` | CV | violet | audio-rate modulation a *JS scheduler* samples |
| `ev:<name>` | event | amber | discrete note / bang messages |

Audio and param cables are wired through Web Audio. **Event cables are not
signals** — they are JS calls routed by the engine. Because they are plain
synchronous calls, a patch that loops back on itself would recurse until the
tab froze, so the engine refuses to re-enter an outlet that is already
mid-dispatch: the cycle is broken where it closes and the rest of the patch
carries on. It warns once per outlet, and `engine.loopingOutlets` lists them. That distinction is what
makes polyphony possible: a signal can only ever express one pitch at a time,
so a keyboard driving a chord has to send messages, not voltages.

`cv:` exists because some modulation targets are decided in JS rather than by
the audio graph — grain position is chosen once per grain, so that inlet is
*sampled* through a small analyser (`src/audio/cv.ts`) instead of being patched
onto a Param.

## Discoverability

Patching is not obvious from looking at a canvas, so the Add Node palette
opens with a pinned legend saying how to do it — drag a port to a port — and
what the three port colours mean. Modules are grouped by what they are for,
each with an icon and a one-line description, and every button in the app
carries a `title` tooltip explaining its function.

A node type's `icon` and `description` live in its registry entry, so a new
module appears in the palette fully described without touching the palette.

### Adding a node type

Add an entry to `NODE_DEFS` and a `case` to `createNode()` in `factory.ts`. The
UI, the palette, the minimap colour and the param controls all follow
automatically. A node that needs more than sliders sets `ui: '<name>'` on its
definition and registers a component in `NODE_UI` in `PatchNode.tsx`.

## The nodes

**FM Synth** — Chowning FM on `Tone.PolySynth`: a modulator at a fixed ratio
(harmonicity) deviating a carrier, with the depth set by the modulation index.
Amplitude and modulation index each get their own ADSR, which is what makes FM
expressive — a decaying modulation envelope gives a struck or plucked timbre
rather than a static buzz. Takes notes on `ev:note` and FM depth on `cv:fmDepth`.

**Keyboard** — mouse, glissando and QWERTY (`A`–`K` white, `W/E/T/Y/U` black).
Four outlets: `note` events for polyphony, plus `pitch`, `gate` and `velocity`
signals for patching the old modular way. The signal outlets use last-note
priority. Velocity follows how low on the key you click.

**Phrase Looper** — records incoming notes, snaps them to the clock and replays
them on a seamless loop, with overdub and clear. Each recorded event gets its
own repeating Transport slot, and the callback's exact time travels with the
event, so replayed notes start sample-accurately rather than whenever the main
thread happens to run.

**Sampler** — drag-and-drop or import, with play/stop, loop, playback rate and
trim handles. Fires on `ev:trig`.

**Granular Cloud** — see below. It can granulate a loaded file *or* whatever
is patched into its audio inlet, which is what makes live re-sampling work.

**TR-808 Drums** — see below.

**Tape Looper** — see below.

**Arp / Sequencer** — melodic counterpart to the drum sequencer. Two ways to
pick the next pitch, one clock, one output: *arp* mode walks whatever notes
are held at its inlet (up, down, up-down, random, as-played, across 1–4
octaves), while *sequence* mode plays a pitch from its piano roll. Both emit
ordinary note events, so anything that accepts a keyboard accepts this.

Notes leave as an attack **and** a release a gate-length later, rather than
being held until the next step — that is what makes the Gate knob shorten a
note instead of merely delaying the one after it. Patch the 808 sequencer's
clock out into its clock inlet and the two lock together; the arp divides that
clock with a fractional accumulator, so triplet rates survive an external
16th-note clock.

**808 Sequencer** — see below.

**Mixer** — four channels, each with level, pan and mute, plus a master fader.
Each strip is **named after whatever is patched into it**, because "which one
is the drums" is the only question anyone asks a mixer, and a numbered strip
cannot answer it.
Web Audio already sums anything patched into one input, so a mixer is not what
*combines* sources — it is what lets you balance them instead of every voice
fighting at full volume. A channel strip lights up when something is patched
into it, so it doubles as a readout of what is feeding the mix.

**Filter** — `Tone.Filter` wraps `BiquadFilterNode`: lowpass/highpass/bandpass/
notch, cutoff, resonance, slope (−12/−24/−48 dB per octave) and a cutoff
modulation inlet.

That inlet lands on **`detune`, not `frequency`**. Detune is measured in cents,
so modulation moves the cutoff in *octaves* — the same depth sounds the same
wherever the knob sits. Modulating `frequency` linearly in Hz is what makes a
sweep feel wrong: ±2000 Hz is a chasm at the bottom of the range and inaudible
at the top, so you never get the classic swoop. Depth is therefore in cents,
defaulting to ±2400 (two octaves).

A filter sweep also needs something to chew on. A lowpass over a near-sine does
almost nothing, so the FM synth's carrier defaults to a sawtooth.

## Live parameter changes

Connecting a cable to a `param:` inlet makes Tone mark that param `overridden`
and zero its intrinsic value — writing to it afterwards **throws**. So a cabled
param sums two things instead:

```
            knob ──► base Signal ──┐
                                   ├──► param
  cable ──► depth Gain ────────────┘
```

The knob sets where the modulation sits; **depth** sets how far it swings
either side, and going negative inverts it — an attenuverter. Pull the cable
and both nodes are disposed, `overridden` is cleared and the knob drives the
param directly again.

Depth controls are generated from each node's inlets rather than written by
hand, so a new inlet cannot ship without one, and they appear in the node only
while that inlet actually has a cable. For a `param:` inlet the depth is in the
param's own units (patch an LFO into cutoff and a depth of 1200 means ±1200 Hz
around the knob); it defaults to the knob's own resting value, which lands
musically whatever the units — a fraction of the full span does not, since a
quarter of 20 Hz–18 kHz would hurl the cutoff off the scale. `cv:` inlets are
normalised to ±1, because the node reading them does its own scaling.

The LFO is therefore a **bipolar −1…+1** modulation source rather than an
absolute range, and its Min/Max sliders span exactly that. Slider *range* is a
usability decision, not a formality: when those two ran −2000…+2000 the useful
±1 region was narrower than a single pixel of travel, so the control was
unaimable. A generated depth is capped at four times its default throw for the
same reason, and envelope times are log-curved so the short end — where the
ear actually lives — is not crushed into the first few pixels.

Param writes are also caught per-param, and the `engine.sync()` effect is
wrapped. This matters more than it looks: an exception escaping a React effect
unmounts the whole tree, so a single bad param write used to take the entire
UI down mid-performance — which presented as "turning a knob stops the sound"
and, because nothing was left to send note-offs, "notes play forever".

## Keyboards and QWERTY focus

Every key carries `nodrag nopan`. Without it, pressing a key inside React Flow
drags the node across the canvas instead of playing a note. Pointer capture is
deliberately *not* used, which is what allows glissando.

The dock is **not a second instrument**. It is a larger playing surface for one
chosen Keyboard node: notes travel that node's cables, and octave, velocity
**and hold** are read from — and written back to — that node, so its controls
govern whichever surface you play. Every setting shared between the two has to
be shared; leaving hold behind meant the node showed Hold on while dock keys
stayed momentary, and notes seemed not to sound at all. Leaving the dock with its own private octave and
velocity was genuinely confusing: the node's knobs appeared to do nothing,
because the surface being played ignored them.

The routing is stated rather than implied. The dock says *"Playing through
‹node›"*, the node carries a matching badge, and a dashed ring on the canvas
marks which node is being driven.

Each keyboard can be given a **name** (Bass, Lead, Pad), which labels it in the
dock's dropdown and in its own header. Unnamed keyboards fall back to
`Keyboard 1`, `Keyboard 2`… in the order they were added. Naming is a `text`
param, so any node can have one: a node with a non-empty `name` shows it in
the header with its type kept as a quiet suffix.

**Hold** latches notes so you can let go and turn knobs while they sound;
pressing a latched key again clears it, and switching Hold off is the
all-notes-off gesture. The dock also has an explicit All notes off button.
A note can never outlive what started it: a mouse released anywhere, the window
losing focus, or the keyboard unmounting all release whatever is sounding.

With several keyboards on one canvas, typing must not sound them all. QWERTY
goes to the **selected** keyboard node (each has a Focus toggle to opt out).
When no keyboard node holds focus, the docked keyboard at the bottom takes
over. The dock plays *through* a chosen keyboard node, so its notes travel the
same cables as that node's own keys.

## Granular Cloud

Two modes share one buffer. **Cloud** runs the grain scheduler continuously;
**Slice** detects transients and maps incoming notes to slice indices.

The scheduler (`GranularAudioEngine`) is the performance-critical part. Grains
fire far too often to drive from a timer directly — the main thread would
jitter audibly. Instead a slow timer wakes every 25ms and schedules every grain
due in the next 120ms at exact AudioContext times, so the audio thread does the
timing and main-thread hiccups never reach the output.

Three details that matter if you touch it:

- **Windowing is the whole trick.** A grain is a slice cut out of a buffer, and
  cutting audio at a non-zero sample is exactly how you get a click. Each grain
  is multiplied by a window that starts and ends at zero, applied with
  `setValueCurveAtTime` so the shaping happens on the audio thread.
- **`AudioBufferSourceNode`s cannot be pooled** — they are single-use by
  specification. The gain and panner behind each grain are recycled instead,
  which is what keeps allocation (and GC pauses) low at 80 grains a second.
- **Reverse plays from a pre-reversed copy** of the buffer, because negative
  `playbackRate` is not supported.

Freeze latches the position at the instant it is engaged, rather than jumping
to wherever the slider sits. The grain-bang outlet is throttled: at full density
an unthrottled event outlet would flood the rest of the patch.

The canvas is driven by a single `requestAnimationFrame` loop that reads the
engine's grain trail directly and never touches React state — a re-render per
grain would melt the UI thread. When the context is suspended the scheduler
stops and voices are released, so nothing runs while silent.

A three-second bell is synthesised at construction from inharmonic partials, so
the node makes sound the moment it is dropped on the canvas with no asset to
ship or fetch.

**Samples are not saved in patches.** Decoded audio is far too large for the
patch JSON, so a reloaded patch keeps the node and its settings but asks for
the file again.

## Recording

**Master Out records.** Press **Record**, play, press **Stop**, then **Save** —
you get a `.wav` named with a timestamp. It taps the engine's master bus, so
the file is exactly what you heard, master volume included, with nothing to
patch.

The take is written as **16-bit PCM wav** rather than whatever the browser's
own `MediaRecorder` produces: that gives WebM or Opus depending on the
browser, and whatever consumes the file next may not accept it. A wav is
understood everywhere, and the header costs forty lines.

The recording is held in memory until you stop, so the button shows elapsed
time while running and the file size afterwards — a few minutes of stereo is
tens of megabytes. Takes are capped at ten minutes, and stopping the audio
engine closes the take rather than leaving it half-recorded.

## Start / Stop

**Start** resumes the AudioContext and starts every source. **Stop** stops the
sources and suspends the context, so the patch keeps its state but is silent and
costs no CPU. Master volume is the `destination` node's `volume` param, so the
toolbar slider and the Master Out node are two views of one value.

## Example patches

**Patches → Example patches** loads five demos, each built to show a different
part of the app and to make sound as soon as it loads:

| Patch | Shows |
| --- | --- |
| **Tape Loop Drone** | A tape looper feeding a delay and itself — the feedback cycle. |
| **Granular Shimmer** | Live re-sampling: a lead granulated an octave up into reverb. |
| **808 Jam** | Sequencer driving the 808 with accent CV, plus a playable bass. |
| **Polymeter Clockwork** | Drum lanes of 16, 11, 7 and 5 drifting; the loop bang freezes a grain cloud. |
| **Modulation Lab** | Two LFOs — one sweeping a filter, one scrubbing a grain cloud. |
| **Arp Engine** | Hold a chord and the arpeggiator locks to the drum sequencer's clock. |

808 Jam, Polymeter Clockwork and Modulation Lab play on their own once audio
is running; Tape Loop Drone and Granular Shimmer are instruments, so play the
keyboard. Presets are built as ordinary patch files and go through the same
validation as an imported one, so a broken preset surfaces a warning rather
than loading a dead patch.

## Saving patches

The patch autosaves to `localStorage` about half a second after you stop
editing, and is restored on the next visit — including node positions and the
patch name. The **Patches** menu adds named slots, plus JSON export and import.

Exported files look like this, and are the same shape as what is stored:

```json
{
  "format": "patcher",
  "version": 1,
  "name": "Bass Drone",
  "savedAt": "2026-10-24T04:00:00.000Z",
  "nodes": [{ "id": "osc-1", "type": "oscillator", "position": { "x": 80, "y": 40 }, "params": { "frequency": 110 } }],
  "edges": [{ "id": "e1", "source": "osc-1", "sourceHandle": "out", "target": "master", "targetHandle": "in" }]
}
```

### Imported JSON is treated as untrusted

`deserialize()` never hands anything to Tone.js that could throw there. It
rejects files that are not patches or that claim a future `version`, and then
discards, with a warning, anything it cannot make sense of: unknown node types,
duplicate ids, and cables pointing at missing nodes or non-existent ports.
Slider params are clamped to their declared range and selects must name a real
option, so a hand-edited file cannot drive a filter to 1 GHz.

Two sharp edges worth remembering if you extend this:

- Node types are looked up with `Object.hasOwn(NODE_DEFS, type)`, not a
  truthiness check. `"__proto__"` and `"constructor"` resolve against
  `Object.prototype` and would otherwise pass as valid types. `NODE_DEFS` also
  has a null prototype.
- `AudioEngine.sync()` disposes a node when its id is reused for a *different*
  type. Loading a patch can do exactly that, and reusing the old Tone object
  would write params onto the wrong kind of node.

`localStorage` access is wrapped: it throws in private windows and when the
quota is full, and a failed save surfaces as a toast rather than losing the graph.

## TR-808 Drums

Six procedurally synthesised voices, no samples anywhere:

| Voice | How it is made |
| --- | --- |
| **BD** | A sine swept from Tone (120–220 Hz) down to Sub (35–55 Hz) over 25–45 ms, through a soft-clipping `WaveShaperNode`. The pitch drop is the whole character of an 808 kick. |
| **SD** | Two sines (tune × 1 and × 1.83) for the drum head, plus noise through a 1 kHz highpass. Snappy balances head against wires. |
| **CP** | Three 10 ms noise slaps ~15 ms apart, then a diffuse tail, through a 1.2 kHz bandpass at Q 1.5. |
| **CH / OH** | Six detuned squares (245/306/384/522/640/838 Hz) into a 7 kHz bandpass and a 10 kHz highpass. |
| **CB** | Squares at 540 and 800 Hz through an 800 Hz bandpass at Q 3. |

A closed hat **chokes** any ringing open hat, as on the real machine where both
share one output circuit.

### Normalling

Each voice runs level → pan, then splits into a master send and a direct tap.
Patching an individual outlet (`BD Out`, `SD Out`, `SD Noise Out`, …) mutes that
voice's master send, so it leaves the mix — exactly how an analog mixer's
normalled jacks behave. Outlet connections are reference counted in the engine,
so a second cable on the same outlet does not undo the first when one is pulled.

### Two things that will bite you

- **`setTargetAtTime` silently does nothing** on nodes created through Tone's
  `rawContext` — the param keeps its old value and the change is never heard.
  Every smoothing ramp here goes through `rampParam()`, which anchors with
  `setValueAtTime` and then `linearRampToValueAtTime`. This cost real debugging
  time: normalling looked broken when the routing was fine all along.
- **Exponential ramps throw on zero.** Every envelope target is clamped to
  `0.0001` via `safe()`.

Oscillators and buffer sources are single-use by specification, so each hit
builds its own short-lived nodes and tears them down on `onended`. Only the
per-voice mixer path is long-lived.

## Port layout

A node definition can set `ports: 'horizontal'` to put inlets on the left edge
and outlets on the right, instead of the default top/bottom. The 808 uses it,
since it carries seven inlets and nine outlets.

## Tape Looper

A live sound-on-sound looper whose DSP runs in an **AudioWorklet**
(`public/looper-processor.js`), not on the main thread. That is not an
optimisation: a looper punched in from the UI thread smears its loop points by
however long the browser happened to be busy, and since punching out of the
first take is what *defines* the loop length, that error is baked in forever.
Everything that decides a sample lives in the processor; the main thread only
sends commands and receives status.

States run `EMPTY → RECORDING → PLAYING ⇄ OVERDUBBING`, with `STOPPED`
alongside. The big button always does the next useful thing — record, punch
out, then layer.

**Sound on sound.** While overdubbing, existing audio is scaled by `feedback`
as the new layer lands on it, so earlier passes decay like analog tape. At
feedback 1 the loop keeps everything; at 0.3 it washes away in a few passes.

**Seams.** A loop clicks because the last sample and the first are unrelated.
A fade hides that but dips the volume, so the processor keeps recording for
5 ms *past* the punch-out and crossfades that tail against the loop start —
a real crossfade, using audio that genuinely followed the loop end. Without a
tail (after a clear) it falls back to the short fade. Punch-in and punch-out
ramp the record gain over the same 5 ms.

**Varispeed** reads through the buffer with a floating pointer and linear
interpolation, so reverse, half speed and the Speed CV inlet all work on one
mechanism.

### Feedback patches

Routing the looper's output through a delay and back into its input — tape
loops, Frippertronics — works, but only because the looper puts a real 10ms
`DelayNode` in front of its worklet. **Web Audio mutes any feedback cycle that
is not broken by a DelayNode**, and neither an AudioWorklet nor Tone's delay
counts: Tone's delay keeps a dry path that bypasses its own delay line, so the
cycle still contains a delay-free route and the whole thing goes silent. The
looper's input delay guarantees every cycle through it is legal.

The overdub sum is also soft-clipped. A looper feeding a delay feeding the
looper has a loop gain above one and will climb until it clips — measured, it
reached +1.3 dB and was still rising. Tape saturates instead, so the buildup
plateaus; with saturation the same patch settles at about −8 dB and stays
there. That self-limiting *is* the sound.

### Live re-sampling

The Granular Cloud's **Live** button switches it from the loaded file to an
8-second rolling capture of its audio inlet, so you can feed it a looper and
granulate the loop as it plays.

Capture needs the audio on the main thread, because grains play through
`AudioBufferSourceNode`s and those need an `AudioBuffer`. A worklet forwards
blocks up, and they are written into a ring buffer **in place while grains are
reading it**. That is only safe because the scheduler confines grains to a
window *trailing* the write head, so a grain never reads the sample currently
being overwritten. Reverse is a loaded-file feature only: a pre-reversed copy
of a ring would be stale the moment it was made.

### Two traps worth remembering

- Tone wraps the AudioContext in `standardized-audio-context`, and the global
  `AudioWorkletNode` constructor **rejects that wrapper** (`parameter 1 is not
  of type 'BaseAudioContext'`). Build the node with Tone's
  `context.createAudioWorkletNode(...)` instead.
- **Both processors are registered from one module file.** A second module
  was rejected with `NotSupportedError` on Tone's wrapped context even though
  the module loaded and plain Chrome accepted the identical file — the wrapper
  only exposes processors from modules it has itself parsed. Registering the
  capture processor from `looper-processor.js` sidesteps it. The symptom looks
  exactly like a misspelled processor name, so it is worth recognising.
- Registration is asynchronous, so the node exists before its processor does.
  Audio passes through dry until the worklet is live, and params set in the
  meantime are replayed once it loads. On dispose the port is detached and the
  node disconnected, or the processor keeps running and holding its buffers.

## 808 Sequencer

Seven lanes — BD, SD, CP, CH, OH, CB and an accent lane — built to drive the
808 over event cables.

**The timer never decides when a note sounds.** It decides when to *book*
notes: every 25ms tick looks 100ms ahead and schedules each due step at an
exact `AudioContext` time. A stalled main thread delays the booking, not the
music, because steps already booked belong to the audio clock. The tick comes
from a Worker, since browsers clamp timers to about once a second in
background tabs, which would otherwise starve the scheduler. After a long
stall the clock resyncs rather than firing the backlog as one burst.

**Polymeter falls out of per-track positions.** There is no shared step
counter: each lane keeps its own position and wraps at its own length, so a
7-step hat lane slips against a 16-step kick on its own.

**A 2×8 slot matrix.** The top row — *Beats* — ships with Four on the floor,
Boom bap, Trap, House, Breakbeat, Electro, Half time and Clave, because an
empty sequencer is a blank page and a blank page is the slowest way to find
out what a drum machine does. The bottom row — *Yours* — is eight empty slots
to fill.

Click any slot to play it; switching is instant, so you can chain slots by
hand while it runs. **Shift-click** one of your slots to copy whatever is
currently playing into it, which is how you keep a variation you just worked
out. A filled slot looks brighter than an empty one, so the row doubles as a
map of what you have saved.

Every slot is editable, including the shipped beats — they are starting
points, not read-only presets. The **↺** button puts the original back when
you are on a shipped slot. Banks saved before this gain the new slots instead
of showing blanks.

Per step: a tri-state level (off / normal / accent), a ratchet of 1–4
sub-hits, and a probability. Click a step to cycle its level, **right-click**
for the ratchet and chance inspector. Per lane: mute, solo, length, nudge and
randomise. Four pattern slots (A, B, Fill 1, Fill 2) switch instantly, and
**FILL** turns every active step into a 16th-note roll while held.

Triggers leave as events carrying a velocity and the exact time they are due,
which the 808 honours — a step booked 100ms early still strikes on the sample
it was scheduled for. Alongside them: an accent CV matching the accent lane
(patch it into the 808's accent inlet), a 10ms summed pulse for sidechain
ducking, a 16th-note clock out, and a bang each time the kick lane wraps.

The whole pattern bank is packed into one compact JSON param, so patterns
travel with the saved patch.
