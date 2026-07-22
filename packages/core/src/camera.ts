import type { Vec3 } from '@ai-games/schema';
import { mat4 } from 'wgpu-matrix';
import type { Input } from './input';

export interface OrbitCameraOptions {
  target?: Vec3;
  distance?: number;
  /** Radians around Y. */
  yaw?: number;
  /** Radians above the horizon, clamped to (-PI/2, PI/2). */
  pitch?: number;
  minDistance?: number;
  maxDistance?: number;
  /** Vertical field of view in radians. Default ~50 degrees. */
  fovY?: number;
}

const PITCH_LIMIT = Math.PI / 2 - 0.01;
const ROTATE_SPEED = 0.005; // radians per CSS pixel of drag
const ZOOM_SPEED = 0.0015; // exponent per wheel-pixel
const SMOOTHING = 14; // 1/s — larger = snappier

/**
 * Drag-to-orbit, wheel-to-dolly camera. update() reads Input deltas (drag
 * rotates yaw/pitch, wheel changes distance exponentially) into goal values,
 * then eases the displayed values toward them with a framerate-independent
 * exponential; the caller is responsible for Input.endFrame(). viewProj()
 * returns a column-major 4x4 (wgpu-matrix conventions, [0,1] depth clip).
 */
export class OrbitCamera {
  eye: Vec3 = [0, 2, 6];

  private readonly target: Vec3;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly fovY: number;
  // goal* follow input immediately; the un-prefixed values ease toward them.
  private goalYaw: number;
  private goalPitch: number;
  private goalDistance: number;
  private yaw: number;
  private pitch: number;
  private distance: number;

  // Scratch matrices reused across viewProj calls to avoid per-frame garbage.
  private readonly proj = new Float32Array(16);
  private readonly view = new Float32Array(16);
  private readonly vp = new Float32Array(16);

  constructor(opts: OrbitCameraOptions = {}) {
    this.target = opts.target ?? [0, 0, 0];
    this.minDistance = opts.minDistance ?? 0.5;
    this.maxDistance = opts.maxDistance ?? 60;
    this.fovY = opts.fovY ?? (50 * Math.PI) / 180;
    this.yaw = this.goalYaw = opts.yaw ?? 0.6;
    this.pitch = this.goalPitch = clampPitch(opts.pitch ?? 0.5);
    this.distance = this.goalDistance = clamp(
      opts.distance ?? 6,
      this.minDistance,
      this.maxDistance,
    );
    this.updateEye();
  }

  update(input: Input, dt: number): void {
    if (input.pointer.dragging) {
      this.goalYaw -= input.pointer.dx * ROTATE_SPEED;
      this.goalPitch = clampPitch(this.goalPitch + input.pointer.dy * ROTATE_SPEED);
    }
    if (input.wheel !== 0) {
      this.goalDistance = clamp(
        this.goalDistance * Math.exp(input.wheel * ZOOM_SPEED),
        this.minDistance,
        this.maxDistance,
      );
    }
    const k = 1 - Math.exp(-SMOOTHING * dt);
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.pitch += (this.goalPitch - this.pitch) * k;
    this.distance += (this.goalDistance - this.distance) * k;
    this.updateEye();
  }

  viewProj(aspect: number): Float32Array {
    mat4.perspective(this.fovY, aspect, 0.05, 300, this.proj);
    mat4.lookAt(this.eye, this.target, [0, 1, 0], this.view);
    return mat4.multiply(this.proj, this.view, this.vp);
  }

  private updateEye(): void {
    const [tx, ty, tz] = this.target;
    const cp = Math.cos(this.pitch);
    this.eye = [
      tx + this.distance * cp * Math.sin(this.yaw),
      ty + this.distance * Math.sin(this.pitch),
      tz + this.distance * cp * Math.cos(this.yaw),
    ];
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function clampPitch(p: number): number {
  return clamp(p, -PITCH_LIMIT, PITCH_LIMIT);
}
