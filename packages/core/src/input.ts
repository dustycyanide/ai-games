/**
 * Polled input state. attach(el) wires listeners (keydown/keyup on window,
 * pointer + wheel on el, preventing context menu); detach() removes them.
 * Frame-delta fields (pointer.dx/dy, wheel) accumulate across events and are
 * zeroed by endFrame() — call it once at the end of each update pass so a
 * frame that runs multiple fixed steps doesn't double-apply deltas.
 */
export class Input {
  /** Currently held keys, by KeyboardEvent.code (e.g. 'KeyW', 'Space'). */
  readonly keys = new Set<string>();

  /** Pointer state in canvas CSS pixels. dx/dy accumulate movement while dragging. */
  readonly pointer = { x: 0, y: 0, dx: 0, dy: 0, buttons: 0, dragging: false };

  /** Accumulated wheel delta (positive = zoom out) since last endFrame(). */
  wheel = 0;

  private el: HTMLElement | null = null;
  private readonly handlers: [EventTarget, string, (e: Event) => void][] = [];

  attach(el: HTMLElement): void {
    if (this.el) this.detach();
    this.el = el;

    const on = <K extends keyof GlobalEventHandlersEventMap>(
      target: EventTarget,
      type: K,
      fn: (e: GlobalEventHandlersEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ): void => {
      const handler = fn as (e: Event) => void;
      target.addEventListener(type, handler, options);
      this.handlers.push([target, type, handler]);
    };

    on(window, 'keydown', (e) => this.keys.add(e.code));
    on(window, 'keyup', (e) => this.keys.delete(e.code));
    // Losing focus mid-hold would otherwise leave keys stuck down.
    on(window, 'blur', () => this.keys.clear());

    on(el, 'pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointer.buttons = e.buttons;
      this.pointer.dragging = true;
      this.pointer.x = e.offsetX;
      this.pointer.y = e.offsetY;
    });
    on(el, 'pointermove', (e) => {
      if (this.pointer.dragging) {
        this.pointer.dx += e.offsetX - this.pointer.x;
        this.pointer.dy += e.offsetY - this.pointer.y;
      }
      this.pointer.x = e.offsetX;
      this.pointer.y = e.offsetY;
    });
    on(el, 'pointerup', (e) => {
      this.pointer.buttons = e.buttons;
      this.pointer.dragging = e.buttons !== 0;
    });
    on(el, 'pointercancel', () => {
      this.pointer.buttons = 0;
      this.pointer.dragging = false;
    });
    on(el, 'wheel', (e) => {
      e.preventDefault();
      // Normalize line-mode deltas (Firefox) to roughly pixel scale.
      this.wheel += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    }, { passive: false });
    on(el, 'contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    for (const [target, type, handler] of this.handlers) {
      target.removeEventListener(type, handler);
    }
    this.handlers.length = 0;
    this.el = null;
    this.keys.clear();
    this.pointer.buttons = 0;
    this.pointer.dragging = false;
    this.endFrame();
  }

  /** Zero the per-frame deltas (dx, dy, wheel). Call at the end of update. */
  endFrame(): void {
    this.pointer.dx = 0;
    this.pointer.dy = 0;
    this.wheel = 0;
  }
}
