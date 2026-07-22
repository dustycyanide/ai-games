/**
 * Mesh primitives. All return an indexed GeometryBundle with positions,
 * normals, uvs, and indices (CCW winding, +Y up, centered on the origin
 * unless noted). Deterministic: no randomness in here — variation comes from
 * the caller's params + Prng.
 */

import type { GeometryBundle, Vec3 } from '@ai-games/schema';

function toBundle(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): GeometryBundle {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

/** XZ ground plane, w by d, seg segments per side (default 1), +Y normal. */
export function plane(w: number, d: number, seg = 1): GeometryBundle {
  const s = Math.max(1, Math.floor(seg));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let iz = 0; iz <= s; iz++) {
    for (let ix = 0; ix <= s; ix++) {
      const u = ix / s;
      const v = iz / s;
      positions.push((u - 0.5) * w, 0, (v - 0.5) * d);
      normals.push(0, 1, 0);
      uvs.push(u, v);
    }
  }
  for (let iz = 0; iz < s; iz++) {
    for (let ix = 0; ix < s; ix++) {
      const i00 = iz * (s + 1) + ix;
      const i10 = i00 + 1;
      const i01 = i00 + s + 1;
      const i11 = i01 + 1;
      // Both tris CCW seen from +Y (the normal side).
      indices.push(i00, i11, i10, i00, i01, i11);
    }
  }
  return toBundle(positions, normals, uvs, indices);
}

/**
 * Flat-polygon accumulator for convex polyhedra centered on the origin.
 * Winding is normalized automatically: polygons are flipped so their normal
 * points away from the origin (valid because every user is origin-centered
 * and convex), then fan-triangulated with one shared face normal. UVs are a
 * planar projection along the dominant normal axis, normalized per polygon.
 */
class PolyMesh {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  addPolygon(poly: Vec3[]): void {
    // Newell's method for the polygon normal (robust for any planar polygon).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0] / poly.length;
      cy += a[1] / poly.length;
      cz += a[2] / poly.length;
    }
    if (nx * cx + ny * cy + nz * cz < 0) {
      poly = [...poly].reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return; // degenerate polygon (e.g. zero bevel edge quad)
    nx /= len;
    ny /= len;
    nz /= len;

    // Planar-project uvs onto the two axes least aligned with the normal.
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    const dom = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const ua = dom === 0 ? 1 : 0;
    const va = dom === 2 ? 1 : 2;
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of poly) {
      uMin = Math.min(uMin, p[ua]);
      uMax = Math.max(uMax, p[ua]);
      vMin = Math.min(vMin, p[va]);
      vMax = Math.max(vMax, p[va]);
    }
    const uSpan = uMax - uMin || 1;
    const vSpan = vMax - vMin || 1;

    const base = this.positions.length / 3;
    for (const p of poly) {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(nx, ny, nz);
      this.uvs.push((p[ua] - uMin) / uSpan, (p[va] - vMin) / vSpan);
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      this.indices.push(base, base + i, base + i + 1);
    }
  }

  bundle(): GeometryBundle {
    return toBundle(this.positions, this.normals, this.uvs, this.indices);
  }
}

export interface BoxOptions {
  /** Bevel radius; 0/undefined = sharp box, > 0 chamfers the edges. */
  bevel?: number;
}

export function box(w: number, h: number, d: number, opts?: BoxOptions): GeometryBundle {
  const half: Vec3 = [w / 2, h / 2, d / 2];
  const maxBevel = Math.min(half[0], half[1], half[2]) - 1e-6;
  const b = Math.min(Math.max(opts?.bevel ?? 0, 0), maxBevel);
  const mesh = new PolyMesh();

  // A point with coordinate `s * extent` on `axis` and (u, v) on the other two.
  const pt = (axis: number, s: number, extent: number, u: number, v: number): Vec3 => {
    const p: Vec3 = [0, 0, 0];
    p[axis] = s * extent;
    p[(axis + 1) % 3] = u;
    p[(axis + 2) % 3] = v;
    return p;
  };

  // 6 faces, inset by the bevel on their two in-plane axes.
  for (let axis = 0; axis < 3; axis++) {
    const hu = half[(axis + 1) % 3] - b;
    const hv = half[(axis + 2) % 3] - b;
    for (const s of [-1, 1]) {
      mesh.addPolygon([
        pt(axis, s, half[axis], -hu, -hv),
        pt(axis, s, half[axis], hu, -hv),
        pt(axis, s, half[axis], hu, hv),
        pt(axis, s, half[axis], -hu, hv),
      ]);
    }
  }

  if (b > 0) {
    // 12 edge quads: for each edge axis e, the chamfer strip joining the two
    // faces normal to the other axes u and v.
    for (let e = 0; e < 3; e++) {
      const u = (e + 1) % 3;
      const v = (e + 2) % 3;
      for (const su of [-1, 1]) {
        for (const sv of [-1, 1]) {
          const corner = (le: number, onU: boolean): Vec3 => {
            const p: Vec3 = [0, 0, 0];
            p[e] = le;
            p[u] = su * (onU ? half[u] : half[u] - b);
            p[v] = sv * (onU ? half[v] - b : half[v]);
            return p;
          };
          const le = half[e] - b;
          mesh.addPolygon([corner(-le, true), corner(le, true), corner(le, false), corner(-le, false)]);
        }
      }
    }
    // 8 corner triangles.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          mesh.addPolygon([
            [sx * half[0], sy * (half[1] - b), sz * (half[2] - b)],
            [sx * (half[0] - b), sy * half[1], sz * (half[2] - b)],
            [sx * (half[0] - b), sy * (half[1] - b), sz * half[2]],
          ]);
        }
      }
    }
  }

  return mesh.bundle();
}

/** Radius r, seg meridians (default 16); rings derived from seg. */
export function uvSphere(r: number, seg = 16): GeometryBundle {
  const s = Math.max(3, Math.floor(seg));
  const rings = Math.max(2, Math.round(s / 2));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    const y = Math.cos(phi);
    const ring = Math.sin(phi);
    for (let j = 0; j <= s; j++) {
      const theta = (2 * Math.PI * j) / s;
      const x = ring * Math.sin(theta);
      const z = ring * Math.cos(theta);
      positions.push(r * x, r * y, r * z);
      normals.push(x, y, z);
      uvs.push(j / s, i / rings);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < s; j++) {
      const a = i * (s + 1) + j;
      const bb = a + 1;
      const c = a + s + 1;
      const dd = c + 1;
      if (i < rings - 1) indices.push(a, c, dd); // degenerate at the south pole row
      if (i > 0) indices.push(a, dd, bb); // degenerate at the north pole row
    }
  }
  return toBundle(positions, normals, uvs, indices);
}

/** Capped cylinder/cone (rTop may be 0 or differ from rBottom), height h on Y. */
export function cylinder(rTop: number, rBottom: number, h: number, seg = 16): GeometryBundle {
  const s = Math.max(3, Math.floor(seg));
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const hy = h / 2;

  // Side normal tilt: profile tangent is (dr, dy) = (rTop - rBottom, h),
  // outward normal is (h, rBottom - rTop) in (radial, y), normalized.
  const nLen = Math.hypot(h, rBottom - rTop) || 1;
  const nRad = h / nLen;
  const nY = (rBottom - rTop) / nLen;

  for (const [radius, y, v] of [
    [rBottom, -hy, 0],
    [rTop, hy, 1],
  ] as const) {
    for (let j = 0; j <= s; j++) {
      const theta = (2 * Math.PI * j) / s;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, y, radius * cos);
      normals.push(nRad * sin, nY, nRad * cos);
      uvs.push(j / s, v);
    }
  }
  for (let j = 0; j < s; j++) {
    const b0 = j;
    const b1 = j + 1;
    const t0 = s + 1 + j;
    const t1 = t0 + 1;
    // Skip the triangle that collapses onto a zero-radius ring (cone apex).
    if (rBottom > 0) indices.push(b0, b1, t1);
    if (rTop > 0) indices.push(b0, t1, t0);
  }

  const addCap = (radius: number, y: number, up: 1 | -1): void => {
    if (radius <= 0) return;
    const center = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, up, 0);
    uvs.push(0.5, 0.5);
    for (let j = 0; j <= s; j++) {
      const theta = (2 * Math.PI * j) / s;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, y, radius * cos);
      normals.push(0, up, 0);
      uvs.push(0.5 + sin / 2, 0.5 + cos / 2);
    }
    for (let j = 0; j < s; j++) {
      const a = center + 1 + j;
      if (up > 0) indices.push(center, a, a + 1);
      else indices.push(center, a + 1, a);
    }
  };
  addCap(rTop, hy, 1);
  addCap(rBottom, -hy, -1);

  return toBundle(positions, normals, uvs, indices);
}

/** Revolve a [radius, y] profile (bottom to top) around Y with seg steps. */
export function lathe(profile: [number, number][], seg = 16): GeometryBundle {
  if (profile.length < 2) throw new Error('lathe: profile needs at least 2 points');
  const s = Math.max(3, Math.floor(seg));
  const rows = profile.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 2D profile normals from neighbor tangents: tangent (dr, dy) -> outward (dy, -dr).
  const n2: [number, number][] = [];
  for (let i = 0; i < rows; i++) {
    const prev = profile[Math.max(0, i - 1)];
    const next = profile[Math.min(rows - 1, i + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dy, dr);
    n2.push(len < 1e-12 ? [1, 0] : [dy / len, -dr / len]);
  }

  for (let i = 0; i < rows; i++) {
    const [radius, y] = profile[i];
    const [nr, ny] = n2[i];
    for (let j = 0; j <= s; j++) {
      const theta = (2 * Math.PI * j) / s;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, y, radius * cos);
      // nr can face inward for overhangs; the 3D normal follows it.
      const len = Math.hypot(nr, ny) || 1;
      normals.push((nr * sin) / len, ny / len, (nr * cos) / len);
      uvs.push(j / s, i / (rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    const r0 = profile[i][0];
    const r1 = profile[i + 1][0];
    for (let j = 0; j < s; j++) {
      const a = i * (s + 1) + j;
      const b = a + 1;
      const c = a + s + 1;
      const d = c + 1;
      if (r0 > 0 || r1 > 0) {
        if (r1 > 0) indices.push(a, b, d);
        if (r0 > 0) indices.push(a, d, c);
      }
    }
  }
  return toBundle(positions, normals, uvs, indices);
}

export interface ExtrudeOptions {
  /** Close the ends with caps (fan triangulation of the shape). Default true. */
  cap?: boolean;
}

/** Extrude a closed CCW [x, y] polygon along Z by depth, centered on Z=0. */
export function extrude(shape: [number, number][], depth: number, opts?: ExtrudeOptions): GeometryBundle {
  if (shape.length < 3) throw new Error('extrude: shape needs at least 3 points');
  const cap = opts?.cap ?? true;
  const hz = depth / 2;
  const n = shape.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Sides: one quad per edge with a hard outward normal (CCW shape -> outward
  // is the right-hand perpendicular of the edge direction).
  let perim = 0;
  const edgeLens: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    edgeLens.push(len);
    perim += len;
  }
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = edgeLens[i] || 1;
    const nx = ey / len;
    const ny = -ex / len;
    const base = positions.length / 3;
    const u0 = along / (perim || 1);
    const u1 = (along + edgeLens[i]) / (perim || 1);
    positions.push(a[0], a[1], -hz, b[0], b[1], -hz, b[0], b[1], hz, a[0], a[1], hz);
    for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);
    uvs.push(u0, 0, u1, 0, u1, 1, u0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    along += edgeLens[i];
  }

  if (cap) {
    // Fan triangulation: correct for convex shapes (documented limitation).
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of shape) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const sx = maxX - minX || 1;
    const sy = maxY - minY || 1;
    for (const side of [1, -1] as const) {
      const base = positions.length / 3;
      for (const [x, y] of shape) {
        positions.push(x, y, side * hz);
        normals.push(0, 0, side);
        uvs.push((x - minX) / sx, (y - minY) / sy);
      }
      for (let i = 1; i + 1 < n; i++) {
        // Front cap keeps shape order (CCW from +Z); back cap reversed.
        if (side === 1) indices.push(base, base + i, base + i + 1);
        else indices.push(base, base + i + 1, base + i);
      }
    }
  }
  return toBundle(positions, normals, uvs, indices);
}

/** Sweep a circle of `radius` (seg sides) along a polyline path; capped ends. */
export function tube(path: [number, number, number][], radius: number, seg = 8): GeometryBundle {
  if (path.length < 2) throw new Error('tube: path needs at least 2 points');
  const s = Math.max(3, Math.floor(seg));
  const m = path.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  // Per-point tangents (averaged at interior points), parallel-transported frame.
  const tangents: Vec3[] = [];
  for (let i = 0; i < m; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(m - 1, i + 1)];
    tangents.push(norm(sub(next as Vec3, prev as Vec3)));
  }
  let t = tangents[0];
  const ref: Vec3 = Math.abs(t[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let nrm = norm(sub(ref, [t[0] * dot(ref, t), t[1] * dot(ref, t), t[2] * dot(ref, t)]));
  let bin = cross(t, nrm);

  const frames: { n: Vec3; b: Vec3 }[] = [];
  for (let i = 0; i < m; i++) {
    const ti = tangents[i];
    // Rotate the frame from the previous tangent to this one (Rodrigues).
    const axis = cross(t, ti);
    const sinA = Math.hypot(axis[0], axis[1], axis[2]);
    const cosA = dot(t, ti);
    if (sinA > 1e-9) {
      const k = norm(axis);
      const rot = (v: Vec3): Vec3 => {
        const kxv = cross(k, v);
        const kdv = dot(k, v);
        return [
          v[0] * cosA + kxv[0] * sinA + k[0] * kdv * (1 - cosA),
          v[1] * cosA + kxv[1] * sinA + k[1] * kdv * (1 - cosA),
          v[2] * cosA + kxv[2] * sinA + k[2] * kdv * (1 - cosA),
        ];
      };
      nrm = rot(nrm);
      bin = rot(bin);
    }
    t = ti;
    frames.push({ n: nrm, b: bin });
  }

  for (let i = 0; i < m; i++) {
    const c = path[i];
    const { n: fn, b: fb } = frames[i];
    for (let j = 0; j <= s; j++) {
      const phi = (2 * Math.PI * j) / s;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      const dx = fn[0] * cs + fb[0] * sn;
      const dy = fn[1] * cs + fb[1] * sn;
      const dz = fn[2] * cs + fb[2] * sn;
      positions.push(c[0] + radius * dx, c[1] + radius * dy, c[2] + radius * dz);
      normals.push(dx, dy, dz);
      uvs.push(j / s, i / (m - 1));
    }
  }
  for (let i = 0; i < m - 1; i++) {
    for (let j = 0; j < s; j++) {
      const a = i * (s + 1) + j;
      const b = a + 1;
      const c = a + s + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  // End caps: fan around a center vertex, normal along -/+ tangent.
  const addCap = (ring: number, center: Vec3, dir: Vec3, flip: boolean): void => {
    const ci = positions.length / 3;
    positions.push(center[0], center[1], center[2]);
    normals.push(dir[0], dir[1], dir[2]);
    uvs.push(0.5, 0.5);
    const base = positions.length / 3;
    for (let j = 0; j <= s; j++) {
      const src = ring * (s + 1) + j;
      positions.push(positions[src * 3], positions[src * 3 + 1], positions[src * 3 + 2]);
      normals.push(dir[0], dir[1], dir[2]);
      uvs.push(0.5 + Math.cos((2 * Math.PI * j) / s) / 2, 0.5 + Math.sin((2 * Math.PI * j) / s) / 2);
    }
    for (let j = 0; j < s; j++) {
      if (flip) indices.push(ci, base + j + 1, base + j);
      else indices.push(ci, base + j, base + j + 1);
    }
  };
  const t0 = tangents[0];
  const t1 = tangents[m - 1];
  addCap(0, path[0] as Vec3, [-t0[0], -t0[1], -t0[2]], true);
  addCap(m - 1, path[m - 1] as Vec3, t1, false);

  return toBundle(positions, normals, uvs, indices);
}
