import type { GeometryBundle, Instance, Vec3 } from '@ai-games/schema';
import { mat4 } from 'wgpu-matrix';
import type { Gpu } from './gpu';

export interface DrawItem {
  bundle: GeometryBundle;
  /** Omitted -> a single identity-transform instance. */
  transforms?: Instance[];
}

export interface DrawOptions {
  /** Column-major 4x4 from OrbitCamera.viewProj. */
  viewProj: Float32Array;
  eye: Vec3;
  /** Seconds, forwarded to the shader globals for subtle animation. */
  time: number;
  items: DrawItem[];
  clearColor?: [number, number, number, number];
}

const MSAA = 4;
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
/** Globals uniform: mat4x4f (64B) + eye vec3f/time f32 (16B) + sunDir vec3f/pad (16B). */
const GLOBALS_FLOATS = 24;
/** Instance struct in the storage buffer: model mat4x4f (64B) + color vec4f (16B). */
const INST_FLOATS = 20;
const SUN_DIR = normalize([0.55, 0.75, 0.35]);
const DEFAULT_CLEAR: [number, number, number, number] = [0.043, 0.047, 0.055, 1];
const DEFAULT_ALBEDO: Vec3 = [0.8, 0.8, 0.8];

const SHADER = /* wgsl */ `
struct Globals {
  viewProj : mat4x4f,
  eye : vec3f,
  time : f32,
  sunDir : vec3f,
  _pad : f32,
}
struct Inst {
  model : mat4x4f,
  color : vec4f,
}
@group(0) @binding(0) var<uniform> G : Globals;
@group(1) @binding(0) var<storage, read> instances : array<Inst>;

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) normal : vec3f,
  @location(1) albedo : vec3f,
}

@vertex fn vs(
  @builtin(instance_index) ii : u32,
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
  @location(2) col : vec3f,
) -> VSOut {
  let inst = instances[ii];
  var out : VSOut;
  out.clip = G.viewProj * (inst.model * vec4f(pos, 1.0));
  // Rotates + scales the normal; skewed under non-uniform scale (no inverse
  // transpose) — fine for stylized assets, normalize handles uniform scale.
  out.normal = (inst.model * vec4f(nrm, 0.0)).xyz;
  out.albedo = col * inst.color.rgb;
  return out;
}

@fragment fn fs(in : VSOut, @builtin(front_facing) front : bool) -> @location(0) vec4f {
  var n = normalize(in.normal);
  if (!front) { n = -n; }
  let lambert = max(dot(n, normalize(G.sunDir)), 0.0);
  // ambient + warm sun + hemisphere-ish ground/sky tint
  let hemi = mix(vec3f(0.16, 0.13, 0.10), vec3f(0.13, 0.17, 0.24), n.y * 0.5 + 0.5);
  let light = vec3f(0.16) + vec3f(1.0, 0.96, 0.89) * (lambert * 0.95) + hemi;
  // Manual gamma: the swapchain format is non-sRGB (preferred canvas format).
  return vec4f(pow(in.albedo * light, vec3f(1.0 / 2.2)), 1.0);
}
`;

interface GeoBuffers {
  position: GPUBuffer;
  normal: GPUBuffer;
  color: GPUBuffer;
  index: GPUBuffer;
  indexCount: number;
}

/**
 * The one forward pass: 4x MSAA color (resolved to the swapchain) + depth,
 * both recreated when the canvas size changes. Bind group 0 is the globals
 * uniform. All items' instances are packed contiguously into one growable
 * storage buffer (bind group 1) and each item is drawn with a firstInstance
 * offset — @builtin(instance_index) includes firstInstance in WebGPU, so no
 * dynamic offsets or per-item bind groups are needed.
 * Instance eulers are XYZ order (M = T * Rx * Ry * Rz * S), matching gen's
 * transform(). Bundles without colors get a cached white vertex-color buffer
 * so one pipeline serves everything; uvs are accepted but unused in shading.
 * Geometry buffers are cached per bundle in a WeakMap so live param editing
 * doesn't leak: dropped bundles release their GPU buffers on GC.
 */
export class MeshRenderer {
  private readonly gpu: Gpu;
  private readonly pipeline: GPURenderPipeline;
  private readonly globalsBuffer: GPUBuffer;
  private readonly globalsGroup: GPUBindGroup;
  private readonly globalsData = new Float32Array(GLOBALS_FLOATS);
  private readonly instLayout: GPUBindGroupLayout;
  private instBuffer: GPUBuffer;
  private instGroup: GPUBindGroup;
  private instStaging = new Float32Array(INST_FLOATS * 256);
  private readonly geoCache = new WeakMap<GeometryBundle, GeoBuffers>();
  private msaaView: GPUTextureView | null = null;
  private depthView: GPUTextureView | null = null;
  private targetSize: [number, number] = [0, 0];
  // Scratch for building instance matrices without per-frame allocation.
  private readonly scratchMat = new Float32Array(16);

  constructor(gpu: Gpu) {
    this.gpu = gpu;
    const { device } = gpu;
    const module = device.createShaderModule({ label: 'mesh', code: SHADER });

    const globalsLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.instLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const vec3Layout = (shaderLocation: number): GPUVertexBufferLayout => ({
      arrayStride: 12,
      attributes: [{ shaderLocation, offset: 0, format: 'float32x3' }],
    });
    this.pipeline = device.createRenderPipeline({
      label: 'mesh',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [globalsLayout, this.instLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [vec3Layout(0), vec3Layout(1), vec3Layout(2)],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format }] },
      // No culling: procedural geometry makes no winding promises in v1.
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: { count: MSAA },
    });

    this.globalsBuffer = device.createBuffer({
      label: 'globals',
      size: GLOBALS_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.globalsGroup = device.createBindGroup({
      layout: globalsLayout,
      entries: [{ binding: 0, resource: { buffer: this.globalsBuffer } }],
    });

    this.instBuffer = this.createInstanceBuffer(this.instStaging.byteLength);
    this.instGroup = this.createInstanceGroup();
  }

  draw(opts: DrawOptions): void {
    const { device, context } = this.gpu;
    const canvasTexture = context.getCurrentTexture();
    this.ensureTargets(canvasTexture.width, canvasTexture.height);

    // Pack every item's instances contiguously; remember each first index.
    const firstInstance: number[] = [];
    const counts: number[] = [];
    let total = 0;
    for (const item of opts.items) {
      const count = item.transforms ? item.transforms.length : 1;
      firstInstance.push(total);
      counts.push(count);
      total += count;
    }
    if (total * INST_FLOATS > this.instStaging.length) {
      this.instStaging = new Float32Array(nextPow2(total * INST_FLOATS));
    }
    if (this.instStaging.byteLength > this.instBuffer.size) {
      this.instBuffer.destroy();
      this.instBuffer = this.createInstanceBuffer(this.instStaging.byteLength);
      this.instGroup = this.createInstanceGroup();
    }
    for (let i = 0; i < opts.items.length; i++) {
      this.writeInstances(opts.items[i]!.transforms, firstInstance[i]! * INST_FLOATS);
    }
    if (total > 0) {
      device.queue.writeBuffer(this.instBuffer, 0, this.instStaging, 0, total * INST_FLOATS);
    }

    const g = this.globalsData;
    g.set(opts.viewProj, 0);
    g.set(opts.eye, 16);
    g[19] = opts.time;
    g.set(SUN_DIR, 20);
    g[23] = 0;
    device.queue.writeBuffer(this.globalsBuffer, 0, g);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaView!,
          resolveTarget: canvasTexture.createView(),
          clearValue: toClearValue(opts.clearColor ?? DEFAULT_CLEAR),
          loadOp: 'clear',
          storeOp: 'discard', // resolve happens first; the msaa copy can be dropped
        },
      ],
      depthStencilAttachment: {
        view: this.depthView!,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.globalsGroup);
    pass.setBindGroup(1, this.instGroup);
    for (let i = 0; i < opts.items.length; i++) {
      const count = counts[i]!;
      if (count === 0) continue;
      const geo = this.geoFor(opts.items[i]!.bundle);
      if (geo.indexCount === 0) continue;
      pass.setVertexBuffer(0, geo.position);
      pass.setVertexBuffer(1, geo.normal);
      pass.setVertexBuffer(2, geo.color);
      pass.setIndexBuffer(geo.index, 'uint32');
      pass.drawIndexed(geo.indexCount, count, 0, 0, firstInstance[i]!);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /** Fill instStaging from float offset `base` with model matrices + colors. */
  private writeInstances(transforms: Instance[] | undefined, base: number): void {
    const staging = this.instStaging;
    const m = this.scratchMat;
    if (!transforms) {
      mat4.identity(m);
      staging.set(m, base);
      writeColor(staging, base + 16, DEFAULT_ALBEDO);
      return;
    }
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i]!;
      const at = base + i * INST_FLOATS;
      mat4.translation(t.position, m);
      if (t.rotation[0] !== 0) mat4.rotateX(m, t.rotation[0], m);
      if (t.rotation[1] !== 0) mat4.rotateY(m, t.rotation[1], m);
      if (t.rotation[2] !== 0) mat4.rotateZ(m, t.rotation[2], m);
      mat4.scale(m, t.scale, m);
      staging.set(m, at);
      writeColor(staging, at + 16, t.color ?? DEFAULT_ALBEDO);
    }
  }

  private geoFor(bundle: GeometryBundle): GeoBuffers {
    const cached = this.geoCache.get(bundle);
    if (cached) return cached;
    const upload = (
      data: Float32Array | Uint32Array,
      usage: GPUBufferUsageFlags,
    ): GPUBuffer => {
      const buffer = this.gpu.device.createBuffer({
        size: Math.max(4, data.byteLength),
        usage: usage | GPUBufferUsage.COPY_DST,
      });
      this.gpu.device.queue.writeBuffer(buffer, 0, data.buffer, data.byteOffset, data.byteLength);
      return buffer;
    };
    const colors = bundle.colors ?? new Float32Array(bundle.positions.length).fill(1);
    const geo: GeoBuffers = {
      position: upload(bundle.positions, GPUBufferUsage.VERTEX),
      normal: upload(bundle.normals, GPUBufferUsage.VERTEX),
      color: upload(colors, GPUBufferUsage.VERTEX),
      index: upload(bundle.indices, GPUBufferUsage.INDEX),
      indexCount: bundle.indices.length,
    };
    this.geoCache.set(bundle, geo);
    return geo;
  }

  private ensureTargets(width: number, height: number): void {
    if (this.targetSize[0] === width && this.targetSize[1] === height && this.msaaView) {
      return;
    }
    this.targetSize = [width, height];
    const make = (format: GPUTextureFormat, label: string): GPUTextureView =>
      this.gpu.device
        .createTexture({
          label,
          size: [width, height],
          sampleCount: MSAA,
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        })
        .createView();
    this.msaaView = make(this.gpu.format, 'msaa-color');
    this.depthView = make(DEPTH_FORMAT, 'depth');
  }

  private createInstanceBuffer(size: number): GPUBuffer {
    return this.gpu.device.createBuffer({
      label: 'instances',
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private createInstanceGroup(): GPUBindGroup {
    return this.gpu.device.createBindGroup({
      layout: this.instLayout,
      entries: [{ binding: 0, resource: { buffer: this.instBuffer } }],
    });
  }
}

function writeColor(out: Float32Array, at: number, c: Vec3): void {
  out[at] = c[0];
  out[at + 1] = c[1];
  out[at + 2] = c[2];
  out[at + 3] = 1;
}

function nextPow2(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function toClearValue(c: [number, number, number, number]): GPUColorDict {
  return { r: c[0], g: c[1], b: c[2], a: c[3] };
}
