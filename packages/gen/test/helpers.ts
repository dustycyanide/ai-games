import { expect } from 'vitest';
import type { GeometryBundle } from '@ai-games/schema';

/** Structural checks every bundle must pass: finite data, unit normals, valid indices. */
export function expectIntegrity(b: GeometryBundle, label: string): void {
  const vertCount = b.positions.length / 3;
  expect(b.positions.length % 3, `${label}: positions stride`).toBe(0);
  expect(b.normals.length, `${label}: normals length`).toBe(b.positions.length);
  expect(b.indices.length % 3, `${label}: indices stride`).toBe(0);
  if (b.uvs) expect(b.uvs.length, `${label}: uvs length`).toBe(vertCount * 2);
  if (b.colors) expect(b.colors.length, `${label}: colors length`).toBe(vertCount * 3);

  for (const [name, arr] of [
    ['positions', b.positions],
    ['normals', b.normals],
    ['uvs', b.uvs],
    ['colors', b.colors],
  ] as const) {
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) {
        throw new Error(`${label}: ${name}[${i}] is not finite (${arr[i]})`);
      }
    }
  }
  for (let i = 0; i < b.normals.length; i += 3) {
    const len = Math.hypot(b.normals[i], b.normals[i + 1], b.normals[i + 2]);
    expect(Math.abs(len - 1), `${label}: normal ${i / 3} unit length (got ${len})`).toBeLessThanOrEqual(1e-3);
  }
  for (let i = 0; i < b.indices.length; i++) {
    const v = b.indices[i];
    if (v >= vertCount) throw new Error(`${label}: index ${i} out of range (${v} >= ${vertCount})`);
  }
}

/** Byte-level equality of two bundles' vertex/index data. */
export function expectIdentical(a: GeometryBundle, b: GeometryBundle, label: string): void {
  expect(b.positions, `${label}: positions`).toEqual(a.positions);
  expect(b.normals, `${label}: normals`).toEqual(a.normals);
  expect(b.indices, `${label}: indices`).toEqual(a.indices);
  expect(b.uvs, `${label}: uvs`).toEqual(a.uvs);
  expect(b.colors, `${label}: colors`).toEqual(a.colors);
}
