/**
 * Seedable CPU noise. All functions are pure and deterministic: the seed
 * selects a permutation/hash basis, so the same (coords, seed) always returns
 * the same value on every platform (no Math.random, no trig-precision tricks).
 * simplex* return roughly [-1, 1]; worley2 returns distance-to-nearest-feature
 * in [0, ~1.5]; fbm* sum `octaves` octaves with 0.5 gain / 2.0 lacunarity.
 *
 * Simplex noise after Stefan Gustavson's public-domain reference
 * implementation, with the permutation table shuffled by the seeded Prng.
 */

import { makePrng } from '@ai-games/schema';

const permCache = new Map<number, Uint8Array>();

/** 512-entry doubled permutation table, Fisher-Yates shuffled from the seed. */
function permTable(seed: number): Uint8Array {
  const key = Math.trunc(seed) >>> 0;
  const cached = permCache.get(key);
  if (cached) return cached;
  const rng = makePrng(key);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  if (permCache.size > 64) permCache.clear(); // seeds are few in practice; keep it bounded
  permCache.set(key, p);
  return p;
}

const GRAD2: readonly [number, number][] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const GRAD3: readonly [number, number, number][] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
];

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

export function simplex2(x: number, y: number, seed: number): number {
  const perm = permTable(seed);
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = 1 - i1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let total = 0;
  const cornerData: readonly [number, number, number][] = [
    [x0, y0, perm[ii + perm[jj]]],
    [x1, y1, perm[ii + i1 + perm[jj + j1]]],
    [x2, y2, perm[ii + 1 + perm[jj + 1]]],
  ];
  for (const [cx, cy, hash] of cornerData) {
    let tt = 0.5 - cx * cx - cy * cy;
    if (tt < 0) continue;
    tt *= tt;
    const g = GRAD2[hash & 7];
    total += tt * tt * (g[0] * cx + g[1] * cy);
  }
  return 70 * total;
}

export function simplex3(x: number, y: number, z: number, seed: number): number {
  const perm = permTable(seed);
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);
  // Rank the simplex corner offsets.
  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else {
    if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
    else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  }
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  const corners: readonly [number, number, number, number][] = [
    [x0, y0, z0, perm[ii + perm[jj + perm[kk]]]],
    [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]]],
    [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]]],
    [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]]],
  ];
  let total = 0;
  for (const [cx, cy, cz, hash] of corners) {
    let tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt < 0) continue;
    tt *= tt;
    const g = GRAD3[hash % 12];
    total += tt * tt * (g[0] * cx + g[1] * cy + g[2] * cz);
  }
  return 32 * total;
}

export function fbm2(x: number, y: number, octaves: number, seed: number): number {
  const oct = Math.max(1, Math.floor(octaves));
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * simplex2(x * freq, y * freq, seed + o);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export function fbm3(x: number, y: number, z: number, octaves: number, seed: number): number {
  const oct = Math.max(1, Math.floor(octaves));
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * simplex3(x * freq, y * freq, z * freq, seed + o);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Integer cell hash -> two uniform floats in [0, 1) for the feature point. */
function cellFeature(ix: number, iy: number, seed: number): [number, number] {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(Math.trunc(seed) | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const a = (h >>> 16) / 0x10000;
  const b = (h & 0xffff) / 0x10000;
  return [a, b];
}

export function worley2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = Infinity;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [ox, oy] = cellFeature(ix + i, iy + j, seed);
      const dx = i + ox - fx;
      const dy = j + oy - fy;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Self-contained WGSL snippets (no bindings, no entry points) declaring:
 *   simplex: fn snoise2(p: vec2f) -> f32
 *   fbm:     fn fbm2(p: vec2f, octaves: i32) -> f32   (requires simplex snippet)
 *   worley:  fn worley2(p: vec2f) -> f32
 * Concatenate the needed snippets ahead of a TextureRecipe wgslBody. They need
 * not match the CPU versions bit-for-bit, only in character.
 */
export const wgslNoise: { simplex: string; fbm: string; worley: string } = {
  // 2D simplex noise after Ashima Arts / Stefan Gustavson webgl-noise (MIT), ported to WGSL.
  simplex: /* wgsl */ `
fn sn2_mod289_v2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn sn2_mod289_v3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn sn2_permute(x: vec3f) -> vec3f { return sn2_mod289_v3(((x * 34.0) + 10.0) * x); }
fn snoise2(v: vec2f) -> f32 {
  let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);
  var i1 = vec2f(0.0, 1.0);
  if (x0.x > x0.y) { i1 = vec2f(1.0, 0.0); }
  var x12 = x0.xyxy + C.xxzz;
  x12 = vec4f(x12.xy - i1, x12.zw);
  i = sn2_mod289_v2(i);
  let p = sn2_permute(sn2_permute(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
  var m = max(vec3f(0.5) - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
  m = m * m;
  m = m * m;
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.yz * x12.xz + h.yz * x12.yw);
  return 130.0 * dot(m, g);
}
`,
  // Requires the simplex snippet (snoise2) to be concatenated first.
  fbm: /* wgsl */ `
fn fbm2(p: vec2f, octaves: i32) -> f32 {
  var sum = 0.0;
  var amp = 1.0;
  var freq = 1.0;
  var norm = 0.0;
  for (var o = 0; o < octaves; o++) {
    sum += amp * snoise2(p * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / max(norm, 1e-6);
}
`,
  worley: /* wgsl */ `
fn wor2_hash(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453123);
}
fn worley2(p: vec2f) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  var best = 1e9;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let o = wor2_hash(ip + g);
      best = min(best, length(g + o - fp));
    }
  }
  return best;
}
`,
};
