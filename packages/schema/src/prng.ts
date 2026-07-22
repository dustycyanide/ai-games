/**
 * Deterministic PRNG for asset generation, based on PCG32 (XSH-RR variant,
 * O'Neill 2014). Same seed -> identical stream on every platform; the 64-bit
 * state arithmetic uses BigInt, which is exact and portable.
 *
 * Fork semantics: `fork(label)` derives an independent sub-stream by hashing
 * the label together with the prng's *base seed* (fnv1a + avalanche). Forking
 * is position-independent — `makePrng(s).fork("trees")` yields the same stream
 * no matter how many draws happened on the parent first — and never consumes
 * or perturbs the parent stream. Same label twice -> same stream (by design:
 * label collisions are correlated streams, so pick distinct labels).
 *
 * Seeds are coerced to uint32 via truncation; pass integers.
 */

export interface Prng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [a, b). */
  range(a: number, b: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Independent sub-stream derived from the base seed + label. */
  fork(label: string): Prng;
}

const MUL = 6364136223846793005n;
const MASK64 = (1n << 64n) - 1n;
// Fixed default stream constant (pcg32 reference initseq), pre-shifted to odd.
const INC = ((721347520444481703n << 1n) | 1n) & MASK64;

function normalizeSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

/** pcg32_srandom: state = 0; step; state += seed; step. */
function initState(seed: number): { state: bigint } {
  const s = { state: 0n };
  stepOutput(s); // advance once with state 0
  s.state = (s.state + BigInt(seed)) & MASK64;
  stepOutput(s);
  return s;
}

/** Advance the LCG one step and return the 32-bit XSH-RR output of the OLD state. */
function stepOutput(s: { state: bigint }): number {
  const old = s.state;
  s.state = (old * MUL + INC) & MASK64;
  const xorshifted = Number(BigInt.asUintN(32, ((old >> 18n) ^ old) >> 27n));
  const rot = Number(old >> 59n);
  return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
}

/** fnv1a over the label, xor-folded with the seed, finished with a murmur3 avalanche. */
function forkSeed(baseSeed: number, label: string): number {
  let h = (0x811c9dc5 ^ baseSeed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function makePrng(seed: number): Prng {
  const baseSeed = normalizeSeed(seed);
  const s = initState(baseSeed);

  const prng: Prng = {
    next: () => stepOutput(s) / 0x1_0000_0000,
    int: (n) => Math.floor(prng.next() * n),
    range: (a, b) => a + prng.next() * (b - a),
    pick: (arr) => {
      if (arr.length === 0) throw new Error('Prng.pick: empty array');
      return arr[prng.int(arr.length)];
    },
    fork: (label) => makePrng(forkSeed(baseSeed, label)),
  };
  return prng;
}
