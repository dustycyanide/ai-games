/**
 * Boulder: a cluster of smin-blended spheres, roughed up with fbm displacement
 * and meshed by surface nets, with a flattened underside so it sits on the
 * ground. Seed drives the lump layout, noise character, and a subtle tint;
 * params control scale, roughness, and mesh density. Colors stay within the
 * toybox palette tolerance of the stone-blue anchor #8fb8d8.
 */

import { z } from 'zod';
import type { AssetModule, AssetOutput, GenContext, Vec3 } from '@ai-games/schema';
import { fbm3, opDisplace, opSmin, opSubtract, opTranslate, sphere, surfaceNets, type Sdf } from '@ai-games/gen';

/** Base stone color — the toybox anchor #8fb8d8 as 0..1 rgb. */
const STONE: Vec3 = [0.561, 0.722, 0.847];

const Params = z.object({
  size: z.number().min(0.5).max(2.5).default(1.2).describe('overall boulder radius in world units'),
  lumpiness: z.number().min(0).max(1).default(0.5).describe('strength of the fbm surface displacement'),
  resolution: z
    .number()
    .int()
    .min(16)
    .max(48)
    .default(26)
    .describe('surface-nets grid resolution (triangle count grows ~quadratically)'),
});

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function generate(ctx: GenContext, params: z.infer<typeof Params>): AssetOutput {
  const { size, lumpiness, resolution } = params;
  const blobs = ctx.rng.fork('blobs');
  const noiseSeed = ctx.rng.fork('noise').int(0x7fffffff);
  const tint = ctx.rng.fork('tint').range(-0.02, 0.02);

  // 1 core sphere + 2-4 satellite lumps, all smin-blended.
  let field: Sdf = sphere(size * blobs.range(0.62, 0.78));
  const lumps = 2 + blobs.int(3);
  for (let i = 0; i < lumps; i++) {
    const off: Vec3 = [
      size * blobs.range(-0.45, 0.45),
      size * blobs.range(-0.25, 0.35),
      size * blobs.range(-0.45, 0.45),
    ];
    field = opSmin(field, opTranslate(sphere(size * blobs.range(0.3, 0.55)), off), size * 0.35);
  }

  const amp = size * 0.16 * lumpiness;
  const freq = 1.7 / size;
  const rock = opDisplace(field, (p) => amp * fbm3(p[0] * freq, p[1] * freq, p[2] * freq, 3, noiseSeed));
  // Cut everything below y = -0.72 * size so the boulder has a sitting face.
  const seated = opSubtract(rock, (p) => p[1] + size * 0.72);

  const bound = size * 1.35;
  const geometry = surfaceNets(seated, { min: [-bound, -bound, -bound], max: [bound, bound, bound] }, resolution);

  // Per-vertex shading: lighter tops, fbm mottle, one per-boulder tint nudge.
  // Factors stay in ~[0.89, 1.05] so every color stays near the anchor.
  const vertCount = geometry.positions.length / 3;
  const colors = new Float32Array(vertCount * 3);
  const mottleFreq = 2.6 / size;
  for (let i = 0; i < vertCount; i++) {
    const px = geometry.positions[i * 3];
    const py = geometry.positions[i * 3 + 1];
    const pz = geometry.positions[i * 3 + 2];
    const upness = Math.max(0, geometry.normals[i * 3 + 1]);
    const mottle = fbm3(px * mottleFreq, py * mottleFreq, pz * mottleFreq, 2, noiseSeed + 1);
    const f = 0.92 + 0.1 * upness + 0.03 * mottle;
    colors[i * 3] = clamp01(STONE[0] * f + tint);
    colors[i * 3 + 1] = clamp01(STONE[1] * f + tint);
    colors[i * 3 + 2] = clamp01(STONE[2] * f + tint);
  }
  geometry.colors = colors;

  return { geometry };
}

export default {
  Params,
  meta: { name: 'Boulder', slug: 'boulder', capsule: 'toybox@0.1.0' },
  generate,
} satisfies AssetModule;
