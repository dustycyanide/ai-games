/**
 * Pine tree: a fat tube trunk that leans/twists along a seed-driven helix,
 * topped with layers of instanced flat-shaded foliage blobs. The blob bundle
 * carries no vertex colors so each Instance.color (jittered toybox mint) tints
 * its copy; the trunk gets vertex-colored toffee bark. Droop tips the ring
 * blobs outward-down and squashes them; twist bends the trunk path.
 */

import { z } from 'zod';
import type { AssetModule, AssetOutput, GenContext, Instance, Prng, Vec3 } from '@ai-games/schema';
import { flatShade, setColor, tube, uvSphere } from '@ai-games/gen';

/** Toybox anchors as 0..1 rgb: bark #9a6b4f, needles #a8d8a0. */
const BARK: Vec3 = [0.604, 0.42, 0.31];
const NEEDLE: Vec3 = [0.659, 0.847, 0.627];

const Params = z.object({
  height: z.number().min(1.2).max(4).default(2.4).describe('total tree height in world units'),
  foliageLayers: z.number().int().min(2).max(6).default(4).describe('stacked rings of foliage blobs'),
  droop: z.number().min(0).max(1).default(0.35).describe('how far branch blobs sag outward and down'),
  trunkTwist: z.number().min(0).max(1).default(0.3).describe('helical lean of the trunk path'),
});

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Needle green, lighter toward the top (t 0..1), with a small per-blob jitter. */
function needleShade(rng: Prng, t: number): Vec3 {
  const f = 0.9 + 0.1 * t;
  return [
    clamp01(NEEDLE[0] * f + rng.range(-0.04, 0.04)),
    clamp01(NEEDLE[1] * f + rng.range(-0.04, 0.04)),
    clamp01(NEEDLE[2] * f + rng.range(-0.04, 0.04)),
  ];
}

function generate(ctx: GenContext, params: z.infer<typeof Params>): AssetOutput {
  const { height, foliageLayers, droop, trunkTwist } = params;
  const trunkRng = ctx.rng.fork('trunk');
  const leanPhase = trunkRng.range(0, Math.PI * 2);

  // Lateral trunk offset at fraction t (0 = base, 1 = trunk top): a gentle
  // helix whose amplitude grows with height so the base stays planted.
  const wobble = (t: number): [number, number] => {
    const a = trunkTwist * height * 0.06 * t;
    const angle = leanPhase + t * (2 + trunkTwist * 4);
    return [Math.sin(angle) * a, Math.cos(angle) * a];
  };

  const trunkTop = height * 0.62;
  const rows = 8;
  const path: [number, number, number][] = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const [wx, wz] = wobble(t);
    path.push([wx, t * trunkTop, wz]);
  }
  const trunk = tube(path, Math.max(0.07, height * 0.048), 8);
  const barkF = trunkRng.range(0.94, 1.06);
  setColor(trunk, [clamp01(BARK[0] * barkF), clamp01(BARK[1] * barkF), clamp01(BARK[2] * barkF)]);

  // Foliage: rings of squashed blobs per layer + a crown blob, plus a tip.
  const blob = flatShade(uvSphere(1, 9));
  const fRng = ctx.rng.fork('foliage');
  const transforms: Instance[] = [];
  const maxR = height * 0.34;
  const baseY = height * 0.36;
  const topY = height * 0.92;
  for (let layer = 0; layer < foliageLayers; layer++) {
    const t = layer / (foliageLayers - 1);
    const layerY = baseY + t * (topY - baseY);
    const layerR = maxR * (1 - 0.72 * t);
    const [wx, wz] = wobble(Math.min(1, layerY / trunkTop));
    const ring = Math.max(3, Math.round(2 + 3.5 * (layerR / maxR)));
    const phase = fRng.range(0, Math.PI * 2);
    for (let i = 0; i < ring; i++) {
      const theta = phase + (i / ring) * Math.PI * 2;
      const rad = layerR * fRng.range(0.5, 0.62);
      const s = layerR * fRng.range(0.55, 0.68);
      transforms.push({
        position: [
          wx + Math.sin(theta) * rad + fRng.range(-0.04, 0.04) * height,
          layerY - droop * layerR * 0.45 + fRng.range(-0.03, 0.03) * height,
          wz + Math.cos(theta) * rad + fRng.range(-0.04, 0.04) * height,
        ],
        rotation: [droop * 0.7 + fRng.range(-0.15, 0.15), theta, fRng.range(-0.1, 0.1)],
        scale: [s, s * (0.62 - 0.18 * droop), s],
        color: needleShade(fRng, t),
      });
    }
    transforms.push({
      position: [wx, layerY + layerR * 0.18, wz],
      rotation: [0, phase, 0],
      scale: [layerR * 0.62, layerR * 0.42, layerR * 0.62],
      color: needleShade(fRng, t),
    });
  }
  const [tx, tz] = wobble(1);
  transforms.push({
    position: [tx, topY + maxR * 0.16, tz],
    rotation: [0, 0, 0],
    scale: [maxR * 0.2, maxR * 0.3, maxR * 0.2],
    color: needleShade(fRng, 1),
  });

  return { geometry: trunk, instances: [{ bundle: blob, transforms }] };
}

export default {
  Params,
  meta: { name: 'Pine Tree', slug: 'pine-tree', capsule: 'toybox@0.1.0' },
  generate,
} satisfies AssetModule;
