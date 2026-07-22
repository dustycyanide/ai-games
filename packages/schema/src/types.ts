/**
 * Runtime data contracts shared by every package. Pure types — no zod here so
 * hot paths (generators, renderer) never pay validation costs; the zod side
 * lives in schemas.ts and covers the JSON files (manifest, record, lockfile).
 */

import type { Prng } from './prng';

export type Vec3 = [number, number, number];

/**
 * Interleaving-free geometry: parallel typed arrays, always indexed.
 * positions/normals are xyz triples, uvs are uv pairs, colors are rgb triples
 * (0..1). Lengths must agree: positions.length === normals.length, and
 * uvs/colors (when present) describe the same vertex count.
 */
export interface GeometryBundle {
  positions: Float32Array;
  normals: Float32Array;
  uvs?: Float32Array;
  colors?: Float32Array;
  indices: Uint32Array;
}

/** One placement of a bundle. rotation is euler XYZ in radians; color tints (0..1 rgb). */
export interface Instance {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color?: Vec3;
}

/**
 * A procedural texture described as WGSL. `wgslBody` is the body of a fragment
 * function producing a vec4f from `uv: vec2f` plus a uniform struct holding
 * `params` (one f32 per key, sorted by key name — do not rely on insertion
 * order). Baked offscreen by
 * @ai-games/core `bake()` into an rgba8unorm texture of `size` x `size`.
 */
export interface TextureRecipe {
  id: string;
  size: number;
  wgslBody: string;
  params: Record<string, number>;
}

/** Everything an asset generator may produce. All fields optional; emit what applies. */
export interface AssetOutput {
  geometry?: GeometryBundle;
  instances?: { bundle: GeometryBundle; transforms: Instance[] }[];
  textures?: TextureRecipe[];
  /** Named ZzFX parameter vectors. */
  sfx?: Record<string, number[]>;
  /** Named scalar motion parameters (spring stiffness, bob amplitude, ...). */
  motion?: Record<string, number>;
}

/** Passed to every generator. `rng` is already seeded with `seed`; fork it per feature. */
export interface GenContext {
  seed: number;
  rng: Prng;
}
