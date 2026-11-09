/**
 * Shared measurements (metres). "Panel coordinates" are x across the cabinet
 * front (0 = centre) and y up from the bottom edge of the cabinet body, i.e.
 * world y minus the leg height. The front-panel texture is painted in the same
 * coordinates, so painted details and real geometry line up by construction.
 */

export const CAB = { w: 1.04, h: 1.7, d: 0.78, legs: 0.1, rTop: 0.2, rBot: 0.04 } as const;

/** Round window showing the bottle carousel. */
export const PORT = { x: -0.13, y: 0.97, r: 0.19 } as const;

/** Pick-up bay opening. */
export const BAY = { x: -0.13, y: 0.4, w: 0.46, h: 0.26, r: 0.03 } as const;

/** Back-lit flavour sign. */
export const LIGHTBOX = { x: -0.13, y: 1.44, w: 0.62, h: 0.26 } as const;

/** Brushed-steel control column. */
export const PLATE = { x: 0.34, y: 1.13, w: 0.22, h: 0.86 } as const;

export const CONTROLS = { slotY: 1.46, flavorY: 1.26, vendY: 1.02, returnY: 0.8 } as const;

/** Arched topper sign: half-width a, arch rise b, straight section height base. */
export const ARCH = { a: 0.39, b: 0.28, base: 0.12, depth: 0.14, faceScale: 0.84 } as const;
