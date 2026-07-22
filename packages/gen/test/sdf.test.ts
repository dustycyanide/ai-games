import { describe, expect, it } from 'vitest';
import {
  sphere,
  sBox,
  roundBox,
  capsule,
  torus,
  opUnion,
  opSmin,
  opSubtract,
  opIntersect,
  opTranslate,
  opScale,
  opDisplace,
  surfaceNets,
} from '../src/index';
import type { Sdf } from '../src/index';
import { expectIntegrity } from './helpers';

describe('sdf shape values', () => {
  it('sphere distance is exact', () => {
    const s = sphere(1);
    expect(s([2, 0, 0])).toBeCloseTo(1, 10);
    expect(s([0, 0, 0])).toBeCloseTo(-1, 10);
    expect(s([0, 1, 0])).toBeCloseTo(0, 10);
  });

  it('sBox is zero on faces, negative inside', () => {
    const s = sBox([1, 2, 3]);
    expect(s([1, 0, 0])).toBeCloseTo(0, 10);
    expect(s([0, 0, 0])).toBeLessThan(0);
    expect(s([3, 0, 0])).toBeCloseTo(2, 10);
  });

  it('roundBox grows the box by r', () => {
    const s = roundBox([1, 1, 1], 0.25);
    expect(s([1.25, 0, 0])).toBeCloseTo(0, 10);
  });

  it('capsule is a sphere at the endpoints', () => {
    const s = capsule([0, -1, 0], [0, 1, 0], 0.5);
    expect(s([0, 2, 0])).toBeCloseTo(0.5, 10);
    expect(s([0.5, 0, 0])).toBeCloseTo(0, 10);
  });

  it('torus zero on the ring', () => {
    const s = torus(2, 0.5);
    expect(s([2.5, 0, 0])).toBeCloseTo(0, 10);
    expect(s([2, 0.5, 0])).toBeCloseTo(0, 10);
  });

  it('combinators behave like min/max', () => {
    const a = sphere(1);
    const b = opTranslate(sphere(1), [3, 0, 0]);
    const p: [number, number, number] = [1.5, 0, 0];
    expect(opUnion(a, b)(p)).toBeCloseTo(Math.min(a(p), b(p)), 10);
    expect(opIntersect(a, b)(p)).toBeCloseTo(Math.max(a(p), b(p)), 10);
    expect(opSubtract(a, b)(p)).toBeCloseTo(Math.max(a(p), -b(p)), 10);
    // smin is <= plain min and equals it far from the blend region
    expect(opSmin(a, b, 0.2)(p)).toBeLessThanOrEqual(Math.min(a(p), b(p)) + 1e-12);
    expect(opSmin(a, b, 0.2)([10, 0, 0])).toBeCloseTo(opUnion(a, b)([10, 0, 0]), 6);
  });

  it('opScale corrects distances, opDisplace offsets them', () => {
    const s = opScale(sphere(1), 2);
    expect(s([4, 0, 0])).toBeCloseTo(2, 10);
    const d = opDisplace(sphere(1), () => 0.25);
    expect(d([1, 0, 0])).toBeCloseTo(0.25, 10);
  });
});

describe('surfaceNets', () => {
  const bounds = { min: [-2, -2, -2] as [number, number, number], max: [2, 2, 2] as [number, number, number] };

  it('meshes a sphere with integrity and sane radius', () => {
    const b = surfaceNets(sphere(1), bounds, 40);
    expectIntegrity(b, 'surfaceNets sphere');
    expect(b.indices.length).toBeGreaterThan(0);
    for (let i = 0; i < b.positions.length; i += 3) {
      const r = Math.hypot(b.positions[i], b.positions[i + 1], b.positions[i + 2]);
      expect(r).toBeGreaterThan(0.85);
      expect(r).toBeLessThan(1.15);
    }
  });

  it('triangle winding matches the SDF gradient normals (outward)', () => {
    const s: Sdf = opSmin(sphere(0.9), opTranslate(sphere(0.7), [0.8, 0.3, 0]), 0.3);
    const b = surfaceNets(s, bounds, 32);
    let agree = 0;
    let total = 0;
    const p = b.positions;
    const nrm = b.normals;
    for (let t = 0; t < b.indices.length; t += 3) {
      const i0 = b.indices[t] * 3;
      const i1 = b.indices[t + 1] * 3;
      const i2 = b.indices[t + 2] * 3;
      const ax = p[i1] - p[i0];
      const ay = p[i1 + 1] - p[i0 + 1];
      const az = p[i1 + 2] - p[i0 + 2];
      const bx = p[i2] - p[i0];
      const by = p[i2 + 1] - p[i0 + 1];
      const bz = p[i2 + 2] - p[i0 + 2];
      const fx = ay * bz - az * by;
      const fy = az * bx - ax * bz;
      const fz = ax * by - ay * bx;
      const len = Math.hypot(fx, fy, fz);
      if (len < 1e-12) continue; // rare degenerate surface-nets quad half
      const vx = (nrm[i0] + nrm[i1] + nrm[i2]) / 3;
      const vy = (nrm[i0 + 1] + nrm[i1 + 1] + nrm[i2 + 1]) / 3;
      const vz = (nrm[i0 + 2] + nrm[i1 + 2] + nrm[i2 + 2]) / 3;
      total++;
      if (fx * vx + fy * vy + fz * vz > 0) agree++;
    }
    expect(total).toBeGreaterThan(100);
    // Non-planar quads can split into one slightly-backfacing sliver; demand near-total agreement.
    expect(agree / total).toBeGreaterThan(0.99);
  });

  it('surface touching the bounds produces no NaNs', () => {
    const b = surfaceNets(sphere(2.5), bounds, 16); // sphere pokes out of the box
    expectIntegrity(b, 'clipped sphere');
  });

  it('empty field produces an empty bundle', () => {
    const b = surfaceNets(opTranslate(sphere(0.5), [10, 0, 0]), bounds, 8);
    expect(b.positions.length).toBe(0);
    expect(b.indices.length).toBe(0);
  });
});
