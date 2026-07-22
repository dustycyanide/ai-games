/** Thrown by initGPU when `navigator.gpu` is missing or no adapter is available. */
export class NoWebGPUError extends Error {
  override readonly name = 'NoWebGPUError';
  constructor(message = 'WebGPU is not available in this browser') {
    super(message);
  }
}

export interface Gpu {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  /** Re-fit the canvas backing store to its CSS size * devicePixelRatio. */
  resize(): void;
  supported: true;
}

/**
 * Request adapter + device, configure the canvas context with the preferred
 * format, size the backing store, and return the Gpu handle. Throws
 * NoWebGPUError (not a generic Error) when WebGPU is unavailable, so callers
 * can show a friendly fallback.
 */
export async function initGPU(canvas: HTMLCanvasElement): Promise<Gpu> {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new NoWebGPUError();
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new NoWebGPUError('WebGPU adapter request failed (no compatible GPU?)');
  }
  const device = await adapter.requestDevice();

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new NoWebGPUError('could not create a webgpu canvas context');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const maxDim = device.limits.maxTextureDimension2D;
  const resize = (): void => {
    // Cap DPR at 2: retina-enough, and 4x MSAA on top of DPR 3 is wasteful.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round((canvas.clientWidth || canvas.width || 1) * dpr);
    const h = Math.round((canvas.clientHeight || canvas.height || 1) * dpr);
    canvas.width = Math.max(1, Math.min(w, maxDim));
    canvas.height = Math.max(1, Math.min(h, maxDim));
  };
  resize();

  return { device, context, format, resize, supported: true };
}
