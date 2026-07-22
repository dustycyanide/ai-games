/**
 * Sound effects via ZzFX.
 *
 * The synthesis below is vendored from ZzFX - Zuper Zmall Zound Zynth,
 * copyright (c) 2019 Frank Force (KilledByAPixel), MIT License.
 * https://github.com/KilledByAPixel/ZzFX — ported to typed TS, same parameter
 * vector and sample math as upstream zzfxG/zzfxP.
 */

/** A ZzFX parameter vector: [volume, randomness, frequency, attack, sustain, release, ...]. */
export type SfxVector = number[];

const SAMPLE_RATE = 44100;
const MASTER_VOLUME = 0.3;

let sharedCtx: AudioContext | undefined;

function audioContext(): AudioContext {
  if (!sharedCtx) {
    if (typeof AudioContext === 'undefined') {
      throw new Error('zzfx: AudioContext is not available in this environment');
    }
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

/**
 * Generate the sample buffer for a ZzFX parameter vector (upstream zzfxG).
 * Pure DSP — exported for tests; use zzfx()/playSfx() for playback.
 */
export function zzfxGenerate(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
  filter = 0,
): number[] {
  const PI2 = Math.PI * 2;
  const sign = (v: number): number => (v < 0 ? -1 : 1);

  // Randomized pitch (upstream behavior: slight per-play variation).
  let startSlide = (slide *= (500 * PI2) / SAMPLE_RATE / SAMPLE_RATE);
  let startFrequency = (frequency *=
    ((1 + randomness * 2 * Math.random() - randomness) * PI2) / SAMPLE_RATE);

  // Biquad low/high-pass filter.
  const quality = 2;
  const w = (PI2 * Math.abs(filter) * 2) / SAMPLE_RATE;
  const cosW = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + (filter < 0 ? -cosW : cosW)) / 2 / a0;
  const b1 = ((filter < 0 ? 1 : -1) * (1 + cosW)) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  // Scale envelope segments to sample counts.
  attack = attack * SAMPLE_RATE + 9; // minimum attack to prevent pops
  decay *= SAMPLE_RATE;
  sustain *= SAMPLE_RATE;
  release *= SAMPLE_RATE;
  delay *= SAMPLE_RATE;
  deltaSlide *= (500 * PI2) / SAMPLE_RATE ** 3;
  modulation *= PI2 / SAMPLE_RATE;
  pitchJump *= PI2 / SAMPLE_RATE;
  pitchJumpTime *= SAMPLE_RATE;
  repeatTime = (repeatTime * SAMPLE_RATE) | 0;
  volume *= MASTER_VOLUME;

  const b: number[] = [];
  const length = (attack + decay + sustain + release + delay) | 0;
  let t = 0;
  let tm = 0;
  let j = 1;
  let r = 0;
  let c = 0;
  let s = 0;

  for (let i = 0; i < length; b[i++] = s * volume) {
    if (++c > bitCrush * 100) {
      c = 0;
      s = t * frequency * Math.sin(tm * modulation);
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? Math.sin(s * s) // 4: noise
              : Math.max(Math.min(Math.tan(s), 1), -1) // 3: tan
            : 1 - (((((2 * s) / PI2) % 2) + 2) % 2) // 2: saw
          : 1 - 4 * Math.abs(Math.round(s / PI2) - s / PI2) // 1: triangle
        : Math.sin(s); // 0: sin

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        sign(s) *
        Math.abs(s) ** shapeCurve *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);

      s = delay
        ? s / 2 +
          (delay > i
            ? 0
            : ((i < length - delay ? 1 : (length - i) / delay) * (b[(i - delay) | 0] ?? 0)) / 2 / volume)
        : s;

      if (filter) {
        y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
        s = y1;
      }
    }

    const f = (frequency += slide += deltaSlide) * Math.cos(modulation * tm++);
    t += f + f * noise * Math.sin(i ** 5);

    if (j && ++j > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      j = 0;
    }
    if (repeatTime && !(++r % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      j = j || 1;
    }
  }
  return b;
}

/** Queue samples for playback on the shared AudioContext (upstream zzfxP). */
function zzfxPlaySamples(samples: number[]): AudioBufferSourceNode {
  const ctx = audioContext();
  const buffer = ctx.createBuffer(1, Math.max(samples.length, 1), SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  return source;
}

/**
 * Vendored ZzFX synth. Builds a buffer from the parameter vector and plays it
 * on a lazily-created shared AudioContext; returns the source node.
 */
export function zzfx(...params: number[]): AudioBufferSourceNode {
  return zzfxPlaySamples(zzfxGenerate(...params));
}

/** Play a named SfxVector from AssetOutput.sfx. Thin wrapper over zzfx(). */
export function playSfx(params: number[]): void {
  zzfx(...params);
}
