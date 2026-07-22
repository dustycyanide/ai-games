export interface LoopCallbacks {
  /** Called zero or more times per frame with a fixed dt (1 / fixedHz seconds). */
  update(dt: number): void;
  /**
   * Called once per rAF. `alpha` in [0,1) is the interpolation fraction of the
   * accumulator into the next fixed step; `time` is seconds since loop start.
   */
  render(alpha: number, time: number): void;
}

/** Longest frame delta (seconds) fed into the accumulator, so a backgrounded tab doesn't spiral. */
const MAX_FRAME_DT = 0.25;

/**
 * Fixed-timestep accumulator loop (classic "fix your timestep"): accumulate
 * real frame time (clamped to MAX_FRAME_DT), run update() in fixed steps,
 * render() once per animation frame with the leftover fraction. Returns a stop
 * function that cancels the rAF chain; calling it twice is harmless.
 */
export function startLoop(cb: LoopCallbacks, fixedHz = 60): () => void {
  const step = 1 / fixedHz;
  let accumulator = 0;
  let last: number | undefined;
  let start = 0;
  let raf = 0;
  let running = true;

  const frame = (nowMs: number): void => {
    if (!running) return;
    const now = nowMs / 1000;
    if (last === undefined) {
      last = now;
      start = now;
    }
    accumulator += Math.min(now - last, MAX_FRAME_DT);
    last = now;
    while (accumulator >= step) {
      cb.update(step);
      accumulator -= step;
    }
    cb.render(accumulator / step, now - start);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}
