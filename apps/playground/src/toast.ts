/**
 * Minimal toast strip. Surfaces runtime errors (window errors, unhandled
 * rejections, GPU uncaptured errors) plus save/finalize feedback so nothing
 * fails silently during integration. No dependencies, plain DOM.
 */

let host: HTMLElement | null = null;

export function initToasts(el: HTMLElement): void {
  host = el;
}

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  if (host === null) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.append(el);
  // Keep the strip short; oldest goes first.
  while (host.children.length > 5) host.firstElementChild?.remove();
  window.setTimeout(() => {
    el.remove();
  }, kind === 'error' ? 8000 : 3000);
}

/** Route window-level errors into the toast strip (GPU errors are wired where the device exists). */
export function installErrorSurface(): void {
  window.addEventListener('error', (ev) => {
    toast(`error: ${ev.message}`, 'error');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason: unknown = ev.reason;
    toast(
      `unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      'error',
    );
  });
}
