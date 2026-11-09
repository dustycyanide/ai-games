/**
 * Every texture in the scene is painted here onto a 2D canvas: enamel livery
 * with wear, back-lit signs, bottle labels, the room's tile/plaster/wood, and
 * the HUD cap badges. Wear and stains are seeded from the workspace PRNG so the
 * machine looks the same on every load.
 */

import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { makePrng, type Prng } from '@ai-games/schema';
import { CREAM, INK, type EmblemKind, type Flavor } from './flavors';
import { BAY, CAB, CONTROLS, LIGHTBOX, PLATE, PORT } from './layout';

export const FONT_DISPLAY = '"Bebas Neue", Impact, "Arial Narrow", sans-serif';
export const FONT_SCRIPT = 'Lobster, "Brush Script MT", cursive';

const SEED = 1957;
const TAU = Math.PI * 2;

type G = CanvasRenderingContext2D;

export async function loadFonts(): Promise<void> {
  try {
    await Promise.all([document.fonts.load('64px "Bebas Neue"'), document.fonts.load('64px Lobster')]);
  } catch {
    // Fallback fonts in the stacks above still give a usable result.
  }
}

function mk(w: number, h: number): { c: HTMLCanvasElement; g: G } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable');
  return { c, g };
}

function tex(c: HTMLCanvasElement, o: { data?: boolean; repeat?: [number, number] } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = o.data ? NoColorSpace : SRGBColorSpace;
  t.anisotropy = 8;
  if (o.repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(o.repeat[0], o.repeat[1]);
  }
  return t;
}

// --- colour helpers --------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend two #rrggbb colours; returns a css rgb()/rgba() string. */
export function mix(a: string, b: string, t: number, alpha = 1): string {
  const A = rgb(a);
  const B = rgb(b);
  const ch = (i: number): number => Math.round(A[i]! + (B[i]! - A[i]!) * t);
  return alpha >= 1 ? `rgb(${ch(0)},${ch(1)},${ch(2)})` : `rgba(${ch(0)},${ch(1)},${ch(2)},${alpha})`;
}

// --- drawing helpers -------------------------------------------------------

function roundRect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Four-point atomic-age sparkle. */
function sparkle(g: G, x: number, y: number, r: number, fill: string): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.16;
    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.closePath();
  g.fill();
  g.restore();
}

function spaced(g: G, px: number): void {
  // Not in every browser; signs still read fine without tracking.
  (g as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Largest font size (<= maxPx) at which `text` fits in `maxWidth`. */
function fit(g: G, text: string, family: string, maxPx: number, maxWidth: number): number {
  let px = maxPx;
  g.font = `${px}px ${family}`;
  const w = g.measureText(text).width;
  if (w > maxWidth) px = Math.floor((px * maxWidth) / w);
  g.font = `${px}px ${family}`;
  return px;
}

/**
 * Text set along a circle. `top` text reads left-to-right over the top of the
 * circle; otherwise it reads left-to-right along the bottom.
 */
function arcText(g: G, text: string, cx: number, cy: number, radius: number, top: boolean): void {
  const gap = 0.12 * parseFloat(g.font);
  const widths = [...text].map((ch) => g.measureText(ch).width + gap);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -total / radius / 2;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  [...text].forEach((ch, i) => {
    const half = widths[i]! / radius / 2;
    a += half;
    g.save();
    if (top) {
      g.translate(cx + Math.sin(a) * radius, cy - Math.cos(a) * radius);
      g.rotate(a);
    } else {
      g.translate(cx + Math.sin(a) * radius, cy + Math.cos(a) * radius);
      g.rotate(-a);
    }
    g.fillText(ch, 0, 0);
    g.restore();
    a += half;
  });
  g.restore();
}

/** Flavour emblem in a unit box (-1..1) scaled by `s` around (cx, cy). */
export function drawEmblem(g: G, kind: EmblemKind, cx: number, cy: number, s: number, fill: string): void {
  g.save();
  g.translate(cx, cy);
  g.scale(s, s);
  g.fillStyle = fill;
  g.strokeStyle = fill;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  switch (kind) {
    case 'anvil': {
      const pts: [number, number][] = [
        [-0.5, -0.5], [0.8, -0.5], [0.8, -0.22], [0.26, -0.14], [0.17, 0.2], [0.56, 0.3], [0.56, 0.56],
        [-0.56, 0.56], [-0.56, 0.3], [-0.17, 0.2], [-0.26, -0.12], [-0.95, -0.4],
      ];
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      break;
    }
    case 'chevrons': {
      g.transform(1, 0, -0.18, 1, 0, 0);
      for (let i = 0; i < 3; i++) {
        const x = -0.82 + i * 0.5;
        g.globalAlpha = 0.55 + i * 0.225;
        g.beginPath();
        g.moveTo(x, -0.62);
        g.lineTo(x + 0.26, -0.62);
        g.lineTo(x + 0.7, 0);
        g.lineTo(x + 0.26, 0.62);
        g.lineTo(x, 0.62);
        g.lineTo(x + 0.44, 0);
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'owl': {
      for (const sx of [-1, 1]) {
        g.beginPath();
        g.arc(sx * 0.43, 0.12, 0.38, 0, TAU);
        g.arc(sx * 0.43, 0.12, 0.2, 0, TAU, true);
        g.fill();
        g.beginPath();
        g.arc(sx * 0.43, 0.12, 0.09, 0, TAU);
        g.fill();
      }
      g.lineWidth = 0.17;
      g.beginPath();
      g.moveTo(-0.9, -0.66);
      g.lineTo(0, -0.3);
      g.lineTo(0.9, -0.66);
      g.stroke();
      g.beginPath();
      g.moveTo(-0.11, 0.42);
      g.lineTo(0.11, 0.42);
      g.lineTo(0, 0.72);
      g.closePath();
      g.fill();
      break;
    }
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const r = i % 2 === 0 ? 0.82 : 0.34;
        g.lineTo(-0.1 + Math.cos(a) * r, 0.1 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      sparkle(g, 0.68, -0.62, 0.3, fill);
      break;
    }
  }
  g.restore();
}

// --- wear ------------------------------------------------------------------

function scratches(g: G, rng: Prng, w: number, h: number, n: number): void {
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const len = rng.range(8, 90);
    const a = rng.range(-0.5, 0.5) + (rng.next() < 0.3 ? Math.PI / 2 : 0);
    g.strokeStyle = rng.next() < 0.6 ? `rgba(255,245,225,${rng.range(0.05, 0.2)})` : `rgba(10,6,3,${rng.range(0.08, 0.25)})`;
    g.lineWidth = rng.range(0.6, 1.8);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  g.restore();
}

function rustChip(g: G, rng: Prng, x: number, y: number, r: number): void {
  g.save();
  g.translate(x, y);
  const n = 7 + rng.int(5);
  const path = (scale: number): void => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = r * scale * (0.55 + 0.45 * Math.abs(Math.sin(i * 12.9898 + x)));
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 0.8);
    }
    g.closePath();
  };
  g.fillStyle = 'rgba(96,48,20,0.85)';
  path(1);
  g.fill();
  g.fillStyle = 'rgba(38,22,14,0.9)';
  path(0.55);
  g.fill();
  g.restore();
}

function stains(g: G, rng: Prng, w: number, h: number, n: number, dark = true): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(w * 0.03, w * 0.16);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = rng.range(0.04, 0.14);
    grad.addColorStop(0, dark ? `rgba(12,8,4,${a})` : `rgba(255,250,235,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    // Draw wrapped copies so tiling textures stay seamless.
    for (const dx of [-w, 0, w]) {
      for (const dy of [-h, 0, h]) {
        g.save();
        g.translate(dx, dy);
        g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
    }
  }
}

function speckle(g: G, rng: Prng, w: number, h: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const v = rng.next() < 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${rng.range(alpha * 0.3, alpha)})`;
    const s = rng.range(0.6, 2.2);
    g.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
}

// --- machine: front panel livery ------------------------------------------

/**
 * The whole cabinet front as one painted sheet. `X`/`Y` convert panel metres
 * to pixels so decorations sit exactly around the real geometry.
 */
export function frontPanelTexture(f: Flavor): CanvasTexture {
  const PX = 1000;
  const w = Math.round(CAB.w * PX);
  const h = Math.round(CAB.h * PX);
  const { c, g } = mk(w, h);
  const X = (m: number): number => (m + CAB.w / 2) * PX;
  const Y = (m: number): number => h - m * PX;
  const rng = makePrng(SEED).fork(`panel-${f.id}`);

  // Enamel.
  const enamel = g.createLinearGradient(0, 0, 0, h);
  enamel.addColorStop(0, mix(f.paint, '#ffffff', 0.1));
  enamel.addColorStop(0.5, f.paint);
  enamel.addColorStop(1, mix(f.paint, '#000000', 0.12));
  g.fillStyle = enamel;
  g.fillRect(0, 0, w, h);

  // Sparkles scattered on the enamel, kept clear of the hardware.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-0.47, 0.19);
    const y = rng.range(0.74, 1.66);
    const inBox = Math.abs(x - LIGHTBOX.x) < LIGHTBOX.w / 2 + 0.05 && Math.abs(y - LIGHTBOX.y) < LIGHTBOX.h / 2 + 0.05;
    const inPort = Math.hypot(x - PORT.x, y - PORT.y) < PORT.r + 0.15;
    if (inBox || inPort) continue;
    sparkle(g, X(x), Y(y), rng.range(10, 30), mix(f.paint, CREAM, 0.6, 0.7));
  }
  for (const [x, y, r] of [[0.02, 1.645, 26], [0.34, 1.625, 20], [-0.3, 1.66, 16]] as const) {
    sparkle(g, X(x), Y(y), r, mix(f.paint, CREAM, 0.7, 0.8));
  }

  // Two-tone: cream lower body under a swept line.
  const sweep = (): void => {
    g.moveTo(X(-0.53), Y(0.66));
    g.bezierCurveTo(X(-0.12), Y(0.66), X(0.1), Y(0.58), X(0.53), Y(0.58));
  };
  g.beginPath();
  sweep();
  g.lineTo(X(0.53), Y(-0.01));
  g.lineTo(X(-0.53), Y(-0.01));
  g.closePath();
  const cream = g.createLinearGradient(0, Y(0.66), 0, h);
  cream.addColorStop(0, CREAM);
  cream.addColorStop(1, mix(CREAM, '#8a7a58', 0.35));
  g.fillStyle = cream;
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = f.paintDark;
  g.beginPath();
  sweep();
  g.stroke();
  g.save();
  g.translate(0, -15);
  g.lineWidth = 3;
  g.strokeStyle = mix(f.paint, CREAM, 0.75);
  g.beginPath();
  sweep();
  g.stroke();
  g.restore();

  // Kick band behind the louvres.
  g.fillStyle = f.paintDark;
  g.fillRect(0, Y(0.215), w, h - Y(0.215));
  g.fillStyle = mix(f.paint, CREAM, 0.5);
  g.fillRect(0, Y(0.215) - 5, w, 5);

  // Halo ring around the porthole with arc lettering.
  const pcx = X(PORT.x);
  const pcy = Y(PORT.y);
  g.fillStyle = CREAM;
  g.beginPath();
  g.arc(pcx, pcy, (PORT.r + 0.11) * PX, 0, TAU);
  g.arc(pcx, pcy, (PORT.r + 0.05) * PX, 0, TAU, true);
  g.fill();
  g.strokeStyle = f.paintDark;
  g.lineWidth = 4;
  for (const r of [PORT.r + 0.11, PORT.r + 0.05]) {
    g.beginPath();
    g.arc(pcx, pcy, r * PX, 0, TAU);
    g.stroke();
  }
  g.fillStyle = INK;
  g.font = `42px ${FONT_DISPLAY}`;
  arcText(g, 'ICE COLD TONICS', pcx, pcy, (PORT.r + 0.08) * PX, true);
  arcText(g, 'FIZZ · POP · POWER', pcx, pcy, (PORT.r + 0.08) * PX, false);
  sparkle(g, pcx - (PORT.r + 0.08) * PX, pcy, 15, f.paint);
  sparkle(g, pcx + (PORT.r + 0.08) * PX, pcy, 15, f.paint);

  // Pick-up bay caption.
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `30px ${FONT_DISPLAY}`;
  spaced(g, 5);
  g.fillText('▼  TAKE YOUR TONIC  ▼', X(BAY.x), Y(BAY.y + BAY.h / 2 + 0.054));
  spaced(g, 0);

  // Flavour medallion under the control column.
  const mx = X(PLATE.x);
  const my = Y(0.4);
  g.fillStyle = f.paintDark;
  g.beginPath();
  g.arc(mx, my, 92, 0, TAU);
  g.fill();
  g.fillStyle = f.paint;
  g.beginPath();
  g.arc(mx, my, 82, 0, TAU);
  g.fill();
  g.strokeStyle = CREAM;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(mx, my, 72, 0, TAU);
  g.stroke();
  drawEmblem(g, f.emblem, mx, my, 50, CREAM);
  g.fillStyle = INK;
  g.font = `26px ${FONT_DISPLAY}`;
  arcText(g, 'GENUINE', mx, my, 112, true);
  arcText(g, 'FIZZWICK’S', mx, my, 112, false);

  // --- wear ---
  // Edge darkening and grime climbing from the floor.
  const grime = g.createLinearGradient(0, h, 0, h * 0.62);
  grime.addColorStop(0, 'rgba(18,11,5,0.6)');
  grime.addColorStop(0.35, 'rgba(18,11,5,0.2)');
  grime.addColorStop(1, 'rgba(18,11,5,0)');
  g.fillStyle = grime;
  g.fillRect(0, 0, w, h);
  for (const [x0, x1] of [[0, 70], [w, w - 70]] as const) {
    const edge = g.createLinearGradient(x0, 0, x1, 0);
    edge.addColorStop(0, 'rgba(10,6,3,0.4)');
    edge.addColorStop(1, 'rgba(10,6,3,0)');
    g.fillStyle = edge;
    g.fillRect(Math.min(x0, x1), 0, 70, h);
  }
  // Rain-streak stains under the porthole halo and sign.
  for (let i = 0; i < 16; i++) {
    const x = X(rng.range(-0.46, 0.2));
    const y = rng.next() < 0.5 ? Y(PORT.y - PORT.r - 0.1) : Y(LIGHTBOX.y - LIGHTBOX.h / 2 - 0.02);
    const len = rng.range(60, 260);
    const streak = g.createLinearGradient(0, y, 0, y + len);
    streak.addColorStop(0, `rgba(25,14,6,${rng.range(0.1, 0.22)})`);
    streak.addColorStop(1, 'rgba(25,14,6,0)');
    g.fillStyle = streak;
    g.fillRect(x, y, rng.range(3, 9), len);
  }
  stains(g, rng, w, h, 14);
  scratches(g, rng, w, h, 170);
  // Chipped enamel: along the bottom, the edges, and around the bay.
  for (let i = 0; i < 46; i++) {
    const side = rng.next();
    let x: number;
    let y: number;
    if (side < 0.5) {
      x = rng.range(0, w);
      y = h - rng.range(0, 230) * rng.next();
    } else if (side < 0.8) {
      x = rng.next() < 0.5 ? rng.range(0, 34) : w - rng.range(0, 34);
      y = rng.range(h * 0.1, h);
    } else {
      x = X(BAY.x + rng.range(-0.3, 0.3));
      y = Y(BAY.y + rng.range(-0.2, 0.2));
    }
    rustChip(g, rng, x, y, rng.range(3, 13));
  }
  speckle(g, rng, w, h, 2600, 0.07);

  return tex(c);
}

/**
 * Neutral wear map for the cabinet sides and top, multiplied by the enamel
 * colour. u runs bottom-to-top of the cabinet, v front-to-back.
 */
export function shellGrimeTexture(): CanvasTexture {
  const w = 1024;
  const h = 512;
  const { c, g } = mk(w, h);
  const rng = makePrng(SEED).fork('shell');
  g.fillStyle = '#f2f0ec';
  g.fillRect(0, 0, w, h);
  const grime = g.createLinearGradient(0, 0, w * 0.42, 0);
  grime.addColorStop(0, 'rgba(22,13,6,0.72)');
  grime.addColorStop(0.4, 'rgba(22,13,6,0.25)');
  grime.addColorStop(1, 'rgba(22,13,6,0)');
  g.fillStyle = grime;
  g.fillRect(0, 0, w, h);
  stains(g, rng, w, h, 26);
  scratches(g, rng, w, h, 140);
  for (let i = 0; i < 40; i++) {
    const low = rng.next() < 0.7;
    rustChip(g, rng, low ? rng.range(0, 200) * rng.next() : rng.range(0, w * 0.9), rng.range(0, h), rng.range(3, 10));
  }
  speckle(g, rng, w, h, 2500, 0.08);
  const t = tex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

// --- machine: signs --------------------------------------------------------

/** Back-lit flavour sign: emblem roundel, big name, small line, script tagline. */
export function lightboxTexture(f: Flavor): CanvasTexture {
  const w = 1240;
  const h = 520;
  const { c, g } = mk(w, h);
  const bg = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.62);
  bg.addColorStop(0, '#fff8e2');
  bg.addColorStop(1, '#ecd6a0');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.strokeStyle = f.paint;
  g.lineWidth = 10;
  roundRect(g, 22, 22, w - 44, h - 44, 34);
  g.stroke();
  g.lineWidth = 3;
  roundRect(g, 40, 40, w - 80, h - 80, 22);
  g.stroke();

  const er = 150;
  const ex = 78 + er;
  g.fillStyle = f.paintDark;
  g.beginPath();
  g.arc(ex, h / 2, er, 0, TAU);
  g.fill();
  g.fillStyle = f.paint;
  g.beginPath();
  g.arc(ex, h / 2, er - 14, 0, TAU);
  g.fill();
  drawEmblem(g, f.emblem, ex, h / 2, er * 0.6, '#fff4d6');

  const left = ex + er + 44;
  const maxW = w - left - 70;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = f.paint;
  fit(g, f.name1, FONT_DISPLAY, 230, maxW);
  g.fillText(f.name1, left, 242);
  g.fillStyle = INK;
  spaced(g, 8);
  fit(g, f.name2, FONT_DISPLAY, 82, maxW);
  g.fillText(f.name2, left + 4, 330);
  spaced(g, 0);
  g.fillStyle = f.paintDark;
  fit(g, f.tagline, FONT_SCRIPT, 62, maxW);
  g.fillText(f.tagline, left + 2, 424);

  // Faint tube banding and dirt so the lit panel is not a flat card.
  for (let x = 0; x < w; x += 310) {
    const band = g.createLinearGradient(x, 0, x + 310, 0);
    band.addColorStop(0, 'rgba(120,80,20,0.1)');
    band.addColorStop(0.5, 'rgba(255,255,255,0)');
    band.addColorStop(1, 'rgba(120,80,20,0.1)');
    g.fillStyle = band;
    g.fillRect(x, 0, 310, h);
  }
  const rng = makePrng(SEED).fork(`lightbox-${f.id}`);
  stains(g, rng, w, h, 8);
  return tex(c);
}

/** Arched topper: neon script on a dark field. Rendered unlit, so it blooms. */
export function archSignTexture(f: Flavor): CanvasTexture {
  const w = 1310;
  const h = 672;
  const { c, g } = mk(w, h);
  const bg = g.createRadialGradient(w / 2, h * 0.55, 20, w / 2, h * 0.55, w * 0.6);
  bg.addColorStop(0, mix(f.paintDark, '#050508', 0.75));
  bg.addColorStop(1, '#030306');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const neon = (text: string, x: number, y: number, core: string, halo: string, blur: number): void => {
    g.save();
    g.shadowColor = halo;
    g.shadowBlur = blur;
    g.fillStyle = halo;
    g.fillText(text, x, y);
    g.fillText(text, x, y);
    g.shadowBlur = blur * 0.3;
    g.fillStyle = core;
    g.fillText(text, x, y);
    g.restore();
  };

  fit(g, 'Fizzwick’s', FONT_SCRIPT, 290, w * 0.86);
  neon('Fizzwick’s', w / 2, h * 0.47, mix(f.glow, '#ffffff', 0.8), f.glow, 46);

  g.font = `96px ${FONT_DISPLAY}`;
  spaced(g, 16);
  neon('TONIC-O-MATIC', w / 2 + 8, h * 0.83, '#fff3cf', '#ffb648', 26);
  spaced(g, 0);

  for (const [x, y, r] of [[0.5, 0.12, 30], [0.36, 0.17, 16], [0.64, 0.17, 16]] as const) {
    g.save();
    g.shadowColor = f.glow;
    g.shadowBlur = 24;
    sparkle(g, w * x, h * y, r, mix(f.glow, '#ffffff', 0.7));
    g.restore();
  }
  return tex(c);
}

/** Starburst behind the bottle carousel. */
export function glowDiscTexture(f: Flavor): CanvasTexture {
  const s = 512;
  const { c, g } = mk(s, s);
  const bg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  bg.addColorStop(0, mix(f.glow, f.paint, 0.25));
  bg.addColorStop(0.45, f.paint);
  bg.addColorStop(1, mix(f.paintDark, '#000000', 0.6));
  g.fillStyle = bg;
  g.fillRect(0, 0, s, s);
  g.translate(s / 2, s / 2);
  g.fillStyle = 'rgba(0,0,0,0.26)';
  for (let i = 0; i < 16; i++) {
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, s, ((i * 2) / 32) * TAU, ((i * 2 + 1) / 32) * TAU);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

/** Brushed-steel control column with engraved captions. */
export function controlPlateTexture(): CanvasTexture {
  const w = 256;
  const h = 1000;
  const { c, g } = mk(w, h);
  const PX = h / PLATE.h;
  const Y = (panelY: number): number => (PLATE.y + PLATE.h / 2 - panelY) * PX;
  const rng = makePrng(SEED).fork('plate');
  g.fillStyle = '#c4c7cd';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    const v = rng.next() < 0.5 ? 255 : 30;
    g.fillStyle = `rgba(${v},${v},${v},${rng.range(0.03, 0.1)})`;
    g.fillRect(rng.range(-40, w), rng.range(0, h), rng.range(30, 160), 1);
  }
  g.strokeStyle = 'rgba(20,20,26,0.5)';
  g.lineWidth = 2;
  roundRect(g, 12, 12, w - 24, h - 24, 22);
  g.stroke();

  g.fillStyle = '#16161a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `34px ${FONT_DISPLAY}`;
  spaced(g, 4);
  g.fillText('TOKENS', w / 2 + 2, Y(CONTROLS.slotY + 0.066));
  g.fillText('FLAVOR', w / 2 + 2, Y(CONTROLS.flavorY + 0.093));
  g.fillText('RETURN', w / 2 + 2, Y(CONTROLS.returnY + 0.058));
  g.font = `52px ${FONT_DISPLAY}`;
  g.fillText('PUSH', w / 2 + 2, Y(CONTROLS.vendY - 0.105));
  spaced(g, 0);
  // Dial ring around the big button.
  g.strokeStyle = '#16161a';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(w / 2, Y(CONTROLS.vendY), 0.082 * PX, 0, TAU);
  g.stroke();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const r0 = 0.084 * PX;
    const r1 = 0.091 * PX;
    g.beginPath();
    g.moveTo(w / 2 + Math.cos(a) * r0, Y(CONTROLS.vendY) + Math.sin(a) * r0);
    g.lineTo(w / 2 + Math.cos(a) * r1, Y(CONTROLS.vendY) + Math.sin(a) * r1);
    g.stroke();
  }
  // Divider grooves.
  g.fillStyle = 'rgba(20,20,26,0.45)';
  for (const y of [CONTROLS.flavorY + 0.125, CONTROLS.vendY + 0.115, CONTROLS.returnY + 0.095]) {
    g.fillRect(34, Y(y), w - 68, 3);
  }
  stains(g, rng, w, h, 6);
  return tex(c);
}

// --- bottle ----------------------------------------------------------------

export function bottleLabelTexture(f: Flavor): CanvasTexture {
  const w = 512;
  const h = 200;
  const { c, g } = mk(w, h);
  g.fillStyle = CREAM;
  g.fillRect(0, 0, w, h);
  g.fillStyle = f.paint;
  g.fillRect(0, 0, w, 30);
  g.fillRect(0, h - 30, w, 30);
  g.fillStyle = f.paintDark;
  g.fillRect(0, 30, w, 5);
  g.fillRect(0, h - 35, w, 5);
  // Centre of the canvas faces forward on the bottle.
  g.fillStyle = f.paint;
  g.beginPath();
  g.arc(w / 2, h / 2, 62, 0, TAU);
  g.fill();
  drawEmblem(g, f.emblem, w / 2, h / 2, 38, CREAM);
  g.fillStyle = f.paintDark;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const x of [w * 0.19, w * 0.81]) {
    fit(g, f.name1, FONT_DISPLAY, 50, 150);
    g.fillText(f.name1, x, h / 2 - 14);
    fit(g, 'Fizzwick’s', FONT_SCRIPT, 30, 150);
    g.fillText('Fizzwick’s', x, h / 2 + 28);
  }
  return tex(c);
}

// --- room ------------------------------------------------------------------

/** 2 m x 2 m of worn checkerboard tile (0.5 m tiles); tiles seamlessly. */
export function floorTexture(): CanvasTexture {
  const s = 1024;
  const n = 4;
  const t = s / n;
  const { c, g } = mk(s, s);
  const rng = makePrng(SEED).fork('floor');
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const light = (i + j) % 2 === 0;
      const k = rng.range(-0.08, 0.08);
      g.fillStyle = light ? mix('#a89c82', k > 0 ? '#ffffff' : '#000000', Math.abs(k)) : mix('#1e2626', '#000000', 0.5 + k * 3);
      g.fillRect(i * t, j * t, t, t);
      // Worn centre of each tile.
      const wear = g.createRadialGradient(i * t + t / 2, j * t + t / 2, t * 0.1, i * t + t / 2, j * t + t / 2, t * 0.75);
      wear.addColorStop(0, light ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.035)');
      wear.addColorStop(1, 'rgba(0,0,0,0.28)');
      g.fillStyle = wear;
      g.fillRect(i * t, j * t, t, t);
    }
  }
  g.fillStyle = 'rgba(8,7,6,0.9)';
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * t - 3, 0, 6, s);
    g.fillRect(0, i * t - 3, s, 6);
  }
  stains(g, rng, s, s, 22);
  // Hairline cracks.
  g.strokeStyle = 'rgba(0,0,0,0.5)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    let x = rng.range(60, s - 60);
    let y = rng.range(60, s - 60);
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += rng.range(-34, 34);
      y += rng.range(-34, 34);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  speckle(g, rng, s, s, 5000, 0.12);
  return tex(c, { repeat: [7, 7] });
}

/** 4 m x 4 m of wall: stained plaster over dark plank wainscot. */
export function wallTexture(): CanvasTexture {
  const s = 1024;
  const { c, g } = mk(s, s);
  const rng = makePrng(SEED).fork('wall');
  const railY = s * (1 - 1.15 / 4);
  const plaster = g.createLinearGradient(0, 0, 0, railY);
  plaster.addColorStop(0, '#2d3835');
  plaster.addColorStop(1, '#465450');
  g.fillStyle = plaster;
  g.fillRect(0, 0, s, railY);
  stains(g, rng, s, railY, 40);
  stains(g, rng, s, railY, 14, false);
  // Water streaks.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, s);
    const y = rng.range(0, railY * 0.6);
    const len = rng.range(80, 380);
    const streak = g.createLinearGradient(0, y, 0, y + len);
    streak.addColorStop(0, `rgba(12,14,10,${rng.range(0.1, 0.28)})`);
    streak.addColorStop(1, 'rgba(12,14,10,0)');
    g.fillStyle = streak;
    g.fillRect(x, y, rng.range(3, 12), len);
  }
  // Wainscot planks.
  const planks = 16;
  const pw = s / planks;
  for (let i = 0; i < planks; i++) {
    g.fillStyle = mix('#2a1a10', '#4a2f1c', rng.next());
    g.fillRect(i * pw, railY, pw, s - railY);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const x = i * pw + rng.range(4, pw - 4);
      g.beginPath();
      g.moveTo(x, railY);
      g.bezierCurveTo(x + rng.range(-5, 5), railY + 90, x + rng.range(-5, 5), s - 90, x + rng.range(-3, 3), s);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(i * pw - 1.5, railY, 3, s - railY);
  }
  const floorGrime = g.createLinearGradient(0, s, 0, s - 150);
  floorGrime.addColorStop(0, 'rgba(0,0,0,0.6)');
  floorGrime.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = floorGrime;
  g.fillRect(0, s - 150, s, 150);
  speckle(g, rng, s, s, 5000, 0.1);
  return tex(c, { repeat: [3, 1] });
}

export function woodTexture(): CanvasTexture {
  const s = 256;
  const { c, g } = mk(s, s);
  const rng = makePrng(SEED).fork('wood');
  g.fillStyle = '#8a6238';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) {
    const y = rng.range(0, s);
    g.strokeStyle = `rgba(${rng.next() < 0.5 ? '40,22,8' : '190,150,100'},${rng.range(0.08, 0.3)})`;
    g.lineWidth = rng.range(0.6, 2.4);
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(s * 0.3, y + rng.range(-6, 6), s * 0.7, y + rng.range(-6, 6), s, y + rng.range(-3, 3));
    g.stroke();
  }
  stains(g, rng, s, s, 10);
  return tex(c, { repeat: [1, 1] });
}

/** Tiling grey blotches used as a roughness map: polished here, dull there. */
export function smudgeTexture(): CanvasTexture {
  const s = 512;
  const { c, g } = mk(s, s);
  const rng = makePrng(SEED).fork('smudge');
  g.fillStyle = '#b8b8b8';
  g.fillRect(0, 0, s, s);
  stains(g, rng, s, s, 30, true);
  stains(g, rng, s, s, 30, false);
  scratches(g, rng, s, s, 120);
  speckle(g, rng, s, s, 3000, 0.1);
  return tex(c, { data: true, repeat: [2, 2] });
}

/** Faded wall poster. */
export function posterTexture(): CanvasTexture {
  const w = 512;
  const h = 768;
  const { c, g } = mk(w, h);
  const rng = makePrng(SEED).fork('poster');
  g.fillStyle = '#d9c9a0';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#9c3b1c';
  g.fillRect(0, 0, w, 150);
  g.fillRect(0, h - 120, w, 120);

  // Sunburst behind the bottle.
  g.save();
  g.beginPath();
  g.rect(0, 150, w, h - 270);
  g.clip();
  g.translate(w / 2, 420);
  g.fillStyle = 'rgba(190,120,40,0.35)';
  for (let i = 0; i < 12; i++) {
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, 330, (i / 12) * TAU, ((i + 0.5) / 12) * TAU);
    g.closePath();
    g.fill();
  }
  g.restore();

  // Bottle silhouette.
  g.fillStyle = '#23423a';
  g.beginPath();
  g.moveTo(w / 2 - 62, 610);
  g.lineTo(w / 2 - 62, 420);
  g.bezierCurveTo(w / 2 - 62, 350, w / 2 - 24, 340, w / 2 - 22, 270);
  g.lineTo(w / 2 - 22, 232);
  g.lineTo(w / 2 + 22, 232);
  g.lineTo(w / 2 + 22, 270);
  g.bezierCurveTo(w / 2 + 24, 340, w / 2 + 62, 350, w / 2 + 62, 420);
  g.lineTo(w / 2 + 62, 610);
  g.closePath();
  g.fill();
  g.fillStyle = '#d9c9a0';
  g.fillRect(w / 2 - 62, 450, 124, 96);
  sparkle(g, w / 2, 498, 40, '#9c3b1c');
  g.fillStyle = '#9c3b1c';
  g.fillRect(w / 2 - 26, 214, 52, 22);
  for (const [x, y, r] of [[110, 300, 26], [400, 260, 34], [420, 540, 20], [92, 560, 30]] as const) {
    sparkle(g, x, y, r, '#9c3b1c');
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f1e4c2';
  g.font = `92px ${FONT_SCRIPT}`;
  g.fillText('Feeling flat?', w / 2, 78);
  g.font = `64px ${FONT_DISPLAY}`;
  spaced(g, 4);
  g.fillText('FIZZWICK’S TONICS', w / 2 + 2, h - 74);
  g.font = `30px ${FONT_DISPLAY}`;
  g.fillText('PEP IN EVERY POP', w / 2 + 2, h - 28);
  spaced(g, 0);

  // Age it.
  g.fillStyle = 'rgba(60,40,10,0.22)';
  g.fillRect(0, 0, w, h);
  stains(g, rng, w, h, 22);
  scratches(g, rng, w, h, 60);
  g.strokeStyle = 'rgba(40,25,8,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, h * 0.5);
  g.lineTo(w, h * 0.5 + 4);
  g.moveTo(w * 0.5, 0);
  g.lineTo(w * 0.5 + 3, h);
  g.stroke();
  return tex(c);
}

/** Soft four-point star sprite for the stardust perk. */
export function starSpriteTexture(): CanvasTexture {
  const s = 64;
  const { c, g } = mk(s, s);
  const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.25, 'rgba(255,255,255,0.25)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);
  sparkle(g, s / 2, s / 2, s / 2, '#ffffff');
  return tex(c);
}

/** Soft round mote. */
export function dustSpriteTexture(): CanvasTexture {
  const s = 32;
  const { c, g } = mk(s, s);
  const glow = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, s, s);
  return tex(c);
}

// --- HUD -------------------------------------------------------------------

/** Crimped bottle-cap badge for the HUD, as a data URL. */
export function capBadge(f: Flavor): string {
  const s = 144;
  const { c, g } = mk(s, s);
  g.translate(s / 2, s / 2);
  const teeth = 21;
  g.fillStyle = f.paintDark;
  g.beginPath();
  for (let i = 0; i <= teeth * 8; i++) {
    const a = (i / (teeth * 8)) * TAU;
    const r = 66 + Math.cos(a * teeth) * 4;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  const face = g.createRadialGradient(-16, -20, 4, 0, 0, 58);
  face.addColorStop(0, mix(f.paint, '#ffffff', 0.3));
  face.addColorStop(1, f.paint);
  g.fillStyle = face;
  g.beginPath();
  g.arc(0, 0, 56, 0, TAU);
  g.fill();
  g.strokeStyle = CREAM;
  g.lineWidth = 2.5;
  g.beginPath();
  g.arc(0, 0, 48, 0, TAU);
  g.stroke();
  drawEmblem(g, f.emblem, 0, 0, 30, CREAM);
  return c.toDataURL('image/png');
}
