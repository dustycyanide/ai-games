/**
 * Bundle operations. In-place mutation of the input bundle is allowed (and the
 * mutated bundle is returned) — callers that need the original should copy
 * first. merge() always allocates a new bundle.
 */

import type { GeometryBundle, Vec3 } from '@ai-games/schema';

/** Recompute smooth per-vertex normals by area-weighted face-normal accumulation. */
export function computeNormals(b: GeometryBundle): GeometryBundle {
  const pos = b.positions;
  const idx = b.indices;
  const normals = b.normals.length === pos.length ? b.normals.fill(0) : new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t] * 3;
    const i1 = idx[t + 1] * 3;
    const i2 = idx[t + 2] * 3;
    const ax = pos[i1] - pos[i0];
    const ay = pos[i1 + 1] - pos[i0 + 1];
    const az = pos[i1 + 2] - pos[i0 + 2];
    const bx = pos[i2] - pos[i0];
    const by = pos[i2 + 1] - pos[i0 + 1];
    const bz = pos[i2 + 2] - pos[i0 + 2];
    // Unnormalized cross = 2 * area * unit normal, so accumulation is area-weighted.
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    normals[i0] += nx;
    normals[i0 + 1] += ny;
    normals[i0 + 2] += nz;
    normals[i1] += nx;
    normals[i1 + 1] += ny;
    normals[i1 + 2] += nz;
    normals[i2] += nx;
    normals[i2 + 1] += ny;
    normals[i2 + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len < 1e-12) {
      normals[i] = 0;
      normals[i + 1] = 1;
      normals[i + 2] = 0;
    } else {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }
  b.normals = normals;
  return b;
}

/** Un-index into unique verts per face and assign face normals (faceted look). */
export function flatShade(b: GeometryBundle): GeometryBundle {
  const triCount = b.indices.length / 3;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  const uvs = b.uvs ? new Float32Array(triCount * 6) : undefined;
  const colors = b.colors ? new Float32Array(triCount * 9) : undefined;
  const indices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const src = [b.indices[t * 3], b.indices[t * 3 + 1], b.indices[t * 3 + 2]];
    for (let k = 0; k < 3; k++) {
      const v = src[k];
      const dst = t * 3 + k;
      positions[dst * 3] = b.positions[v * 3];
      positions[dst * 3 + 1] = b.positions[v * 3 + 1];
      positions[dst * 3 + 2] = b.positions[v * 3 + 2];
      if (uvs && b.uvs) {
        uvs[dst * 2] = b.uvs[v * 2];
        uvs[dst * 2 + 1] = b.uvs[v * 2 + 1];
      }
      if (colors && b.colors) {
        colors[dst * 3] = b.colors[v * 3];
        colors[dst * 3 + 1] = b.colors[v * 3 + 1];
        colors[dst * 3 + 2] = b.colors[v * 3 + 2];
      }
      indices[dst] = dst;
    }
    const i0 = t * 9;
    const ax = positions[i0 + 3] - positions[i0];
    const ay = positions[i0 + 4] - positions[i0 + 1];
    const az = positions[i0 + 5] - positions[i0 + 2];
    const bx = positions[i0 + 6] - positions[i0];
    const by = positions[i0 + 7] - positions[i0 + 1];
    const bz = positions[i0 + 8] - positions[i0 + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    for (let k = 0; k < 3; k++) {
      normals[i0 + k * 3] = nx;
      normals[i0 + k * 3 + 1] = ny;
      normals[i0 + k * 3 + 2] = nz;
    }
  }
  const out: GeometryBundle = { positions, normals, indices };
  if (uvs) out.uvs = uvs;
  if (colors) out.colors = colors;
  return out;
}

/** Concatenate bundles into one (indices offset; uvs/colors kept only if all inputs have them). */
export function merge(...bundles: GeometryBundle[]): GeometryBundle {
  const hasUvs = bundles.length > 0 && bundles.every((b) => b.uvs !== undefined);
  const hasColors = bundles.length > 0 && bundles.every((b) => b.colors !== undefined);
  let vertCount = 0;
  let idxCount = 0;
  for (const b of bundles) {
    vertCount += b.positions.length / 3;
    idxCount += b.indices.length;
  }
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = hasUvs ? new Float32Array(vertCount * 2) : undefined;
  const colors = hasColors ? new Float32Array(vertCount * 3) : undefined;
  const indices = new Uint32Array(idxCount);
  let vOff = 0;
  let iOff = 0;
  for (const b of bundles) {
    positions.set(b.positions, vOff * 3);
    normals.set(b.normals, vOff * 3);
    if (uvs && b.uvs) uvs.set(b.uvs, vOff * 2);
    if (colors && b.colors) colors.set(b.colors, vOff * 3);
    for (let i = 0; i < b.indices.length; i++) indices[iOff + i] = b.indices[i] + vOff;
    vOff += b.positions.length / 3;
    iOff += b.indices.length;
  }
  const out: GeometryBundle = { positions, normals, indices };
  if (uvs) out.uvs = uvs;
  if (colors) out.colors = colors;
  return out;
}

export interface TransformOptions {
  position?: Vec3;
  /** Euler XYZ, radians — same convention as Instance.rotation. */
  rotation?: Vec3;
  scale?: Vec3;
}

/** Apply scale -> rotation -> translation to positions (and rotation to normals). */
export function transform(b: GeometryBundle, t: TransformOptions): GeometryBundle {
  const [px, py, pz] = t.position ?? [0, 0, 0];
  const [rx, ry, rz] = t.rotation ?? [0, 0, 0];
  const [sx, sy, sz] = t.scale ?? [1, 1, 1];
  // R = Rz * Ry * Rx (rotate about X first, then Y, then Z — Instance convention).
  const cx = Math.cos(rx);
  const snx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sny = Math.sin(ry);
  const cz = Math.cos(rz);
  const snz = Math.sin(rz);
  const m00 = cz * cy;
  const m01 = cz * sny * snx - snz * cx;
  const m02 = cz * sny * cx + snz * snx;
  const m10 = snz * cy;
  const m11 = snz * sny * snx + cz * cx;
  const m12 = snz * sny * cx - cz * snx;
  const m20 = -sny;
  const m21 = cy * snx;
  const m22 = cy * cx;

  const pos = b.positions;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] * sx;
    const y = pos[i + 1] * sy;
    const z = pos[i + 2] * sz;
    pos[i] = m00 * x + m01 * y + m02 * z + px;
    pos[i + 1] = m10 * x + m11 * y + m12 * z + py;
    pos[i + 2] = m20 * x + m21 * y + m22 * z + pz;
  }
  // Normals get the inverse-transpose: rotation as-is, scale inverted, then renormalize.
  const isx = Math.abs(sx) > 1e-12 ? 1 / sx : 0;
  const isy = Math.abs(sy) > 1e-12 ? 1 / sy : 0;
  const isz = Math.abs(sz) > 1e-12 ? 1 / sz : 0;
  const nrm = b.normals;
  for (let i = 0; i < nrm.length; i += 3) {
    const x = nrm[i] * isx;
    const y = nrm[i + 1] * isy;
    const z = nrm[i + 2] * isz;
    let ox = m00 * x + m01 * y + m02 * z;
    let oy = m10 * x + m11 * y + m12 * z;
    let oz = m20 * x + m21 * y + m22 * z;
    const len = Math.hypot(ox, oy, oz);
    if (len < 1e-12) {
      ox = 0;
      oy = 1;
      oz = 0;
    } else {
      ox /= len;
      oy /= len;
      oz /= len;
    }
    nrm[i] = ox;
    nrm[i + 1] = oy;
    nrm[i + 2] = oz;
  }
  return b;
}

/** Fill (or create) the colors array with a constant rgb (0..1). */
export function setColor(b: GeometryBundle, color: [number, number, number]): GeometryBundle {
  const vertCount = b.positions.length / 3;
  const colors = b.colors && b.colors.length === vertCount * 3 ? b.colors : new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
  }
  b.colors = colors;
  return b;
}
