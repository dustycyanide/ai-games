/**
 * All sound is synthesised with WebAudio: oscillators, filtered noise, and a
 * generated impulse response for a little room reverb. Nothing plays until
 * `unlock()` is called from a user gesture.
 */

import type { Flavor } from './flavors';

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  /** Glide to this frequency over the note. */
  to?: number;
  /** Low-pass cutoff. */
  lp?: number;
}

interface NoiseOpts {
  gain?: number;
  type?: BiquadFilterType;
  freq?: number;
  q?: number;
  attack?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private noiseBuf!: AudioBuffer;
  private _muted = false;

  get muted(): boolean {
    return this._muted;
  }

  /** Create/resume the context. Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this._muted ? 0 : 0.8;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    // One second of white noise, reused by every noise voice.
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // Reverb: exponentially decaying noise as the impulse response.
    const len = Math.floor(ctx.sampleRate * 1.3);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.dry.connect(verb).connect(wet).connect(this.master);

    this.startHum();
  }

  setMuted(m: boolean): void {
    this._muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
  }

  // --- voices --------------------------------------------------------------

  private tone(freq: number, at: number, dur: number, o: ToneOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.dry);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private noise(at: number, dur: number, o: NoiseOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.value = o.freq ?? 1000;
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.dry);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private startHum(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    g.connect(this.master);
    for (const [f, a] of [[60, 1], [120, 0.6], [180, 0.25], [240, 0.12]] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start();
    }
    // Neon buzz: band-passed noise wobbling at mains rate.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 4;
    const bg = ctx.createGain();
    bg.gain.value = 0.25;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 120;
    const lg = ctx.createGain();
    lg.gain.value = 0.2;
    lfo.connect(lg).connect(bg.gain);
    src.connect(bp).connect(bg).connect(g);
    src.start();
    lfo.start();
  }

  // --- effects -------------------------------------------------------------

  button(): void {
    this.noise(0, 0.035, { type: 'highpass', freq: 1800, gain: 0.25 });
    this.tone(170, 0, 0.07, { type: 'square', gain: 0.08, lp: 900 });
  }

  coin(): void {
    this.tone(2640, 0, 0.3, { gain: 0.14 });
    this.tone(3960, 0, 0.2, { gain: 0.07 });
    this.tone(3120, 0.07, 0.25, { gain: 0.1 });
    this.noise(0.16, 0.09, { freq: 600, gain: 0.2 });
    this.tone(1900, 0.17, 0.12, { gain: 0.05 });
  }

  whir(dur: number): void {
    this.tone(52, 0, dur, { type: 'sawtooth', gain: 0.16, attack: 0.12, to: 98, lp: 650 });
    this.tone(104, 0, dur, { type: 'square', gain: 0.04, attack: 0.12, to: 190, lp: 900 });
    for (let t = 0.05; t < dur - 0.05; t += 0.105) {
      this.noise(t, 0.05, { type: 'bandpass', freq: 1300, q: 2, gain: 0.09 });
    }
    for (let i = 0; i < 5; i++) {
      this.tone(3800 + Math.random() * 2400, 0.1 + Math.random() * (dur - 0.2), 0.12, { gain: 0.025 });
    }
  }

  clunk(): void {
    this.tone(150, 0, 0.24, { gain: 0.5, to: 42 });
    this.noise(0, 0.11, { freq: 900, gain: 0.3 });
    this.tone(2150, 0.04, 0.2, { gain: 0.06 });
    this.tone(3230, 0.05, 0.14, { gain: 0.035 });
    // Settle bounce.
    this.tone(120, 0.19, 0.12, { gain: 0.14, to: 50 });
    this.tone(2300, 0.2, 0.1, { gain: 0.03 });
  }

  pop(): void {
    this.tone(950, 0, 0.07, { gain: 0.35, to: 180 });
    this.noise(0, 0.05, { type: 'highpass', freq: 2800, gain: 0.25 });
    this.noise(0.03, 1.5, { type: 'highpass', freq: 5200, gain: 0.07, attack: 0.05 });
  }

  gulp(): void {
    this.tone(210, 0, 0.13, { gain: 0.24, to: 120, lp: 700 });
    this.tone(320, 0.09, 0.08, { gain: 0.1, to: 420, lp: 900 });
  }

  zap(): void {
    this.noise(0, 0.16, { type: 'bandpass', freq: 2400, q: 3, gain: 0.14 });
    this.tone(110, 0, 0.2, { type: 'sawtooth', gain: 0.1, to: 45, lp: 500 });
  }

  powerUp(): void {
    this.tone(60, 0, 0.55, { type: 'sawtooth', gain: 0.11, attack: 0.2, to: 180, lp: 700 });
    this.noise(0.25, 0.22, { type: 'bandpass', freq: 3200, q: 4, gain: 0.07, attack: 0.05 });
  }

  private note(hz: number, at: number, dur: number, timbre: Flavor['timbre'], gain = 0.12): void {
    if (timbre === 'bell') {
      this.tone(hz, at, dur * 1.8 + 0.3, { gain });
      this.tone(hz * 3.01, at, dur * 0.9 + 0.1, { gain: gain * 0.3 });
      this.tone(hz * 5.4, at, 0.12, { gain: gain * 0.15 });
    } else {
      // Toy-organ: square over triangle, softened.
      this.tone(hz, at, dur * 0.95 + 0.06, { type: 'square', gain: gain * 0.55, attack: 0.012, lp: 2300 });
      this.tone(hz * 2, at, dur * 0.95 + 0.06, { type: 'triangle', gain: gain * 0.45, attack: 0.012 });
    }
  }

  /** The flavour's signature tune, with a held bass root and a closing chord. */
  jingle(f: Flavor): void {
    const beat = 60 / f.bpm;
    let at = 0.05;
    for (const [semi, beats] of f.jingle) {
      this.note(f.rootHz * Math.pow(2, semi / 12), at, beats * beat, f.timbre);
      at += beats * beat;
    }
    this.tone(f.rootHz / 2, 0.05, at, { type: 'triangle', gain: 0.1, attack: 0.02 });
    const last = f.jingle[f.jingle.length - 1]!;
    const end = at - last[1] * beat;
    for (const semi of [-5, -8]) this.note(f.rootHz * Math.pow(2, (last[0] + semi) / 12), end, last[1] * beat, f.timbre, 0.06);
  }

  jackpot(): void {
    const steps = [0, 4, 7, 12, 16, 19, 24, 28, 31, 36];
    steps.forEach((s, i) => {
      const hz = 261.63 * Math.pow(2, s / 12);
      this.tone(hz, i * 0.075, 0.5, { gain: 0.11 });
      this.tone(hz * 2.01, i * 0.075, 0.25, { gain: 0.04 });
    });
    for (const s of [24, 28, 31, 36]) this.tone(261.63 * Math.pow(2, s / 12), 0.8, 1.6, { type: 'triangle', gain: 0.08, attack: 0.03 });
    this.noise(0.75, 1.4, { type: 'highpass', freq: 6000, gain: 0.05, attack: 0.1 });
  }
}
