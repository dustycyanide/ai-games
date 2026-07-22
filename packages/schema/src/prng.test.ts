import { describe, expect, it } from 'vitest';
import { makePrng, type Prng } from './prng';

function sequence(p: Prng, n: number): number[] {
  return Array.from({ length: n }, () => p.next());
}

describe('makePrng (pcg32)', () => {
  it('is deterministic: same seed -> identical stream', () => {
    expect(sequence(makePrng(1234), 64)).toEqual(sequence(makePrng(1234), 64));
  });

  it('matches golden values (locks the algorithm across refactors)', () => {
    // Regenerate only if the PRNG algorithm intentionally changes — doing so
    // invalidates every finalized asset lockfile.
    expect(sequence(makePrng(42), 5)).toEqual([
      0.7615582845173776, 0.41808728338219225, 0.4481155041139573,
      0.2661335177253932, 0.9597071812022477,
    ]);
    expect(sequence(makePrng(7), 5)).toEqual([
      0.29650168656371534, 0.9781919633969665, 0.40990554774180055,
      0.8873633835464716, 0.1464963173493743,
    ]);
    expect(sequence(makePrng(42).fork('leaves'), 5)).toEqual([
      0.16397585417144, 0.5410862143617123, 0.8280865477863699,
      0.1337376448791474, 0.5473251598887146,
    ]);
  });

  it('produces different streams for different seeds', () => {
    expect(sequence(makePrng(1), 16)).not.toEqual(sequence(makePrng(2), 16));
  });

  it('fork(label) is position-independent on the parent', () => {
    const parent = makePrng(42);
    parent.next();
    parent.next();
    parent.next();
    const forkAfterDraws = parent.fork('leaves');
    const forkFresh = makePrng(42).fork('leaves');
    expect(sequence(forkAfterDraws, 16)).toEqual(sequence(forkFresh, 16));
  });

  it('fork does not perturb the parent stream', () => {
    const a = makePrng(7);
    const b = makePrng(7);
    a.fork('anything');
    expect(sequence(a, 16)).toEqual(sequence(b, 16));
  });

  it('forks with different labels are independent, and differ from the parent', () => {
    const root = makePrng(99);
    const x = sequence(makePrng(99).fork('x'), 16);
    const y = sequence(makePrng(99).fork('y'), 16);
    expect(x).not.toEqual(y);
    expect(x).not.toEqual(sequence(root, 16));
  });

  it('nested forks are deterministic', () => {
    const a = makePrng(5).fork('a').fork('b');
    const b = makePrng(5).fork('a').fork('b');
    expect(sequence(a, 8)).toEqual(sequence(b, 8));
  });

  it('next() stays in [0, 1)', () => {
    const p = makePrng(0);
    for (let i = 0; i < 10_000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) stays in [0, n) and hits every bucket eventually', () => {
    const p = makePrng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = p.int(5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('range(a, b) stays in [a, b)', () => {
    const p = makePrng(13);
    for (let i = 0; i < 1000; i++) {
      const v = p.range(-2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  it('pick returns elements of the array and throws on empty', () => {
    const p = makePrng(17);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(p.pick(arr));
    }
    expect(() => p.pick([])).toThrow('empty');
  });

  it('coerces float and negative seeds deterministically', () => {
    expect(sequence(makePrng(3.9), 4)).toEqual(sequence(makePrng(3), 4));
    expect(sequence(makePrng(-1), 4)).toEqual(sequence(makePrng(0xffffffff), 4));
  });
});
