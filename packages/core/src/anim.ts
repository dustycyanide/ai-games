/**
 * Semi-implicit Euler spring step. Returns the new [pos, vel]. Critically
 * damped feel around damping ~= 2 * sqrt(stiffness). Deterministic given the
 * same inputs, so motion params can live in capsule manifests.
 */
export function springTo(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
): [number, number] {
  const accel = (target - pos) * stiffness - vel * damping;
  const nextVel = vel + accel * dt;
  return [pos + nextVel * dt, nextVel];
}

export type Easing = (t: number) => number;

export const easings: {
  linear: Easing;
  easeOutCubic: Easing;
  easeOutBack: Easing;
  easeInOutQuad: Easing;
} = {
  linear: (t) => t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
};
