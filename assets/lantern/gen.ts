/**
 * Lantern: a beveled wooden base, a barrel-lathe glass body whose warm color
 * mixes from amber toward cream as `glow` rises, plum tube ribs hugging the
 * body profile, a cone-lathe cap with an amber knob, and a fat tube handle
 * swung to a seed-driven azimuth. Everything merges into one vertex-colored
 * geometry; all colors track the toybox anchors.
 */

import { z } from 'zod';
import type { AssetModule, AssetOutput, GenContext, GeometryBundle, Vec3 } from '@ai-games/schema';
import { box, cylinder, lathe, merge, setColor, transform, tube, uvSphere } from '@ai-games/gen';

/** Toybox anchors as 0..1 rgb. */
const CREAM: Vec3 = [0.965, 0.906, 0.784];
const AMBER: Vec3 = [0.949, 0.71, 0.42];
const WOOD: Vec3 = [0.604, 0.42, 0.31];
const FRAME: Vec3 = [0.361, 0.29, 0.4];

const Params = z.object({
  height: z.number().min(1).max(2.5).default(1.6).describe('total lantern height in world units'),
  ribs: z.number().int().min(2).max(8).default(4).describe('horizontal frame rings around the glass body'),
  glow: z.number().min(0).max(1).default(0.7).describe('warmth of the body: 0 deep amber, 1 bright cream'),
});

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const shade = (c: Vec3, f: number): Vec3 => [clamp01(c[0] * f), clamp01(c[1] * f), clamp01(c[2] * f)];

/** Closed horizontal circle path for tube() (last point repeats the first). */
function circlePath(radius: number, y: number, n: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    pts.push([Math.sin(th) * radius, y, Math.cos(th) * radius]);
  }
  return pts;
}

function generate(ctx: GenContext, params: z.infer<typeof Params>): AssetOutput {
  const { height, ribs, glow } = params;
  const rng = ctx.rng.fork('lantern');

  const baseH = height * 0.12;
  const baseW = height * 0.5;
  const bodyR = height * 0.27;
  const bodyH = height * 0.56;
  const y0 = baseH;
  const y1 = y0 + bodyH;
  const bodyProfileR = (t: number): number => bodyR * (0.45 + 0.55 * Math.sin(Math.PI * t));

  const parts: GeometryBundle[] = [];

  // Base: chunky beveled block.
  const base = transform(box(baseW, baseH, baseW, { bevel: height * 0.03 }), { position: [0, baseH / 2, 0] });
  parts.push(setColor(base, shade(WOOD, rng.range(0.96, 1.04))));

  // Body: barrel lathe, warm emissive-ish color driven by glow.
  const profile: [number, number][] = [];
  const profileRows = 10;
  for (let i = 0; i < profileRows; i++) {
    const t = i / (profileRows - 1);
    profile.push([bodyProfileR(t), y0 + t * bodyH]);
  }
  const glowColor = mix(AMBER, CREAM, glow * 0.6);
  parts.push(setColor(lathe(profile, 14), glowColor));

  // Ribs: plum tube rings following the body profile, with tiny radius jitter.
  for (let i = 0; i < ribs; i++) {
    const t = (i + 1) / (ribs + 1);
    const r = (bodyProfileR(t) + height * 0.015) * rng.range(0.99, 1.01);
    const ring = tube(circlePath(r, y0 + t * bodyH, 16), height * 0.03, 6);
    parts.push(setColor(ring, shade(FRAME, rng.range(0.96, 1.06))));
  }

  // Cap: squat cone with an amber knob on top.
  const cap = transform(cylinder(height * 0.07, bodyR * 0.72, height * 0.14, 12), {
    position: [0, y1 + height * 0.07, 0],
  });
  parts.push(setColor(cap, shade(WOOD, rng.range(0.96, 1.04))));
  const knob = transform(uvSphere(height * 0.055, 8), { position: [0, y1 + height * 0.17, 0] });
  parts.push(setColor(knob, mix(AMBER, CREAM, glow * 0.3)));

  // Handle: near-semicircle arc over the knob, spun to a seed-driven azimuth.
  const handleR = height * 0.16;
  const handleY = y1 + height * 0.17;
  const arc: [number, number, number][] = [];
  const arcPts = 9;
  for (let i = 0; i < arcPts; i++) {
    const th = 0.08 * Math.PI + (i / (arcPts - 1)) * 0.84 * Math.PI;
    arc.push([Math.cos(th) * handleR, handleY + Math.sin(th) * handleR, 0]);
  }
  const handle = transform(tube(arc, height * 0.028, 6), { rotation: [0, rng.range(0, Math.PI * 2), 0] });
  parts.push(setColor(handle, shade(FRAME, rng.range(0.96, 1.06))));

  return { geometry: merge(...parts), motion: { glow } };
}

export default {
  Params,
  meta: { name: 'Lantern', slug: 'lantern', capsule: 'toybox@0.1.0' },
  generate,
} satisfies AssetModule;
