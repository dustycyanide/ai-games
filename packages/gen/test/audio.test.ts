import { describe, expect, it } from 'vitest';
import { zzfxGenerate } from '../src/audio';

describe('zzfx sample generation', () => {
  it('produces finite samples in [-1, 1]-ish range', () => {
    // randomness = 0 so the run is deterministic (upstream jitters pitch via Math.random)
    const samples = zzfxGenerate(1, 0, 440, 0.01, 0.05, 0.1);
    expect(samples.length).toBeGreaterThan(1000);
    for (const s of samples) {
      expect(Number.isFinite(s)).toBe(true);
      expect(Math.abs(s)).toBeLessThanOrEqual(1.5);
    }
  });

  it('is deterministic with randomness disabled', () => {
    const a = zzfxGenerate(1, 0, 220, 0, 0.02, 0.05, 2, 1, 0.1);
    const b = zzfxGenerate(1, 0, 220, 0, 0.02, 0.05, 2, 1, 0.1);
    expect(a).toEqual(b);
  });

  it('handles the fancier params (filter, delay, bitcrush, repeat) without NaNs', () => {
    const samples = zzfxGenerate(1, 0, 330, 0.01, 0.1, 0.2, 1, 1.5, 0.2, 0.001, 100, 0.05, 0.1, 0.1, 10, 0.5, 0.05, 0.8, 0.05, 0.3, 500);
    for (const s of samples) expect(Number.isFinite(s)).toBe(true);
  });
});
