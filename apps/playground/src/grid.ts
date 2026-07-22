/**
 * Ground reference for the preview: a big thin plane at y=0 with a subtle
 * two-tone checker in vertex colors so orbit/dolly reads even before any
 * asset renders. Built by hand (per-cell quads, no shared verts, so the
 * checker stays crisp) rather than via @ai-games/gen — the grid is part of
 * the instrument, not an asset.
 */

import type { GeometryBundle } from '@ai-games/schema';

export function groundGrid(size = 28, divisions = 14): GeometryBundle {
  const cells = divisions * divisions;
  const positions = new Float32Array(cells * 4 * 3);
  const normals = new Float32Array(cells * 4 * 3);
  const colors = new Float32Array(cells * 4 * 3);
  const indices = new Uint32Array(cells * 6);

  // Barely above the clear color; the checker should be felt, not seen.
  const toneA: readonly [number, number, number] = [0.078, 0.078, 0.094];
  const toneB: readonly [number, number, number] = [0.094, 0.094, 0.115];

  const step = size / divisions;
  const half = size / 2;
  let vert = 0;
  let idx = 0;

  for (let cz = 0; cz < divisions; cz++) {
    for (let cx = 0; cx < divisions; cx++) {
      const x0 = -half + cx * step;
      const z0 = -half + cz * step;
      const tone = (cx + cz) % 2 === 0 ? toneA : toneB;
      const corners: readonly [number, number][] = [
        [x0, z0],
        [x0 + step, z0],
        [x0 + step, z0 + step],
        [x0, z0 + step],
      ];
      const base = vert;
      for (const [x, z] of corners) {
        positions[vert * 3] = x;
        positions[vert * 3 + 1] = 0;
        positions[vert * 3 + 2] = z;
        normals[vert * 3] = 0;
        normals[vert * 3 + 1] = 1;
        normals[vert * 3 + 2] = 0;
        colors[vert * 3] = tone[0];
        colors[vert * 3 + 1] = tone[1];
        colors[vert * 3 + 2] = tone[2];
        vert++;
      }
      indices[idx++] = base;
      indices[idx++] = base + 2;
      indices[idx++] = base + 1;
      indices[idx++] = base;
      indices[idx++] = base + 3;
      indices[idx++] = base + 2;
    }
  }

  return { positions, normals, colors, indices };
}
