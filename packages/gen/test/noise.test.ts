import { describe, expect, it } from 'vitest';
import { simplex2, simplex3, fbm2, fbm3, worley2, wgslNoise } from '../src/index';

describe('noise seedability', () => {
  it('same seed -> same values, across repeated calls', () => {
    for (let i = 0; i < 50; i++) {
      const x = i * 0.37 - 3;
      const y = i * 0.91 + 1;
      expect(simplex2(x, y, 42)).toBe(simplex2(x, y, 42));
      expect(simplex3(x, y, x + y, 42)).toBe(simplex3(x, y, x + y, 42));
      expect(fbm2(x, y, 4, 42)).toBe(fbm2(x, y, 4, 42));
      expect(fbm3(x, y, x - y, 4, 42)).toBe(fbm3(x, y, x - y, 4, 42));
      expect(worley2(x, y, 42)).toBe(worley2(x, y, 42));
    }
  });

  it('different seeds -> different fields', () => {
    const differs = (f: (seed: number) => number): boolean => {
      for (let i = 0; i < 20; i++) {
        if (f(1) !== f(2)) return true;
      }
      return false;
    };
    let d2 = false;
    let d3 = false;
    let dw = false;
    for (let i = 0; i < 20 && !(d2 && d3 && dw); i++) {
      const x = i * 0.61 + 0.13;
      const y = i * 0.29 - 0.7;
      d2 ||= simplex2(x, y, 1) !== simplex2(x, y, 2);
      d3 ||= simplex3(x, y, 0.5, 1) !== simplex3(x, y, 0.5, 2);
      dw ||= worley2(x, y, 1) !== worley2(x, y, 2);
    }
    expect(d2).toBe(true);
    expect(d3).toBe(true);
    expect(dw).toBe(true);
    void differs;
  });

  it('value ranges are sane', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i % 25) * 0.483 - 6;
      const y = Math.floor(i / 25) * 0.377 - 4;
      const s2 = simplex2(x, y, 7);
      const s3 = simplex3(x, y, 0.33, 7);
      const f2 = fbm2(x, y, 5, 7);
      const w = worley2(x, y, 7);
      expect(Math.abs(s2)).toBeLessThanOrEqual(1.05);
      expect(Math.abs(s3)).toBeLessThanOrEqual(1.05);
      expect(Math.abs(f2)).toBeLessThanOrEqual(1.05);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1.6);
      expect(Number.isFinite(fbm3(x, y, 0.5, 3, 7))).toBe(true);
    }
  });

  it('noise is not constant', () => {
    const vals = new Set<number>();
    for (let i = 0; i < 30; i++) vals.add(simplex2(i * 0.71, i * 0.37, 9));
    expect(vals.size).toBeGreaterThan(10);
  });

  it('wgsl snippets declare the documented functions', () => {
    expect(wgslNoise.simplex).toContain('fn snoise2(');
    expect(wgslNoise.fbm).toContain('fn fbm2(');
    expect(wgslNoise.worley).toContain('fn worley2(');
    // no stray entry points or bindings — must be concatenation-safe
    for (const snippet of Object.values(wgslNoise)) {
      expect(snippet).not.toContain('@group');
      expect(snippet).not.toContain('@fragment');
    }
  });
});
