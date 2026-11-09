/**
 * The vend sequence, as one scrubbed timeline: token flies into the slot, the
 * mechanism rumbles, a bottle drops into the bay, comes up to the camera, the
 * cap pops, the bottle tips back and drains, and the perk is awarded.
 */

import * as THREE from 'three';
import type { Sfx } from './audio';
import type { Bottle } from './bottle';
import type { Flavor } from './flavors';
import type { VendingMachine } from './machine';

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const seg = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
const ease = (u: number): number => u * u * (3 - 2 * u);

function bounceOut(u: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
}

const END = 5.95;

export interface VendParts {
  machine: VendingMachine;
  camera: THREE.PerspectiveCamera;
  sfx: Sfx;
  hero: Bottle;
  coin: THREE.Mesh;
  handLight: THREE.PointLight;
  onAward: (f: Flavor) => void;
}

export class VendSequence {
  active = false;
  /** Timeline rate; the Hustle perk raises it. */
  speed = 1;
  /** True while the marquee should chase fast. */
  lightsBusy = false;

  private t = 0;
  private flavor: Flavor | null = null;
  private readonly fired = new Set<string>();
  private readonly p: VendParts;

  private readonly bay = new THREE.Vector3();
  private readonly slot = new THREE.Vector3();
  private readonly hold = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  private readonly holdQ = new THREE.Quaternion();
  private readonly tiltQ = new THREE.Quaternion();
  private readonly upright = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();

  constructor(parts: VendParts) {
    this.p = parts;
    parts.hero.group.visible = false;
    parts.coin.visible = false;
  }

  start(f: Flavor): void {
    if (this.active) return;
    this.active = true;
    this.t = 0;
    this.flavor = f;
    this.fired.clear();
    const { hero, sfx } = this.p;
    hero.liquid.scale.y = 1;
    hero.cap.visible = true;
    hero.cap.position.set(0, hero.capY, 0);
    hero.cap.rotation.set(0, 0, 0);
    sfx.button();
  }

  private at(name: string, time: number, fn: () => void): void {
    if (this.t >= time && !this.fired.has(name)) {
      this.fired.add(name);
      fn();
    }
  }

  update(dt: number): void {
    const { machine, camera, sfx, hero, coin, handLight } = this.p;
    if (!this.active || !this.flavor) return;
    this.t += dt * this.speed;
    const t = this.t;

    // Button dips.
    machine.press = ease(seg(t, 0, 0.1)) * (1 - ease(seg(t, 0.22, 0.4)));

    // Token: from the player's hand into the slot.
    camera.updateMatrixWorld();
    machine.slotWorld(this.slot);
    const cu = seg(t, 0.02, 0.45);
    coin.visible = cu > 0 && cu < 1;
    if (coin.visible) {
      camera.localToWorld(this.from.set(0.26, -0.24, -0.75));
      coin.position.lerpVectors(this.from, this.slot, ease(cu));
      coin.position.y += Math.sin(cu * Math.PI) * 0.22;
      coin.rotation.set(cu * 16, 0.4, cu * 5);
      coin.scale.setScalar(1 + 1.2 * Math.sin(cu * Math.PI));
    }
    this.at('coin', 0.45, () => sfx.coin());

    // Mechanism.
    this.at('whir', 0.55, () => sfx.whir(1.15 / this.speed));
    machine.rumble = ease(seg(t, 0.5, 0.75)) * (1 - ease(seg(t, 1.55, 1.8)));
    this.lightsBusy = t > 0.45 && t < 2.3;

    // Bottle drops into the bay.
    machine.bayWorld(this.bay);
    const drop = seg(t, 1.7, 2.12);
    hero.group.visible = t >= 1.7;
    this.at('clunk', 1.7 + 0.42 / 2.75, () => sfx.clunk());
    machine.bayGlow = ease(seg(t, 1.65, 1.9)) * (1 - ease(seg(t, 2.9, 3.3)));

    // Bottle comes to the camera, tips back, then drops out of view.
    const fly = ease(seg(t, 2.55, 3.25));
    const drink = ease(seg(t, 3.75, 4.15)) * (1 - ease(seg(t, 5.1, 5.4)));
    const lower = seg(t, 5.3, 5.85);
    // Held: upright in front of the view. Drinking: the mouth comes to the
    // viewer's lips (just below the frame) and the base swings up and away.
    camera.localToWorld(this.hold.set(0.015, -0.075 + 0.05 * drink - 0.75 * lower * lower, -0.78 + 0.38 * drink));
    this.tiltQ.setFromEuler(this.euler.set(-0.12 + 2.14 * drink, 0.35 * (1 - drink), 0.1 * (1 - drink)));
    this.holdQ.copy(camera.quaternion).multiply(this.tiltQ);

    this.bay.y += 0.3 * (1 - bounceOut(drop));
    hero.group.position.lerpVectors(this.bay, this.hold, fly);
    hero.group.position.y += Math.sin(fly * Math.PI) * 0.12;
    hero.group.quaternion.slerpQuaternions(this.upright, this.holdQ, fly);
    handLight.intensity = fly * (1 - lower) * 0.5;

    // Cap pops.
    this.at('pop', 3.4, () => sfx.pop());
    const cap = seg(t, 3.4, 3.95);
    if (cap > 0) {
      hero.cap.visible = cap < 1;
      hero.cap.position.set(0.11 * cap, hero.capY + 0.3 * cap - 0.42 * cap * cap, 0.04 * cap);
      hero.cap.rotation.set(cap * 7, 0, cap * 11);
    }

    // Glug.
    this.at('gulp1', 4.15, () => sfx.gulp());
    this.at('gulp2', 4.48, () => sfx.gulp());
    this.at('gulp3', 4.8, () => sfx.gulp());
    hero.liquid.scale.y = Math.max(0.04, 1 - 0.96 * seg(t, 4.05, 5.1));

    this.at('award', 5.25, () => this.p.onAward(this.flavor!));

    if (t >= END) {
      this.active = false;
      this.lightsBusy = false;
      hero.group.visible = false;
      coin.visible = false;
      handLight.intensity = 0;
      machine.rumble = 0;
      machine.press = 0;
      machine.bayGlow = 0;
    }
  }
}
