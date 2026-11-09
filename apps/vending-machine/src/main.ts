/**
 * Fizzwick's Tonic-O-Matic — entry point. Builds the renderer (ACES + bloom),
 * the room and machine, wires input (orbit, click-to-press, keyboard, HUD) and
 * runs the state: current flavour, livery-swap power flicker, vend sequence,
 * collected perks and the four-of-four jackpot.
 */

import '@fontsource/bebas-neue/400.css';
import '@fontsource/lobster/400.css';
import './style.css';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { Sfx } from './audio';
import { FLAVORS, type Flavor, type PerkId } from './flavors';
import { Hud } from './hud';
import { VendingMachine } from './machine';
import { Room } from './room';
import { loadFonts } from './textures';
import { VendSequence } from './vend';

const BG = 0x05060a;
const TARGET = new THREE.Vector3(0, 1.0, 0);

/**
 * Reflection environment: a dark box with a few bright panels. Chrome needs
 * contrast to read as chrome, so this is mostly black with a warm key, a cool
 * rim and a couple of strips — not a bright, evenly lit room.
 */
function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshBasicMaterial({ color: 0x0c0d12, side: THREE.BackSide })));
  const panel = (color: number, gain: number, w: number, h: number, x: number, y: number, z: number): void => {
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    mat.color.set(color).multiplyScalar(gain);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(0xffdcae, 11, 2.6, 1.3, -2.6, 2.8, 2.6); // warm key, up and to the left
  panel(0xffffff, 7, 4.5, 0.3, 0.5, 3.4, -1.5); // overhead strip
  panel(0x8fb4ff, 5, 1.1, 3.2, 5, 0.4, -1.2); // cool rim
  panel(0xffa25e, 2.2, 3.5, 0.7, 0.5, -1.8, 5); // low warm bounce
  panel(0x3a332a, 1, 12, 12, 0, -3.9, 0.01); // floor
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(s, 0.03).texture;
  pmrem.dispose();
  return tex;
}

async function boot(): Promise<void> {
  await loadFonts();

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const fog = new THREE.FogExp2(BG, 0.05);
  scene.fog = fog;
  const env = studioEnvironment(renderer);
  scene.environment = env;
  scene.environmentIntensity = 0.35;

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 60);
  camera.position.set(1.5, 1.36, 4.9);
  scene.add(camera);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(TARGET);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.0;
  controls.maxDistance = 6.2;
  controls.minPolarAngle = 1.0;
  controls.maxPolarAngle = 1.64;
  controls.minAzimuthAngle = -0.42;
  controls.maxAzimuthAngle = 1.1;

  // --- world ---------------------------------------------------------------

  let current = 0;
  const machine = new VendingMachine(env, FLAVORS[current]!);
  machine.warm();
  const room = new Room(env, machine.kit);
  scene.add(room.group, machine.group);

  const hero = machine.kit.full(machine.bottleMaterials);
  scene.add(hero.group);
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.017, 0.003, 24),
    new THREE.MeshStandardMaterial({ color: 0xe0b860, metalness: 1, roughness: 0.3, emissive: 0x6a4a10, envMap: env, envMapIntensity: 1.6 }),
  );
  scene.add(coin);
  const handLight = new THREE.PointLight(0xfff0d8, 0, 2.2, 2);
  handLight.position.set(0.25, 0.2, -0.2);
  camera.add(handLight);

  // --- post ----------------------------------------------------------------

  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.36, 0.6, 2.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Portrait screens need a wider lens to keep the whole machine in frame.
    camera.fov = camera.aspect < 0.8 ? 58 : camera.aspect < 1.2 ? 46 : 38;
    // Slide the picture so the machine sits between the HUD card and the dock:
    // up a little on wide screens, down on portrait ones where the card is on top.
    camera.setViewOffset(w, h, 0, Math.round(h * (camera.aspect < 0.8 ? -0.13 : 0.07)), w, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // --- state ---------------------------------------------------------------

  const sfx = new Sfx();
  const owned = new Set<PerkId>();
  let time = 0;
  let bootT = 0;
  let swap: { t: number; to: number; done: boolean } | null = null;
  let jackpotDone = false;
  let jackpotAt = Infinity;
  let jackpotUntil = 0;

  const flavor = (): Flavor => FLAVORS[current]!;

  const hud = new Hud({
    onSelect: (i) => selectFlavor(i),
    onVend: () => vendNow(),
    onMute: () => {
      sfx.unlock();
      sfx.setMuted(!sfx.muted);
      return sfx.muted;
    },
    onReset: () => {
      owned.clear();
      jackpotDone = false;
      jackpotAt = Infinity;
      jackpotUntil = 0;
      hud.setOwned(owned, flavor());
    },
  });
  hud.setFlavor(flavor(), owned);

  const vend = new VendSequence({
    machine,
    camera,
    sfx,
    hero,
    coin,
    handLight,
    onAward: (f) => {
      const isNew = !owned.has(f.perk);
      owned.add(f.perk);
      hud.flash(f.glow);
      hud.setOwned(owned, flavor());
      hud.toast(isNew ? `${f.perkName} acquired` : `Another ${f.name1}`, isNew ? f.perkBlurb : 'Still got it.', f.glow);
      sfx.jingle(f);
      if (owned.size === FLAVORS.length && !jackpotDone) {
        jackpotDone = true;
        jackpotAt = time + 2.4;
      }
    },
  });

  function vendNow(): void {
    sfx.unlock();
    if (vend.active || swap) return;
    vend.start(flavor());
  }

  function selectFlavor(i: number): void {
    sfx.unlock();
    if (vend.active || swap || i === current || !FLAVORS[i]) return;
    swap = { t: 0, to: i, done: false };
    sfx.button();
    sfx.zap();
  }

  // --- input ---------------------------------------------------------------

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const targets: THREE.Object3D[] = [machine.vendButton, ...machine.flavorButtons];

  function pick(ev: PointerEvent): THREE.Object3D | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !targets.includes(o)) o = o.parent;
    return o;
  }

  let downX = 0;
  let downY = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    downX = ev.clientX;
    downY = ev.clientY;
    sfx.unlock();
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
    const o = pick(ev);
    if (!o) return;
    if (o === machine.vendButton) vendNow();
    else selectFlavor(o.userData.flavorIndex as number);
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.buttons !== 0) return;
    canvas.style.cursor = pick(ev) ? 'pointer' : 'grab';
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.target instanceof HTMLButtonElement && (ev.code === 'Space' || ev.code === 'Enter')) return;
    if (ev.code === 'Space' || ev.code === 'Enter') {
      ev.preventDefault();
      vendNow();
    } else if (ev.key >= '1' && ev.key <= '4') {
      selectFlavor(Number(ev.key) - 1);
    } else if (ev.code === 'ArrowRight') {
      selectFlavor((current + 1) % FLAVORS.length);
    } else if (ev.code === 'ArrowLeft') {
      selectFlavor((current + FLAVORS.length - 1) % FLAVORS.length);
    } else if (ev.key.toLowerCase() === 'm') {
      document.getElementById('mute')?.click();
    }
  });

  // --- loop ----------------------------------------------------------------

  /** Power level during a flicker ramp: mostly rising, with random dropouts. */
  const flicker = (u: number): number => (Math.random() < 0.38 * (1 - u) ? 0.12 : 1) * Math.min(1, u * 1.4);

  let last = performance.now();
  function frame(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;

    // Power: boot-up, or a brown-out while the livery swaps.
    if (swap) {
      swap.t += dt;
      const u = swap.t / 0.8;
      if (u < 0.3) {
        machine.power = (1 - u / 0.3) * (Math.random() < 0.4 ? 0.2 : 1);
      } else {
        if (!swap.done) {
          swap.done = true;
          current = swap.to;
          machine.setFlavor(flavor());
          hud.setFlavor(flavor(), owned);
          sfx.powerUp();
        }
        machine.power = flicker((u - 0.3) / 0.7);
      }
      if (u >= 1) {
        swap = null;
        machine.power = 1;
      }
    } else if (bootT < 1.5) {
      bootT += dt;
      machine.power = bootT < 0.3 ? 0 : flicker((bootT - 0.3) / 1.2);
    } else {
      machine.power = 1;
    }

    // Perks.
    const hustle = owned.has('hustle');
    vend.speed = hustle ? 1.7 : 1;
    machine.tempo = THREE.MathUtils.damp(machine.tempo, hustle ? 2 : 1, 2, dt);
    room.moon = THREE.MathUtils.damp(room.moon, owned.has('moonsight') ? 1 : 0, 1.6, dt);
    room.stardust = THREE.MathUtils.damp(room.stardust, owned.has('fortune') ? 1 : 0, 1.6, dt);
    fog.density = 0.05 - 0.022 * room.moon;

    if (time >= jackpotAt) {
      jackpotAt = Infinity;
      jackpotUntil = time + 7;
      sfx.jackpot();
      hud.toast('Full house!', 'All four tonics down. The machine approves.', '#ffe08a');
    }

    controls.update();
    vend.update(dt);
    machine.bulbMode = time < jackpotUntil ? 'jackpot' : vend.lightsBusy ? 'busy' : 'idle';
    machine.update(time, dt);
    room.update(time, dt);
    hud.setBusy(vend.active || swap !== null);

    composer.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Handle for poking at the scene from the console and from browser tests.
    (window as unknown as Record<string, unknown>).__tonic = { scene, camera, controls, machine, room, vend, owned, bloom, renderer, selectFlavor, vendNow };
  }
}

boot().catch((err: unknown) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'This machine needs WebGL 2 to run.';
});
