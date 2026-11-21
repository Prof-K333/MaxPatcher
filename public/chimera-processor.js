/** Control keys in the engine's order: the 17 articulators, then the source channels. */
const CONTROL_KEYS = [
	"jaw",
	"tbX",
	"tbY",
	"ttX",
	"ttY",
	"ttCurl",
	"root",
	"lipAp",
	"lipProt",
	"lipWidth",
	"labiodental",
	"velum",
	"larynx",
	"epilarynx",
	"ventricular",
	"lateral",
	"dorsum",
	"abduction",
	"closure",
	"breath",
	"f0",
	"vibrato"
];
const KEY_INDEX = Object.fromEntries(CONTROL_KEYS.map((k, i) => [k, i]));
const LABEL_CAP = 24;
/** UTF-8 encode (no TextEncoder in the AudioWorkletGlobalScope). */
function utf8(s) {
	const out = [];
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (c < 128) out.push(c);
		else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
		else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
		else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
	}
	return out;
}
/** UTF-8 decode (no TextDecoder in the AudioWorkletGlobalScope). */
function fromUtf8(b) {
	let s = "";
	for (let i = 0; i < b.length;) {
		const c = b[i];
		let cp;
		if (c < 128) cp = c, i += 1;
		else if (c < 224) cp = (c & 31) << 6 | b[i + 1] & 63, i += 2;
		else if (c < 240) cp = (c & 15) << 12 | (b[i + 1] & 63) << 6 | b[i + 2] & 63, i += 3;
		else cp = (c & 7) << 18 | (b[i + 1] & 63) << 12 | (b[i + 2] & 63) << 6 | b[i + 3] & 63, i += 4;
		s += String.fromCodePoint(cp);
	}
	return s;
}
/** Write gestures as records at byte offset `at` of `buf` (as many as fit in `max`). Returns the count written. */
function writeGestures(buf, at, gestures, max) {
	const n = Math.min(gestures.length, max);
	const dv = new DataView(buf, at, n * 272);
	const bytes = new Uint8Array(buf, at, n * 272);
	for (let i = 0; i < n; i++) {
		const g = gestures[i];
		const o = i * 272;
		const head = [
			g.t0,
			g.t1,
			g.rampIn,
			g.rampOut,
			g.strength,
			g.speed ?? NaN,
			g.releaseHold ?? NaN,
			g.tag ?? NaN
		];
		for (let j = 0; j < 8; j++) dv.setFloat64(o + j * 8, head[j], true);
		for (let k = 0; k < CONTROL_KEYS.length; k++) dv.setFloat64(o + 64 + k * 8, NaN, true);
		for (const [key, value] of Object.entries(g.targets)) {
			const k = KEY_INDEX[key];
			if (k !== void 0 && value !== void 0) dv.setFloat64(o + 64 + k * 8, value, true);
		}
		if (g.label === void 0) bytes[o + 240] = 255;
		else {
			let b = utf8(g.label);
			if (b.length > LABEL_CAP) {
				let n = LABEL_CAP;
				while (n > 0 && (b[n] & 192) === 128) n--;
				b = b.slice(0, n);
			}
			bytes[o + 240] = b.length;
			bytes.set(b, o + 241);
		}
	}
	return n;
}
/** Write beat steps (null: rest) as 48-byte records at byte offset `at`. Returns the count written. */
function writeSteps(buf, at, steps, max = 256) {
	const n = Math.min(steps.length, max);
	const dv = new DataView(buf, at, n * 48);
	const bytes = new Uint8Array(buf, at, n * 48);
	for (let i = 0; i < n; i++) {
		const s = steps[i];
		const o = i * 48;
		if (!s) {
			bytes[o] = 255;
			continue;
		}
		const b = utf8(s.id).slice(0, LABEL_CAP);
		bytes[o] = b.length;
		bytes.set(b, o + 1);
		dv.setFloat64(o + 32, s.note ?? NaN, true);
		dv.setFloat64(o + 40, s.accent ?? NaN, true);
	}
	return n;
}
/** The block's whole length, from its header. */
function telemetryLength(head) {
	const [nArtic, nPh, nOr, nScope] = [
		head[11],
		head[12],
		head[13],
		head[14]
	];
	return 16 + nArtic + 3 * (nPh + nOr) + 2 * nScope;
}
/** The block as the UI reads it. The arrays are copies, so the block may be overwritten after. */
function decodeTelemetry(block, labels) {
	const [phLen, orLen, velumPort, f0, voicing, pLung, outRms, noiseLevel, noiseNode, gate, clock, nArtic, nPh, nOr, nScope, nActive] = block;
	let o = 16;
	const take = (n) => Float32Array.from(block.subarray(o, o += n));
	const artic = take(nArtic), phAreas = take(nPh), orAreas = take(nOr), pressureRms = take(nPh + nOr), flow = take(nPh + nOr), glottalArea = take(nScope), glottalFlow = take(nScope);
	const active = [];
	for (let i = 0; i < nActive; i++) active.push(fromUtf8(labels.subarray(i * 25 + 1, i * 25 + 1 + labels[i * 25])));
	return {
		t: {
			artic,
			phAreas,
			orAreas,
			phLen,
			orLen,
			pressureRms,
			flow,
			velumPort,
			glottalArea,
			glottalFlow,
			f0,
			voicing,
			pLung,
			outRms,
			noiseLevel,
			noiseNode,
			gate,
			clock,
			active
		},
		nPh,
		nOr
	};
}
// src/audio/vocal/chimera/worklet/processor.ts
/**
* CHIMERA AudioWorklet processor: the Rust engine (wasm) on the audio thread.
*
* Messages map to engine calls as they arrive (between render quanta, on this thread), so their
* order is the order they take effect. process() renders, measures load and posts fixed-size
* telemetry (~60 Hz). If the engine traps (a bug), the processor outputs silence from then on and
* reports once; the main thread may build a new node, which restarts playback state.
*/
const ARTIC_KEYS = CONTROL_KEYS.slice(0, 17);
const SOURCE_KEYS = [
	"f0",
	"glide",
	"pressure",
	"breathiness",
	"tension",
	"fry",
	"roughness",
	"vibratoDepth",
	"vibratoRate",
	"drift",
	"voiced",
	"brightness"
];
/** gestures taken from one schedule message */
const MAX_GESTURES = 4e3;
var ChimeraProcessor = class extends AudioWorkletProcessor {
	x;
	h;
	failed = false;
	telemetryOn = true;
	blocks = 0;
	load = 0;
	creature = null;
	constructor(options) {
		super();
		this.x = new WebAssembly.Instance(options.processorOptions.module, {}).exports;
		this.h = this.x.engine_new(sampleRate);
		this.port.onmessage = (e) => {
			if (this.failed) return;
			try {
				this.handle(e.data);
			} catch (err) {
				this.fail(err);
			}
		};
		this.postReady();
	}
	post(msg) {
		this.port.postMessage(msg);
	}
	fail(err) {
		if (this.failed) return;
		this.failed = true;
		this.post({
			type: "error",
			message: `engine stopped: ${String(err)}`
		});
	}
	get mem() {
		return this.x.memory.buffer;
	}
	body() {
		return {
			female: this.x.engine_body_female(this.h),
			child: this.x.engine_body_child(this.h)
		};
	}
	postReady() {
		const x = this.x, h = this.h;
		this.post({
			type: "ready",
			sampleRate,
			body: this.body(),
			nPh: x.engine_n_ph(h),
			nOr: x.engine_n_or(h),
			creature: this.creature?.id ?? "human"
		});
	}
	/** A JSON call on this instance's engine (non-real-time: creature switches). */
	engineJson(fn, args) {
		const x = this.x;
		const bytes = utf8(JSON.stringify(args));
		const p = x.chimera_alloc(bytes.length);
		new Uint8Array(this.mem, p, bytes.length).set(bytes);
		const status = x[fn](this.h, p, bytes.length);
		x.chimera_free(p, bytes.length);
		const v = JSON.parse(fromUtf8(new Uint8Array(this.mem, x.chimera_result_ptr(), x.chimera_result_len())));
		if (status !== 0) throw new Error(v.error);
		return v;
	}
	/** The engine's value area, cleared to NaN ("unchanged"). */
	values() {
		return new Float64Array(this.mem, this.x.engine_values(this.h), 32).fill(NaN);
	}
	handle(m) {
		const x = this.x, h = this.h;
		switch (m.type) {
			case "body":
				x.engine_set_body(h, m.body.female, m.body.child);
				this.postReady();
				break;
			case "artic": {
				const v = this.values();
				for (const [k, val] of Object.entries(m.values)) {
					const i = ARTIC_KEYS.indexOf(k);
					if (i >= 0 && typeof val === "number") v[i] = val;
				}
				x.engine_set_artic(h, m.tipFree === void 0 ? 2 : m.tipFree ? 1 : 0);
				break;
			}
			case "source": {
				const v = this.values();
				for (const [k, val] of Object.entries(m.values)) {
					const i = SOURCE_KEYS.indexOf(k);
					if (i >= 0) v[i] = typeof val === "boolean" ? val ? 1 : 0 : val;
				}
				x.engine_set_source(h);
				break;
			}
			case "gate":
				x.engine_set_gate(h, m.level);
				break;
			case "telemetry":
				this.telemetryOn = m.enabled;
				break;
			case "schedule": {
				const n = writeGestures(this.mem, x.engine_records(h), m.gestures, MAX_GESTURES);
				const off = x.engine_schedule(h, n, m.lead ?? .03, m.replace ? 1 : 0);
				if (m.segments.length) this.post({
					type: "planned",
					id: m.id,
					t0: off,
					end: m.end + off,
					segments: m.segments.map((s) => ({
						...s,
						t0: s.t0 + off,
						t1: s.t1 + off
					}))
				});
				break;
			}
			case "stopSpeech":
				x.engine_stop_speech(h);
				break;
			case "release":
				x.engine_release(h, m.tag);
				break;
			case "beat": {
				const n = m.steps ? writeSteps(this.mem, x.engine_records(h), m.steps) : 0;
				x.engine_set_beat(h, m.steps ? 1 : 0, n, m.bpm ?? NaN, m.swing ?? NaN, m.playing === void 0 ? 2 : m.playing ? 1 : 0);
				break;
			}
			case "beatHit":
				writeSteps(this.mem, x.engine_records(h), [{
					id: m.id,
					note: m.note,
					accent: m.accent
				}]);
				x.engine_beat_hit(h);
				break;
			case "creature":
				this.creature = m.id === "human" ? (x.engine_set_human(h), null) : this.engineJson("engine_set_creature", {
					id: m.id,
					params: m.params ?? {}
				});
				this.postReady();
				break;
			case "cparams": {
				const c = this.creature;
				if (!c) break;
				for (const [k, val] of Object.entries(m.values)) {
					const i = c.params.indexOf(k);
					if (i >= 0) x.engine_creature_param(h, i, val);
				}
				break;
			}
			case "call": {
				const i = this.creature ? this.creature.calls.indexOf(m.id) : -1;
				if (i >= 0) x.engine_play_call(h, i, m.pitch ?? NaN, m.amp ?? NaN);
				break;
			}
			case "stopCall": x.engine_stop_call(h);
		}
	}
	process(_inputs, outputs) {
		const out = outputs[0];
		if (!out || out.length === 0) return true;
		const ch0 = out[0];
		if (this.failed) {
			for (const ch of out) ch.fill(0);
			return true;
		}
		const t0 = Date.now();
		try {
			const p = this.x.engine_render(this.h, ch0.length);
			ch0.set(new Float32Array(this.mem, p, ch0.length));
		} catch (err) {
			ch0.fill(0);
			this.fail(err);
		}
		for (let c = 1; c < out.length; c++) out[c].set(ch0);
		const dt = Date.now() - t0;
		const budget = ch0.length / sampleRate * 1e3;
		this.load += .05 * (dt / budget - this.load);
		if (this.telemetryOn && !this.failed && ++this.blocks % 6 === 0) try {
			if (this.creature) this.post({
				type: "ctelemetry",
				t: this.creatureTelemetry(this.creature),
				load: this.load
			});
			else this.post(this.humanTelemetry());
		} catch (err) {
			this.fail(err);
		}
		return true;
	}
	/** The human voice's telemetry block → the message the UI reads. */
	humanTelemetry() {
		const x = this.x, h = this.h;
		const p = x.engine_telemetry(h);
		const { t, nPh, nOr } = decodeTelemetry(new Float64Array(this.mem, p, telemetryLength(new Float64Array(this.mem, p, 16))), new Uint8Array(this.mem, x.engine_tele_labels(h), 100));
		return {
			type: "telemetry",
			t,
			load: this.load,
			body: this.body(),
			nPh,
			nOr,
			beatStep: x.engine_beat_step(h)
		};
	}
	/** A creature's telemetry block → the message the UI reads (names from the switch's info). */
	creatureTelemetry(c) {
		const x = this.x, h = this.h;
		const len = 4 + c.params.length + c.tubes.reduce((s, t) => s + 2 * t.n, 0) + c.sources.length;
		const b = new Float64Array(this.mem, x.engine_creature_telemetry(h), len);
		const [gate, outRms, clock, call] = b;
		let o = 4;
		const params = {};
		for (const k of c.params) params[k] = b[o++];
		const tubes = {};
		for (const t of c.tubes) {
			const areas = Float32Array.from(b.subarray(o, o += t.n));
			const rms = Float32Array.from(b.subarray(o, o += t.n));
			tubes[t.name] = {
				areas,
				rms
			};
		}
		const source = {};
		for (const k of c.sources) source[k] = b[o++];
		return {
			kind: "creature",
			id: c.id,
			params,
			gate,
			outRms,
			clock,
			tubes,
			source,
			call: call >= 0 ? c.calls[call] : null
		};
	}
};
registerProcessor("chimera", ChimeraProcessor);
