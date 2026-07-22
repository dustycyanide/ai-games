import { describe, expect, it } from 'vitest';
import { plane, box, uvSphere, cylinder, lathe, extrude, tube } from '../src/index';
import type { GeometryBundle } from '@ai-games/schema';
import { expectIntegrity } from './helpers';

const hexShape: [number, number][] = Array.from({ length: 6 }, (_, i) => {
  const a = (2 * Math.PI * i) / 6;
  return [Math.cos(a), Math.sin(a)] as [number, number];
});

const cases: [string, () => GeometryBundle][] = [
  ['plane', () => plane(2, 3, 4)],
  ['box sharp', () => box(1, 2, 3)],
  ['box beveled', () => box(1, 2, 3, { bevel: 0.15 })],
  ['box bevel clamped', () => box(1, 2, 3, { bevel: 99 })],
  ['uvSphere', () => uvSphere(1.5, 12)],
  ['cylinder', () => cylinder(0.5, 0.8, 2, 12)],
  ['cone (rTop=0)', () => cylinder(0, 0.8, 2, 12)],
  ['inverted cone (rBottom=0)', () => cylinder(0.8, 0, 2, 12)],
  [
    'lathe',
    () =>
      lathe(
        [
          [0.2, -1],
          [0.6, -0.4],
          [0.5, 0.3],
          [0.1, 1],
        ],
        10,
      ),
  ],
  ['extrude', () => extrude(hexShape, 0.5)],
  ['extrude uncapped', () => extrude(hexShape, 0.5, { cap: false })],
  [
    'tube',
    () =>
      tube(
        [
          [0, 0, 0],
          [0, 1, 0],
          [0.5, 2, 0.5],
          [1, 2.5, 1.5],
        ],
        0.2,
        8,
      ),
  ],
];

describe('primitive integrity', () => {
  for (const [label, make] of cases) {
    it(label, () => {
      const b = make();
      expectIntegrity(b, label);
      expect(b.indices.length).toBeGreaterThan(0);
      expect(b.uvs).toBeDefined();
    });
  }
});

/** Signed volume via the divergence theorem: positive iff winding is CCW-outward. */
function signedVolume(b: GeometryBundle): number {
  let vol = 0;
  const p = b.positions;
  for (let t = 0; t < b.indices.length; t += 3) {
    const a = b.indices[t] * 3;
    const c = b.indices[t + 1] * 3;
    const d = b.indices[t + 2] * 3;
    vol +=
      (p[a] * (p[c + 1] * p[d + 2] - p[c + 2] * p[d + 1]) +
        p[a + 1] * (p[c + 2] * p[d] - p[c] * p[d + 2]) +
        p[a + 2] * (p[c] * p[d + 1] - p[c + 1] * p[d])) /
      6;
  }
  return vol;
}

describe('winding is CCW-outward (positive enclosed volume)', () => {
  const closed: [string, () => GeometryBundle, number][] = [
    ['box', () => box(1, 1, 1), 1],
    ['box beveled', () => box(1, 1, 1, { bevel: 0.1 }), 0.9],
    ['uvSphere', () => uvSphere(1, 24), (4 / 3) * Math.PI * 0.95],
    ['cylinder', () => cylinder(0.5, 0.5, 2, 32), Math.PI * 0.25 * 2 * 0.95],
    ['cone', () => cylinder(0, 1, 3, 32), (Math.PI * 3) / 3 - 0.4],
    ['extrude hex', () => extrude(hexShape, 1), 2.598 * 0.99],
    [
      'tube',
      () =>
        tube(
          [
            [0, 0, 0],
            [0, 2, 0],
          ],
          0.5,
          32,
        ),
      Math.PI * 0.25 * 2 * 0.9,
    ],
  ];
  for (const [label, make, atLeast] of closed) {
    it(label, () => {
      const v = signedVolume(make());
      expect(v, `${label}: signed volume`).toBeGreaterThan(atLeast * 0.9);
    });
  }

  it('plane faces +Y', () => {
    const b = plane(2, 2, 1);
    const p = b.positions;
    const [i0, i1, i2] = [b.indices[0] * 3, b.indices[1] * 3, b.indices[2] * 3];
    const ny =
      (p[i1 + 2] - p[i0 + 2]) * (p[i2] - p[i0]) - (p[i1] - p[i0]) * (p[i2 + 2] - p[i0 + 2]);
    expect(ny).toBeGreaterThan(0);
  });
});

describe('primitive shape checks', () => {
  it('uvSphere vertices lie on the sphere and normals point radially', () => {
    const r = 1.5;
    const b = uvSphere(r, 16);
    for (let i = 0; i < b.positions.length; i += 3) {
      const len = Math.hypot(b.positions[i], b.positions[i + 1], b.positions[i + 2]);
      expect(Math.abs(len - r)).toBeLessThan(1e-5);
      // normal parallel to position
      const dot =
        (b.positions[i] * b.normals[i] +
          b.positions[i + 1] * b.normals[i + 1] +
          b.positions[i + 2] * b.normals[i + 2]) /
        len;
      expect(dot).toBeCloseTo(1, 5);
    }
  });

  it('lathe throws on a too-short profile', () => {
    expect(() => lathe([[1, 0]])).toThrow();
  });

  it('extrude throws on a degenerate shape', () => {
    expect(() =>
      extrude(
        [
          [0, 0],
          [1, 0],
        ],
        1,
      ),
    ).toThrow();
  });

  it('tube throws on a single-point path', () => {
    expect(() => tube([[0, 0, 0]], 0.5)).toThrow();
  });
});
