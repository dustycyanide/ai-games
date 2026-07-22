import type { TextureRecipe } from '@ai-games/schema';
import type { Gpu } from './gpu';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Render recipe.wgslBody into an offscreen rgba8unorm texture of
 * recipe.size x recipe.size via one fullscreen-triangle pass.
 *
 * The generated fragment shader wraps wgslBody as:
 *   fn shade(uv: vec2f, params: Params) -> vec4f { <wgslBody> }
 * where `Params` is a uniform struct with one f32 field per key of
 * recipe.params, SORTED BY KEY so the layout is deterministic regardless of
 * how the params object was assembled. The body must `return` a vec4f.
 * uv is (0,0) at the top-left of the texture. Returned texture has usage
 * TEXTURE_BINDING | RENDER_ATTACHMENT.
 */
export function bake(gpu: Gpu, recipe: TextureRecipe): GPUTexture {
  const { device } = gpu;
  const keys = Object.keys(recipe.params).sort();
  for (const key of keys) {
    if (!IDENT.test(key)) {
      throw new Error(`bake: param key "${key}" is not a valid WGSL identifier`);
    }
  }
  const fields = keys.length
    ? keys.map((k) => `  ${k} : f32,`).join('\n')
    : '  _unused : f32,';

  const code = /* wgsl */ `
struct Params {
${fields}
}
@group(0) @binding(0) var<uniform> P : Params;

struct VOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
}

@vertex fn vs(@builtin(vertex_index) vi : u32) -> VOut {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out : VOut;
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(xy.x, 1.0 - xy.y);
  return out;
}

fn shade(uv : vec2f, params : Params) -> vec4f {
${recipe.wgslBody}
}

@fragment fn fs(v : VOut) -> @location(0) vec4f {
  return shade(v.uv, P);
}
`;

  const uniformData = new Float32Array(Math.max(4, keys.length));
  keys.forEach((k, i) => {
    uniformData[i] = recipe.params[k]!;
  });
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);

  const module = device.createShaderModule({ label: `bake:${recipe.id}`, code });
  const pipeline = device.createRenderPipeline({
    label: `bake:${recipe.id}`,
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const texture = device.createTexture({
    label: `tex:${recipe.id}`,
    size: [recipe.size, recipe.size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: texture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return texture;
}
