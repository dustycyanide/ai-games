import { describe, expect, it } from 'vitest';
import { plane, box, uvSphere, computeNormals, flatShade, merge, transform, setColor } from '../src/index';
import { expectIntegrity } from './helpers';

describe('ops', () => {
  it('computeNormals recovers +Y on a plane', () => {
    const b = plane(2, 2, 3);
    b.normals.fill(0);
    computeNormals(b);
    expectIntegrity(b, 'computeNormals plane');
    for (let i = 0; i < b.normals.length; i += 3) {
      expect(b.normals[i + 1]).toBeCloseTo(1, 5);
    }
  });

  it('computeNormals approximates radial normals on a sphere', () => {
    const b = uvSphere(1, 24);
    const exact = b.normals.slice();
    b.normals.fill(0);
    computeNormals(b);
    // Vertices no triangle references (dup pole/seam corners) keep the arbitrary
    // fallback normal — only judge vertices that actually influence shading.
    const referenced = new Set<number>(b.indices);
    let worst = 0;
    for (const v of referenced) {
      const i = v * 3;
      const dot = b.normals[i] * exact[i] + b.normals[i + 1] * exact[i + 1] + b.normals[i + 2] * exact[i + 2];
      worst = Math.max(worst, 1 - dot);
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('flatShade unindexes and yields unit face normals', () => {
    const b = flatShade(box(1, 1, 1, { bevel: 0.1 }));
    expectIntegrity(b, 'flatShade');
    expect(b.positions.length).toBe(b.indices.length * 3);
    // every triangle's three normals identical
    for (let t = 0; t < b.indices.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        expect(b.normals[t * 3 + 3 + k]).toBe(b.normals[t * 3 + k]);
        expect(b.normals[t * 3 + 6 + k]).toBe(b.normals[t * 3 + k]);
      }
    }
  });

  it('merge concatenates and offsets indices', () => {
    const a = box(1, 1, 1);
    const b = uvSphere(0.5, 8);
    const m = merge(a, b);
    expectIntegrity(m, 'merge');
    expect(m.positions.length).toBe(a.positions.length + b.positions.length);
    expect(m.indices.length).toBe(a.indices.length + b.indices.length);
    const aVerts = a.positions.length / 3;
    for (let i = a.indices.length; i < m.indices.length; i++) {
      expect(m.indices[i]).toBe(b.indices[i - a.indices.length] + aVerts);
    }
  });

  it('merge drops uvs when any input lacks them', () => {
    const a = box(1, 1, 1);
    const noUv = box(1, 1, 1);
    delete noUv.uvs;
    expect(merge(a, noUv).uvs).toBeUndefined();
    expect(merge(a, box(1, 1, 1)).uvs).toBeDefined();
  });

  it('transform applies scale -> rotation -> translation and keeps normals unit', () => {
    const b = plane(2, 2, 1);
    transform(b, { position: [1, 2, 3], rotation: [Math.PI / 2, 0, 0], scale: [2, 1, 3] });
    expectIntegrity(b, 'transform');
    // rotating the XZ plane by +90deg about X sends +Y normals to +Z
    for (let i = 0; i < b.normals.length; i += 3) {
      expect(b.normals[i + 2]).toBeCloseTo(1, 4);
    }
    // center vertex ended up at the translation
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const n = b.positions.length / 3;
    for (let i = 0; i < b.positions.length; i += 3) {
      cx += b.positions[i] / n;
      cy += b.positions[i + 1] / n;
      cz += b.positions[i + 2] / n;
    }
    expect(cx).toBeCloseTo(1, 5);
    expect(cy).toBeCloseTo(2, 5);
    expect(cz).toBeCloseTo(3, 5);
  });

  it('setColor fills a colors array of the right shape', () => {
    const b = setColor(box(1, 1, 1), [0.2, 0.4, 0.6]);
    expectIntegrity(b, 'setColor');
    expect(b.colors).toBeDefined();
    expect(b.colors?.length).toBe(b.positions.length);
    expect(b.colors?.[0]).toBeCloseTo(0.2, 6);
    expect(b.colors?.[1]).toBeCloseTo(0.4, 6);
    expect(b.colors?.[2]).toBeCloseTo(0.6, 6);
  });
});
