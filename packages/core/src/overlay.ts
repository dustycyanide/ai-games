/**
 * Tiny DOM fps counter pinned to the top-left corner of `parent`. tick(now)
 * with a milliseconds timestamp each frame; the label refreshes at ~2Hz with
 * the average fps over the elapsed window.
 */
export class DebugOverlay {
  private readonly el: HTMLDivElement;
  private frames = 0;
  private windowStart: number | undefined;

  constructor(parent: HTMLElement) {
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'absolute',
      top: '8px',
      left: '8px',
      padding: '2px 6px',
      font: '11px/1.4 ui-monospace, monospace',
      color: '#9f9',
      background: 'rgba(0, 0, 0, 0.5)',
      borderRadius: '3px',
      pointerEvents: 'none',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.textContent = '-- fps';
    parent.appendChild(this.el);
  }

  tick(now: number): void {
    if (this.windowStart === undefined) {
      this.windowStart = now;
      return;
    }
    this.frames += 1;
    const elapsed = now - this.windowStart;
    if (elapsed >= 500) {
      this.el.textContent = `${((this.frames * 1000) / elapsed).toFixed(0)} fps`;
      this.frames = 0;
      this.windowStart = now;
    }
  }
}
