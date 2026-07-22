/**
 * Signed distance fields on the CPU, meshed with surface nets. Shapes follow
 * Inigo Quilez's canonical formulas. surfaceNets vendors the classic naive
 * surface nets algorithm (after Mikola Lysenko's `surface-nets`, MIT), then
 * computes normals from SDF central differences rather than face accumulation.
 */

import type { GeometryBundle, Vec3 } from '@ai-games/schema';

export type Sdf = (p: Vec3) => number;

export function sphere(r: number): Sdf {
  return (p) => Math.hypot(p[0], p[1], p[2]) - r;
}

/** Box with half-extents dims. (Named sBox: `box` is the mesh primitive.) */
export function sBox(dims: Vec3): Sdf {
  return (p) => {
    const qx = Math.abs(p[0]) - dims[0];
    const qy = Math.abs(p[1]) - dims[1];
    const qz = Math.abs(p[2]) - dims[2];
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    const inside = Math.min(Math.max(qx, qy, qz), 0);
    return outside + inside;
  };
}

export function roundBox(dims: Vec3, r: number): Sdf {
  const inner = sBox(dims);
  return (p) => inner(p) - r;
}

/** Capsule from a to b with radius r. */
export function capsule(a: Vec3, b: Vec3, r: number): Sdf {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz || 1;
  return (p) => {
    const pax = p[0] - a[0];
    const pay = p[1] - a[1];
    const paz = p[2] - a[2];
    const h = Math.min(Math.max((pax * bax + pay * bay + paz * baz) / baba, 0), 1);
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
  };
}

/** Torus in the XZ plane: major radius R, tube radius r. */
export function torus(R: number, r: number): Sdf {
  return (p) => Math.hypot(Math.hypot(p[0], p[2]) - R, p[1]) - r;
}

export function opUnion(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.min(a(p), b(p));
}

/** Polynomial smooth min union with blend radius k. */
export function opSmin(a: Sdf, b: Sdf, k: number): Sdf {
  if (k <= 0) return opUnion(a, b);
  return (p) => {
    const da = a(p);
    const db = b(p);
    const h = Math.min(Math.max(0.5 + (0.5 * (db - da)) / k, 0), 1);
    return db + (da - db) * h - k * h * (1 - h);
  };
}

/** a minus b. */
export function opSubtract(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.max(a(p), -b(p));
}

export function opIntersect(a: Sdf, b: Sdf): Sdf {
  return (p) => Math.max(a(p), b(p));
}

export function opTranslate(s: Sdf, off: Vec3): Sdf {
  return (p) => s([p[0] - off[0], p[1] - off[1], p[2] - off[2]]);
}

/** Uniform scale by factor f (distance corrected by * f). */
export function opScale(s: Sdf, f: number): Sdf {
  return (p) => s([p[0] / f, p[1] / f, p[2] / f]) * f;
}

/** Add fn(p) to the distance (bounded displacement keeps it a valid-enough SDF). */
export function opDisplace(s: Sdf, fn: (p: Vec3) => number): Sdf {
  return (p) => s(p) + fn(p);
}

export interface SdfBounds {
  min: Vec3;
  max: Vec3;
}

// Cube corners are indexed by bits (x | y<<1 | z<<2); the 12 edges as corner pairs.
const CUBE_EDGES: readonly [number, number][] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7], // x-aligned
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7], // y-aligned
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // z-aligned
];

/**
 * Mesh the sdf's zero isosurface inside bounds on a resolution^3 grid.
 * Returns an indexed GeometryBundle with normals from SDF central differences.
 * Deterministic for identical inputs.
 *
 * Vendored naive surface nets (after Mikola Lysenko's surface-nets, MIT):
 * one vertex per sign-changing cell at the mean of its edge crossings, one
 * quad per sign-changing grid edge connecting the 4 cells that share it.
 */
export function surfaceNets(sdf: Sdf, bounds: SdfBounds, resolution: number): GeometryBundle {
  const n = Math.max(2, Math.floor(resolution));
  const nx = n + 1; // samples per axis
  const min = bounds.min;
  const cell: Vec3 = [
    (bounds.max[0] - min[0]) / n,
    (bounds.max[1] - min[1]) / n,
    (bounds.max[2] - min[2]) / n,
  ];

  // Sample the field at every grid corner.
  const field = new Float64Array(nx * nx * nx);
  const sampleAt = (x: number, y: number, z: number): number => field[x + nx * (y + nx * z)];
  for (let z = 0; z < nx; z++) {
    for (let y = 0; y < nx; y++) {
      for (let x = 0; x < nx; x++) {
        field[x + nx * (y + nx * z)] = sdf([min[0] + x * cell[0], min[1] + y * cell[1], min[2] + z * cell[2]]);
      }
    }
  }

  // Pass 1: place one vertex per cell whose corners straddle the surface.
  const cellVert = new Int32Array(n * n * n).fill(-1);
  const cellIdx = (x: number, y: number, z: number): number => x + n * (y + n * z);
  const positions: number[] = [];
  const corner: number[] = new Array<number>(8);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = sampleAt(x + (c & 1), y + ((c >> 1) & 1), z + ((c >> 2) & 1));
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;
        let px = 0;
        let py = 0;
        let pz = 0;
        let crossings = 0;
        for (const [c0, c1] of CUBE_EDGES) {
          const v0 = corner[c0];
          const v1 = corner[c1];
          if (v0 < 0 === v1 < 0) continue;
          const t = v0 / (v0 - v1);
          px += (c0 & 1) + t * ((c1 & 1) - (c0 & 1));
          py += ((c0 >> 1) & 1) + t * (((c1 >> 1) & 1) - ((c0 >> 1) & 1));
          pz += ((c0 >> 2) & 1) + t * (((c1 >> 2) & 1) - ((c0 >> 2) & 1));
          crossings++;
        }
        cellVert[cellIdx(x, y, z)] = positions.length / 3;
        positions.push(
          min[0] + (x + px / crossings) * cell[0],
          min[1] + (y + py / crossings) * cell[1],
          min[2] + (z + pz / crossings) * cell[2],
        );
      }
    }
  }

  // Pass 2: for every sign-changing grid edge, connect the 4 surrounding cells.
  const indices: number[] = [];
  const step: [Vec3, Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const p: Vec3 = [x, y, z];
        const v0 = sampleAt(x, y, z);
        for (let d = 0; d < 3; d++) {
          const e = step[d];
          const v1 = sampleAt(x + e[0], y + e[1], z + e[2]);
          if (v0 < 0 === v1 < 0) continue;
          const u = (d + 1) % 3;
          const v = (d + 2) % 3;
          if (p[u] === 0 || p[v] === 0) continue; // the 4 adjacent cells must exist
          const eu = step[u];
          const ev = step[v];
          const q0 = cellVert[cellIdx(p[0], p[1], p[2])];
          const q1 = cellVert[cellIdx(p[0] - eu[0], p[1] - eu[1], p[2] - eu[2])];
          const q2 = cellVert[cellIdx(p[0] - eu[0] - ev[0], p[1] - eu[1] - ev[1], p[2] - eu[2] - ev[2])];
          const q3 = cellVert[cellIdx(p[0] - ev[0], p[1] - ev[1], p[2] - ev[2])];
          if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
          // Orient so triangles face outward (toward positive field).
          if (v0 < 0) indices.push(q0, q1, q2, q0, q2, q3);
          else indices.push(q0, q3, q2, q0, q2, q1);
        }
      }
    }
  }

  // Normals from SDF central differences (the gradient points outward).
  const normals = new Float32Array(positions.length);
  const eps = Math.min(cell[0], cell[1], cell[2]) * 0.5;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    let gx = sdf([x + eps, y, z]) - sdf([x - eps, y, z]);
    let gy = sdf([x, y + eps, z]) - sdf([x, y - eps, z]);
    let gz = sdf([x, y, z + eps]) - sdf([x, y, z - eps]);
    const len = Math.hypot(gx, gy, gz);
    if (len < 1e-12) {
      gx = 0;
      gy = 1;
      gz = 0;
    } else {
      gx /= len;
      gy /= len;
      gz /= len;
    }
    normals[i] = gx;
    normals[i + 1] = gy;
    normals[i + 2] = gz;
  }

  return {
    positions: new Float32Array(positions),
    normals,
    indices: new Uint32Array(indices),
  };
}
