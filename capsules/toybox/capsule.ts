/**
 * toybox capsule: chunky, playful, pastel. validate() enforces the manifest's
 * hard rules with specific violation strings:
 *   - triangle budget (instanced copies count once per transform)
 *   - palette adherence: every vertex/instance color within PALETTE_TOLERANCE
 *     oklab distance of an anchor (anchors parse as #hex or oklch(L C H))
 *   - chunky silhouette: overall bbox min/max extent ratio >= style.minAspect
 */

import type {
  AssetOutput,
  CapsuleManifest,
  CapsuleModule,
  CapsuleValidation,
  GeometryBundle,
  Instance,
  Vec3,
} from '@ai-games/schema';

/** Max oklab distance from a color to its nearest palette anchor. */
const PALETTE_TOLERANCE = 0.12;
/** How many off-palette colors to spell out before summarizing. */
const MAX_COLOR_DETAILS = 6;

type Lab = [number, number, number];

// ---------------------------------------------------------------------------
// Color: sRGB / hex / oklch -> oklab (Björn Ottosson's matrices).

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Parse a palette anchor: '#rgb' / '#rrggbb' or 'oklch(L C H)' (L may be a %). */
function parseAnchor(anchor: string): Lab | null {
  const s = anchor.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex !== null) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (ch) => ch + ch);
    return rgbToOklab(
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    );
  }
  const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/i.exec(s);
  if (oklch !== null) {
    const L = parseFloat(oklch[1]) / (oklch[2] === '%' ? 100 : 1);
    const C = parseFloat(oklch[3]);
    const H = (parseFloat(oklch[4]) * Math.PI) / 180;
    return [L, C * Math.cos(H), C * Math.sin(H)];
  }
  return null;
}

function labDistance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// Geometry helpers.

interface Group {
  bundle: GeometryBundle;
  transforms: Instance[] | null; // null = plain geometry, drawn once untransformed
}

function groupsOf(output: AssetOutput): Group[] {
  const groups: Group[] = [];
  if (output.geometry !== undefined) groups.push({ bundle: output.geometry, transforms: null });
  for (const g of output.instances ?? []) groups.push({ bundle: g.bundle, transforms: g.transforms });
  return groups;
}

/** Column-major-free 3x3 rotation from euler XYZ (R = Rz * Ry * Rx, ops.transform convention). */
function eulerMatrix([rx, ry, rz]: Vec3): number[] {
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

interface Bbox {
  min: Vec3;
  max: Vec3;
  any: boolean;
}

function growBbox(box: Bbox, x: number, y: number, z: number): void {
  box.any = true;
  box.min[0] = Math.min(box.min[0], x);
  box.min[1] = Math.min(box.min[1], y);
  box.min[2] = Math.min(box.min[2], z);
  box.max[0] = Math.max(box.max[0], x);
  box.max[1] = Math.max(box.max[1], y);
  box.max[2] = Math.max(box.max[2], z);
}

/** Union bbox of the whole output; instanced bundles contribute their local
 * bbox corners run through each transform (scale -> euler XYZ -> translate). */
function outputBbox(groups: Group[]): Bbox {
  const box: Bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], any: false };
  for (const { bundle, transforms } of groups) {
    const pos = bundle.positions;
    if (pos.length === 0) continue;
    if (transforms === null) {
      for (let i = 0; i < pos.length; i += 3) growBbox(box, pos[i], pos[i + 1], pos[i + 2]);
      continue;
    }
    const local: Bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], any: false };
    for (let i = 0; i < pos.length; i += 3) growBbox(local, pos[i], pos[i + 1], pos[i + 2]);
    for (const t of transforms) {
      const m = eulerMatrix(t.rotation);
      for (let c = 0; c < 8; c++) {
        const x = (c & 1 ? local.max[0] : local.min[0]) * t.scale[0];
        const y = (c & 2 ? local.max[1] : local.min[1]) * t.scale[1];
        const z = (c & 4 ? local.max[2] : local.min[2]) * t.scale[2];
        growBbox(
          box,
          m[0] * x + m[1] * y + m[2] * z + t.position[0],
          m[3] * x + m[4] * y + m[5] * z + t.position[1],
          m[6] * x + m[7] * y + m[8] * z + t.position[2],
        );
      }
    }
  }
  return box;
}

// ---------------------------------------------------------------------------
// Checks.

function checkBudget(groups: Group[], manifest: CapsuleManifest, violations: string[]): void {
  let total = 0;
  for (const { bundle, transforms } of groups) {
    total += (bundle.indices.length / 3) * (transforms === null ? 1 : transforms.length);
  }
  const budget = manifest.geometry.maxTriangles;
  if (total > budget) {
    violations.push(`triangle budget exceeded: ${total} rendered triangles > maxTriangles ${budget}`);
  }
}

function checkPalette(groups: Group[], manifest: CapsuleManifest, violations: string[]): void {
  const anchors: { text: string; lab: Lab }[] = [];
  for (const text of manifest.palette.anchors) {
    const lab = parseAnchor(text);
    if (lab === null) violations.push(`palette anchor "${text}" is not parseable (expected #rrggbb or oklch(L C H))`);
    else anchors.push({ text, lab });
  }
  if (anchors.length === 0) return;

  // Dedupe to 8-bit-quantized colors so per-vertex gradients stay cheap to check.
  const seen = new Set<number>();
  const colors: [number, number, number][] = [];
  const add = (r: number, g: number, b: number): void => {
    const key = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    if (seen.has(key)) return;
    seen.add(key);
    colors.push([r, g, b]);
  };
  for (const { bundle, transforms } of groups) {
    if (bundle.colors !== undefined) {
      for (let i = 0; i < bundle.colors.length; i += 3) add(bundle.colors[i], bundle.colors[i + 1], bundle.colors[i + 2]);
    }
    for (const t of transforms ?? []) {
      if (t.color !== undefined) add(t.color[0], t.color[1], t.color[2]);
    }
  }

  const offenders: string[] = [];
  for (const [r, g, b] of colors) {
    const lab = rgbToOklab(r, g, b);
    let best = Infinity;
    let bestAnchor = '';
    for (const a of anchors) {
      const d = labDistance(lab, a.lab);
      if (d < best) {
        best = d;
        bestAnchor = a.text;
      }
    }
    if (best > PALETTE_TOLERANCE) {
      offenders.push(
        `off-palette color rgb(${r.toFixed(3)}, ${g.toFixed(3)}, ${b.toFixed(3)}): ` +
          `nearest anchor "${bestAnchor}" is ${best.toFixed(3)} away in oklab (max ${PALETTE_TOLERANCE})`,
      );
    }
  }
  violations.push(...offenders.slice(0, MAX_COLOR_DETAILS));
  if (offenders.length > MAX_COLOR_DETAILS) {
    violations.push(`...and ${offenders.length - MAX_COLOR_DETAILS} more off-palette colors`);
  }
}

function checkChunkiness(groups: Group[], manifest: CapsuleManifest, violations: string[]): void {
  const minAspect = manifest.geometry.style['minAspect'];
  if (typeof minAspect !== 'number') return;
  const box = outputBbox(groups);
  if (!box.any) return;
  const ext = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const largest = Math.max(...ext);
  if (largest <= 0) return;
  const ratio = Math.min(...ext) / largest;
  if (ratio < minAspect) {
    violations.push(
      `silhouette too thin for toybox: bbox extent ratio ${ratio.toFixed(3)} < minAspect ${minAspect} ` +
        `(extents ${ext.map((e) => e.toFixed(2)).join(' x ')})`,
    );
  }
}

function validate(output: AssetOutput, manifest: CapsuleManifest): CapsuleValidation {
  const violations: string[] = [];
  const groups = groupsOf(output);
  checkBudget(groups, manifest, violations);
  checkPalette(groups, manifest, violations);
  checkChunkiness(groups, manifest, violations);
  return { ok: violations.length === 0, violations };
}

export default { validate } satisfies CapsuleModule;
