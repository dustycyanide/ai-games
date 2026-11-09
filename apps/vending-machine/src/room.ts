/**
 * The back room the machine lives in: checker tile, stained plaster over plank
 * wainscot, a hanging work lamp (the key light, with a loose-connection
 * flicker), a crate of empties, a poster, pipework, and drifting dust.
 */

import * as THREE from 'three';
import type { BottleKit } from './bottle';
import { CAB } from './layout';
import {
  dustSpriteTexture,
  floorTexture,
  posterTexture,
  smudgeTexture,
  starSpriteTexture,
  wallTexture,
  woodTexture,
} from './textures';

const WALL_Z = -(CAB.d / 2) - 0.14;
const LEFT_X = -2.7;

export class Room {
  readonly group = new THREE.Group();
  /** 0..1, eased by the caller: Moonsight perk brightens the room. */
  moon = 0;
  /** 0..1, eased by the caller: Fortune perk turns dust to stardust. */
  stardust = 0;

  private readonly lamp = new THREE.SpotLight(0xffd8a6, 0, 12, 0.85, 0.7, 1.6);
  private readonly bulbMat = new THREE.MeshBasicMaterial();
  private readonly hemi = new THREE.HemisphereLight(0x7d8fb3, 0x2a1d12, 0.5);
  private readonly moonLight = new THREE.DirectionalLight(0x9fb8ff, 0);
  private readonly dust: THREE.Points;
  private readonly stars: THREE.Points;
  private readonly dustMat: THREE.PointsMaterial;
  private readonly starMat: THREE.PointsMaterial;
  private flickerAt = 6;
  private flickerUntil = 0;

  constructor(env: THREE.Texture, kit: BottleKit) {
    const smudge = smudgeTexture();
    smudge.repeat.set(5, 5);

    // Floor.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshStandardMaterial({
        map: floorTexture(),
        roughness: 0.62,
        roughnessMap: smudge,
        envMap: env,
        envMapIntensity: 0.25,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(1, 0, 3);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Walls.
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.92 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), wallMat);
    backWall.position.set(LEFT_X + 6, 2, WALL_Z);
    backWall.receiveShadow = true;
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(LEFT_X, 2, WALL_Z + 6);
    leftWall.receiveShadow = true;
    this.group.add(backWall, leftWall);

    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 0.8 });
    const trim = (len: number, h: number, t: number, y: number): THREE.Mesh[] => {
      const a = new THREE.Mesh(new THREE.BoxGeometry(len, h, t), wood);
      a.position.set(LEFT_X + len / 2, y, WALL_Z + t / 2);
      const b = new THREE.Mesh(new THREE.BoxGeometry(t, h, len), wood);
      b.position.set(LEFT_X + t / 2, y, WALL_Z + len / 2);
      for (const m of [a, b]) m.receiveShadow = m.castShadow = true;
      return [a, b];
    };
    this.group.add(...trim(12, 0.14, 0.03, 0.07), ...trim(12, 0.06, 0.045, 1.17));

    // Pipe run in the corner.
    const iron = new THREE.MeshStandardMaterial({ color: 0x4a3a30, metalness: 0.8, roughness: 0.6, envMap: env, envMapIntensity: 0.5 });
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 4, 16), iron);
    pipe.position.set(-1.55, 2, WALL_Z + 0.09);
    const pipe2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 12), iron);
    pipe2.position.set(-1.72, 2, WALL_Z + 0.07);
    this.group.add(pipe, pipe2);
    for (const y of [0.6, 1.9, 3.1]) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.14), iron);
      clamp.position.set(-1.63, y, WALL_Z + 0.07);
      this.group.add(clamp);
    }
    for (const o of [pipe, pipe2]) o.castShadow = o.receiveShadow = true;

    // Poster.
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.84),
      new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.95 }),
    );
    poster.position.set(1.42, 1.78, WALL_Z + 0.004);
    poster.rotation.z = -0.035;
    poster.receiveShadow = true;
    this.group.add(poster);

    // Power: socket on the wall and a sagging cable from the machine's back.
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.03), new THREE.MeshStandardMaterial({ color: 0xb9b19c, roughness: 0.6 }));
    socket.position.set(0.86, 0.42, WALL_Z + 0.015);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.36, 0.34, -CAB.d / 2),
          new THREE.Vector3(0.48, 0.1, -CAB.d / 2 - 0.05),
          new THREE.Vector3(0.66, 0.02, -CAB.d / 2 - 0.02),
          new THREE.Vector3(0.82, 0.12, WALL_Z + 0.06),
          new THREE.Vector3(0.86, 0.4, WALL_Z + 0.04),
        ]),
        40,
        0.011,
        8,
      ),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6 }),
    );
    cable.castShadow = true;
    this.group.add(socket, cable);

    this.buildCrate(env, kit);
    this.buildLamp();

    this.moonLight.position.set(3, 5, 4);
    this.group.add(this.hemi, this.moonLight);
    const rim = new THREE.DirectionalLight(0x5f7fd0, 0.5);
    rim.position.set(-4, 3, -1);
    this.group.add(rim);

    // Dust and stardust.
    this.dustMat = new THREE.PointsMaterial({
      map: dustSpriteTexture(),
      color: 0xffe2b8,
      size: 0.018,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.starMat = new THREE.PointsMaterial({
      map: starSpriteTexture(),
      color: 0xffd76a,
      size: 0.07,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = this.scatter(320, this.dustMat, 11);
    this.stars = this.scatter(110, this.starMat, 23);
    this.stars.visible = false;
    this.group.add(this.dust, this.stars);
  }

  private scatter(n: number, mat: THREE.PointsMaterial, salt: number): THREE.Points {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Cheap hash; these are motes, not assets, so no need for the PRNG.
      const h = (k: number): number => {
        const x = Math.sin(i * 127.1 + k * 311.7 + salt) * 43758.5453;
        return x - Math.floor(x);
      };
      pos[i * 3] = -2.4 + h(1) * 5.2;
      pos[i * 3 + 1] = 0.1 + h(2) * 3.1;
      pos[i * 3 + 2] = -0.3 + h(3) * 3.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildCrate(env: THREE.Texture, kit: BottleKit): void {
    const crate = new THREE.Group();
    crate.position.set(1.3, 0, 0.12);
    crate.rotation.y = -0.38;
    const mat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
    const w = 0.5;
    const d = 0.36;
    const h = 0.3;
    const t = 0.014;
    const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      crate.add(m);
    };
    add(w, t, d, 0, t / 2, 0);
    for (const y of [0.07, 0.165, 0.26]) {
      add(w, 0.075, t, 0, y, d / 2);
      add(w, 0.075, t, 0, y, -d / 2);
      add(t, 0.075, d, w / 2, y, 0);
      add(t, 0.075, d, -w / 2, y, 0);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(0.03, h, 0.03, sx * (w / 2 - 0.015), h / 2, sz * (d / 2 - 0.015));

    const glass = (color: number): THREE.Material =>
      new THREE.MeshPhysicalMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        roughness: 0.08,
        envMap: env,
        envMapIntensity: 1.4,
      });
    const green = glass(0x3f7a5a);
    const brown = glass(0x8a5a2a);
    const slots: [number, number][] = [[-0.16, -0.09], [-0.05, -0.1], [0.07, -0.08], [0.17, 0.09], [-0.15, 0.08], [0.02, 0.1]];
    slots.forEach(([x, z], i) => {
      const b = kit.empty(i % 3 === 0 ? brown : green);
      b.position.set(x, t, z);
      b.rotation.y = i * 1.7;
      crate.add(b);
    });
    this.group.add(crate);

    // One that rolled away.
    const stray = kit.empty(green);
    stray.rotation.set(0, 0.9, Math.PI / 2);
    stray.position.set(0.92, 0.035, 0.78);
    this.group.add(stray);
  }

  private buildLamp(): void {
    const at = new THREE.Vector3(-0.55, 3.05, 1.55);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.3, 0.2, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1f3a30, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
    );
    shade.position.copy(at).add(new THREE.Vector3(0, 0.06, 0));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), this.bulbMat);
    bulb.position.copy(at).add(new THREE.Vector3(0, -0.02, 0));
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 3, 6), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    cord.position.copy(at).add(new THREE.Vector3(0, 1.66, 0));
    this.lamp.position.copy(at);
    this.lamp.target.position.set(0.15, 0.7, 0.1);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.camera.near = 0.5;
    this.lamp.shadow.camera.far = 9;
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.015;
    this.group.add(shade, bulb, cord, this.lamp, this.lamp.target);
  }

  update(time: number, dt: number): void {
    // Loose-connection flicker on the work lamp.
    if (time > this.flickerAt) {
      this.flickerUntil = time + 0.1 + Math.random() * 0.25;
      this.flickerAt = time + 5 + Math.random() * 9;
    }
    const f = time < this.flickerUntil ? 0.35 + 0.65 * Math.abs(Math.sin(time * 61)) : 1;
    this.lamp.intensity = 11 * f;
    this.bulbMat.color.setRGB(7 * f, 5.2 * f, 3 * f);

    this.hemi.intensity = 0.5 + this.moon * 1.1;
    this.moonLight.intensity = this.moon * 1.5;

    // Dust drifts; stardust rises and twinkles.
    this.drift(this.dust, dt, 0.012, time);
    this.dustMat.opacity = 0.4 * (1 - this.stardust * 0.6);
    this.stars.visible = this.stardust > 0.01;
    if (this.stars.visible) {
      this.drift(this.stars, dt, 0.09, time);
      this.starMat.opacity = this.stardust * (0.65 + 0.35 * Math.sin(time * 7));
      this.starMat.size = 0.06 + 0.02 * Math.sin(time * 3.1);
    }
  }

  private drift(pts: THREE.Points, dt: number, rise: number, time: number): void {
    const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * rise * (0.5 + ((i * 7) % 5) / 5);
      if (y > 3.2) y = 0.1;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.35 + i) * dt * 0.012);
    }
    pos.needsUpdate = true;
  }
}
