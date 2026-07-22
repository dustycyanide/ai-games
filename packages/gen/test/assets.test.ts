/**
 * End-to-end checks for the shipped assets against the toybox capsule: every
 * asset generates from its saved asset.json record, is byte-deterministic,
 * varies with the seed, and passes capsule validate(). Also exercises the
 * validator's negative paths (budget + palette violations).
 */

import { describe, expect, it } from 'vitest';
import {
  AssetRecordSchema,
  CapsuleManifestSchema,
  makePrng,
  type AssetModule,
  type AssetOutput,
} from '@ai-games/schema';
import { expectIntegrity } from './helpers';
import toybox from '../../../capsules/toybox/capsule';
import manifestJson from '../../../capsules/toybox/capsule.json';
import boulder from '../../../assets/boulder/gen';
import boulderRecord from '../../../assets/boulder/asset.json';
import pineTree from '../../../assets/pine-tree/gen';
import pineRecord from '../../../assets/pine-tree/asset.json';
import lantern from '../../../assets/lantern/gen';
import lanternRecord from '../../../assets/lantern/asset.json';

const manifest = CapsuleManifestSchema.parse(manifestJson);

const cases: { slug: string; module: AssetModule; record: unknown }[] = [
  { slug: 'boulder', module: boulder, record: boulderRecord },
  { slug: 'pine-tree', module: pineTree, record: pineRecord },
  { slug: 'lantern', module: lantern, record: lanternRecord },
];

function run(module: AssetModule, seed: number, params: unknown): AssetOutput {
  return module.generate({ seed, rng: makePrng(seed) }, params);
}

describe.each(cases)('asset $slug', ({ slug, module, record }) => {
  const rec = AssetRecordSchema.parse(record);
  const params: unknown = module.Params.parse(rec.params);

  it('asset.json matches meta.capsule, the manifest, and the Params defaults', () => {
    expect(module.meta.slug).toBe(slug);
    expect(rec.capsule).toBe(module.meta.capsule);
    expect(rec.capsule).toBe(`${manifest.meta.id}@${manifest.meta.version}`);
    expect(rec.params).toEqual(module.Params.parse({}));
  });

  it('generates a structurally sound output', () => {
    const out = run(module, rec.seed, params);
    expect(out.geometry !== undefined || (out.instances ?? []).length > 0).toBe(true);
    if (out.geometry !== undefined) expectIntegrity(out.geometry, `${slug} geometry`);
    for (const [i, group] of (out.instances ?? []).entries()) {
      expectIntegrity(group.bundle, `${slug} instances[${i}]`);
      expect(group.transforms.length, `${slug} instances[${i}] transforms`).toBeGreaterThan(0);
    }
  });

  it('is byte-deterministic across two runs', () => {
    const a = run(module, rec.seed, params);
    const b = run(module, rec.seed, params);
    expect(b).toEqual(a);
  });

  it('varies with the seed', () => {
    const a = run(module, rec.seed, params);
    const b = run(module, rec.seed + 1, params);
    expect(b).not.toEqual(a);
  });

  it('passes toybox validate()', () => {
    const out = run(module, rec.seed, params);
    const result = toybox.validate(out, manifest);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('toybox validate()', () => {
  /** One anchor-colored triangle, repeated `tris` times via the index buffer. */
  function triangleBundle(tris: number, color: [number, number, number]): AssetOutput {
    const indices = new Uint32Array(tris * 3);
    for (let i = 0; i < tris; i++) {
      indices[i * 3 + 1] = 1;
      indices[i * 3 + 2] = 2;
    }
    return {
      geometry: {
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 1]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        colors: new Float32Array([...color, ...color, ...color]),
        indices,
      },
    };
  }

  it('accepts a small on-palette output', () => {
    // #a8d8a0 exactly; the fat diagonal keeps the bbox above minAspect.
    const result = toybox.validate(triangleBundle(2, [0.659, 0.847, 0.627]), manifest);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('flags budget, palette, and thinness violations specifically', () => {
    const out = triangleBundle(manifest.geometry.maxTriangles + 1, [1, 0, 0]);
    // Flatten the geometry so the chunkiness rule trips too.
    out.geometry?.positions.set([0, 0, 0, 1, 0, 0, 0, 0.01, 0]);
    const result = toybox.validate(out, manifest);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('triangle budget exceeded'))).toBe(true);
    expect(result.violations.some((v) => v.includes('off-palette color'))).toBe(true);
    expect(result.violations.some((v) => v.includes('silhouette too thin'))).toBe(true);
  });

  it('counts instanced triangles once per transform', () => {
    const base = triangleBundle(1, [0.659, 0.847, 0.627]);
    const bundle = base.geometry;
    if (bundle === undefined) throw new Error('unreachable');
    const copies = manifest.geometry.maxTriangles + 5;
    const out: AssetOutput = {
      instances: [
        {
          bundle,
          transforms: Array.from({ length: copies }, (_, i) => ({
            position: [i, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          })),
        },
      ],
    };
    const result = toybox.validate(out, manifest);
    expect(result.violations.some((v) => v.includes('triangle budget exceeded'))).toBe(true);
  });
});
