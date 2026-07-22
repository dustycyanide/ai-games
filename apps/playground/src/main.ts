/**
 * Playground: pick an asset from assets/ in the sidebar, preview it live on a
 * raw-WebGPU canvas (OrbitCamera + MeshRenderer over a subtle ground grid),
 * and tune its zod Params through a Tweakpane panel generated from
 * z.toJSONSchema(Params) (see panel.ts). Every edit regenerates the asset
 * (debounced ~60ms) with a fresh Prng from the current seed, then runs the
 * asset's capsule validate() — green on-style badge when clean, red violation
 * list otherwise. Save posts the record to /api/params (writes asset.json);
 * Finalize posts to /api/finalize (writes asset.lock.json with sha256
 * hashes) — both served in dev by plugins/asset-io.ts.
 */

import {
  AssetRecordSchema,
  CapsuleManifestSchema,
  LockfileSchema,
  makePrng,
  type AssetModule,
  type AssetOutput,
  type CapsuleManifest,
  type CapsuleModule,
} from '@ai-games/schema';
import {
  DebugOverlay,
  initGPU,
  Input,
  MeshRenderer,
  NoWebGPUError,
  OrbitCamera,
  startLoop,
  type DrawItem,
} from '@ai-games/core';
import { z } from 'zod';
import { Pane } from 'tweakpane';
import { buildParamsPanel, type JsonSchemaNode } from './panel';
import { groundGrid } from './grid';
import { initToasts, installErrorSurface, toast } from './toast';
import './style.css';

// ---------------------------------------------------------------------------
// Asset + capsule discovery (lazy: modules load on first selection).

const genModules = import.meta.glob<AssetModule>('../../../assets/*/gen.ts', {
  import: 'default',
});
const recordFiles = import.meta.glob<unknown>('../../../assets/*/asset.json', {
  import: 'default',
});
const capsuleTsFiles = import.meta.glob<CapsuleModule>('../../../capsules/*/capsule.ts', {
  import: 'default',
});
const capsuleJsonFiles = import.meta.glob<unknown>('../../../capsules/*/capsule.json', {
  import: 'default',
});

function slugOf(path: string): string {
  const m = /\/assets\/([^/]+)\//.exec(path);
  return m?.[1] ?? path;
}

function capsulePathFor(paths: string[], id: string): string | undefined {
  return paths.find((p) => /\/capsules\/([^/]+)\//.exec(p)?.[1] === id);
}

// ---------------------------------------------------------------------------
// DOM.

function must<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`playground: missing element ${what}`);
  return value;
}

const canvas = must(document.querySelector<HTMLCanvasElement>('#canvas'), '#canvas');
const stage = must(document.querySelector<HTMLElement>('#stage'), '#stage');
const overlay = must(document.querySelector<HTMLElement>('#overlay'), '#overlay');
const assetList = must(document.querySelector<HTMLUListElement>('#asset-list'), '#asset-list');
const paneHost = must(document.querySelector<HTMLElement>('#pane-host'), '#pane-host');
const capsuleStatus = must(document.querySelector<HTMLElement>('#capsule-status'), '#capsule-status');
const violationsEl = must(document.querySelector<HTMLUListElement>('#violations'), '#violations');
const genErrorEl = must(document.querySelector<HTMLElement>('#gen-error'), '#gen-error');
const lockInfoEl = must(document.querySelector<HTMLElement>('#lock-info'), '#lock-info');
const toastsEl = must(document.querySelector<HTMLElement>('#toasts'), '#toasts');

function showOverlay(message: string): void {
  overlay.textContent = message;
  overlay.hidden = false;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// State. `assetItems` is read by the render loop every frame; regenerate()
// swaps it wholesale so a half-built frame never renders.

// Type alias (not interface) so it satisfies Tweakpane's Bindable for the seed binding.
type ActiveAsset = {
  slug: string;
  module: AssetModule;
  manifest: CapsuleManifest | null;
  capsule: CapsuleModule | null;
  seed: number;
  params: Record<string, unknown>;
};

let active: ActiveAsset | null = null;
let assetItems: DrawItem[] = [];
let pane: Pane | null = null;

// ---------------------------------------------------------------------------
// Generation + validation.

let regenTimer = 0;
function scheduleRegenerate(): void {
  window.clearTimeout(regenTimer);
  regenTimer = window.setTimeout(regenerate, 60);
}

function regenerate(): void {
  if (active === null) return;
  const a = active;
  genErrorEl.hidden = true;
  try {
    const output = a.module.generate({ seed: a.seed, rng: makePrng(a.seed) }, a.params);
    assetItems = toDrawItems(output);
    showValidation(a, output);
  } catch (err) {
    assetItems = [];
    genErrorEl.textContent = `generate() failed: ${messageOf(err)}`;
    genErrorEl.hidden = false;
    clearValidation();
  }
}

function toDrawItems(output: AssetOutput): DrawItem[] {
  const items: DrawItem[] = [];
  if (output.geometry !== undefined) items.push({ bundle: output.geometry });
  for (const group of output.instances ?? []) {
    items.push({ bundle: group.bundle, transforms: group.transforms });
  }
  return items;
}

function clearValidation(): void {
  capsuleStatus.hidden = true;
  violationsEl.replaceChildren();
}

function showValidation(a: ActiveAsset, output: AssetOutput): void {
  violationsEl.replaceChildren();
  if (a.capsule === null || a.manifest === null) {
    capsuleStatus.hidden = false;
    capsuleStatus.className = 'badge bad';
    capsuleStatus.textContent = `capsule ${a.module.meta.capsule} not found`;
    return;
  }
  try {
    const result = a.capsule.validate(output, a.manifest);
    capsuleStatus.hidden = false;
    if (result.ok) {
      capsuleStatus.className = 'badge ok';
      capsuleStatus.textContent = `on-style · ${a.module.meta.capsule}`;
    } else {
      capsuleStatus.className = 'badge bad';
      capsuleStatus.textContent = `${String(result.violations.length)} violation${result.violations.length === 1 ? '' : 's'} · ${a.module.meta.capsule}`;
      for (const violation of result.violations) {
        const li = document.createElement('li');
        li.textContent = violation;
        violationsEl.append(li);
      }
    }
  } catch (err) {
    clearValidation();
    toast(`capsule validate() threw: ${messageOf(err)}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Save / Finalize.

function errorOf(data: unknown, status: number): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    return String((data as { error: unknown }).error);
  }
  return `HTTP ${String(status)}`;
}

async function save(): Promise<void> {
  if (active === null) return;
  const a = active;
  const res = await fetch('/api/params', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      slug: a.slug,
      capsule: a.module.meta.capsule,
      seed: a.seed,
      params: a.params,
    }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) toast(`saved assets/${a.slug}/asset.json`);
  else toast(`save failed: ${errorOf(data, res.status)}`, 'error');
}

async function finalize(): Promise<void> {
  if (active === null) return;
  const a = active;
  const res = await fetch('/api/finalize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: a.slug }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    toast(`finalize failed: ${errorOf(data, res.status)}`, 'error');
    return;
  }
  const parsed = LockfileSchema.safeParse(
    typeof data === 'object' && data !== null && 'lockfile' in data
      ? (data as { lockfile: unknown }).lockfile
      : null,
  );
  if (!parsed.success) {
    toast('finalize returned an unexpected payload', 'error');
    return;
  }
  const lock = parsed.data;
  lockInfoEl.hidden = false;
  lockInfoEl.textContent = `lock v${String(lock.version)} · gen ${lock.generatorHash.slice(0, 12)} · capsule ${lock.capsuleHash.slice(0, 12)} · ${lock.finalizedAt}`;
  toast(`finalized assets/${a.slug}/asset.lock.json`);
}

// ---------------------------------------------------------------------------
// Panel.

function rebuildPanel(): void {
  pane?.dispose();
  pane = null;
  if (active === null) return;
  const a = active;
  const p = new Pane({ container: paneHost, title: a.module.meta.name });
  pane = p;

  p.addBinding(a, 'seed', { step: 1 });
  p.addButton({ title: 'reroll seed' }).on('click', () => {
    a.seed = Math.floor(Math.random() * 0x100000000);
    p.refresh();
    scheduleRegenerate();
  });

  let schema: JsonSchemaNode = {};
  try {
    schema = z.toJSONSchema(a.module.Params) as unknown as JsonSchemaNode;
  } catch (err) {
    toast(`params schema not serializable: ${messageOf(err)}`, 'error');
  }
  const skipped = buildParamsPanel(p, schema, a.params);
  if (skipped.length > 0) {
    toast(`no control for param(s): ${skipped.join(', ')}`, 'error');
  }

  // One subscription covers seed + every generated control (events bubble).
  p.on('change', scheduleRegenerate);

  p.addButton({ title: 'Save' }).on('click', () => {
    void save().catch((err: unknown) => toast(`save failed: ${messageOf(err)}`, 'error'));
  });
  p.addButton({ title: 'Finalize' }).on('click', () => {
    void finalize().catch((err: unknown) => toast(`finalize failed: ${messageOf(err)}`, 'error'));
  });
}

// ---------------------------------------------------------------------------
// Asset selection.

async function selectAsset(slug: string): Promise<void> {
  const genPath = Object.keys(genModules).find((p) => slugOf(p) === slug);
  const recordPath = Object.keys(recordFiles).find((p) => slugOf(p) === slug);
  if (genPath === undefined || recordPath === undefined) {
    toast(`asset ${slug} is missing gen.ts or asset.json`, 'error');
    return;
  }

  const mod = await genModules[genPath]();
  const record = AssetRecordSchema.parse(await recordFiles[recordPath]());

  // Run saved params through the asset's own zod schema so defaults fill any
  // gaps; fall back to pure defaults when the saved file no longer parses.
  let params: Record<string, unknown>;
  const parsed = mod.Params.safeParse(record.params);
  if (parsed.success) {
    params = parsed.data as Record<string, unknown>;
  } else {
    toast(`asset.json params invalid, using defaults: ${parsed.error.message}`, 'error');
    params = mod.Params.parse({}) as Record<string, unknown>;
  }

  const capsuleId = mod.meta.capsule.split('@')[0] ?? mod.meta.capsule;
  let manifest: CapsuleManifest | null = null;
  let capsule: CapsuleModule | null = null;
  const jsonPath = capsulePathFor(Object.keys(capsuleJsonFiles), capsuleId);
  const tsPath = capsulePathFor(Object.keys(capsuleTsFiles), capsuleId);
  if (jsonPath !== undefined && tsPath !== undefined) {
    manifest = CapsuleManifestSchema.parse(await capsuleJsonFiles[jsonPath]());
    capsule = await capsuleTsFiles[tsPath]();
  }

  active = { slug, module: mod, manifest, capsule, seed: record.seed, params };
  lockInfoEl.hidden = true;

  for (const button of assetList.querySelectorAll('button')) {
    button.classList.toggle('active', button.dataset['slug'] === slug);
  }

  rebuildPanel();
  regenerate();
}

function renderAssetList(): void {
  for (const path of Object.keys(genModules).sort()) {
    const slug = slugOf(path);
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = slug;
    button.dataset['slug'] = slug;
    button.addEventListener('click', () => {
      void selectAsset(slug).catch((err: unknown) => {
        toast(`failed to load ${slug}: ${messageOf(err)}`, 'error');
      });
    });
    li.append(button);
    assetList.append(li);
  }
}

// ---------------------------------------------------------------------------
// Boot.

async function bootstrap(): Promise<void> {
  initToasts(toastsEl);
  installErrorSurface();
  renderAssetList();

  // Select the first asset so the panel is alive even if the GPU path fails.
  const first = Object.keys(genModules).sort()[0];
  if (first !== undefined) {
    void selectAsset(slugOf(first)).catch((err: unknown) => {
      toast(`failed to load ${slugOf(first)}: ${messageOf(err)}`, 'error');
    });
  }

  try {
    const gpu = await initGPU(canvas);
    gpu.device.addEventListener('uncapturederror', (ev) => {
      toast(`GPU: ${ev.error.message}`, 'error');
    });
    new ResizeObserver(() => {
      gpu.resize();
    }).observe(canvas);

    const input = new Input();
    input.attach(canvas);
    const camera = new OrbitCamera({ distance: 6 });
    const renderer = new MeshRenderer(gpu);
    const fps = new DebugOverlay(stage);
    const grid: DrawItem = { bundle: groundGrid() };

    startLoop({
      update(dt) {
        camera.update(input, dt);
        input.endFrame();
      },
      render(_alpha, time) {
        const aspect = canvas.width / Math.max(1, canvas.height);
        renderer.draw({
          viewProj: camera.viewProj(aspect),
          eye: camera.eye,
          time,
          items: [grid, ...assetItems],
          clearColor: [0.063, 0.063, 0.078, 1],
        });
        fps.tick(performance.now());
      },
    });
  } catch (err) {
    if (err instanceof NoWebGPUError) {
      showOverlay(
        'This browser does not support WebGPU. Use a recent Chrome, Edge, or Safari - the playground renders everything on the GPU.',
      );
    } else {
      showOverlay(`Renderer not ready: ${messageOf(err)}`);
    }
  }
}

void bootstrap();
