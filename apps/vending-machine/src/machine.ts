/**
 * The Tonic-O-Matic itself. A hollow enamel cabinet (extruded outline with a
 * real porthole and pick-up bay cut through the front), chrome hardware, a
 * bottle carousel behind a bubble window, a control column, an arched marquee
 * and an atom finial. `setFlavor` re-liveries everything; `update` drives the
 * lights and moving parts from a handful of public animation inputs.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BottleKit, type BottleMaterials } from './bottle';
import { FLAVORS, type Flavor } from './flavors';
import { ARCH, BAY, CAB, CONTROLS, LIGHTBOX, PLATE, PORT } from './layout';
import {
  archSignTexture,
  bottleLabelTexture,
  controlPlateTexture,
  frontPanelTexture,
  glowDiscTexture,
  lightboxTexture,
  shellGrimeTexture,
  smudgeTexture,
} from './textures';

export type BulbMode = 'idle' | 'busy' | 'jackpot';

interface Livery {
  panel: THREE.Texture;
  lightbox: THREE.Texture;
  arch: THREE.Texture;
  disc: THREE.Texture;
  label: THREE.Texture;
}

const HALF_PI = Math.PI / 2;
/** Total thickness of the bevelled front panel. */
const PANEL_T = 0.054;

// --- geometry helpers ------------------------------------------------------

/** Cabinet silhouette: big-radius shoulders, small-radius feet. */
function cabinetOutline(inset = 0): THREE.Shape {
  const w = CAB.w - inset * 2;
  const y0 = inset;
  const y1 = CAB.h - inset;
  const rt = CAB.rTop - inset;
  const rb = Math.max(0.005, CAB.rBot - inset);
  const x0 = -w / 2;
  const x1 = w / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rb, y0);
  s.lineTo(x1 - rb, y0);
  s.absarc(x1 - rb, y0 + rb, rb, -HALF_PI, 0, false);
  s.lineTo(x1, y1 - rt);
  s.absarc(x1 - rt, y1 - rt, rt, 0, HALF_PI, false);
  s.lineTo(x0 + rt, y1);
  s.absarc(x0 + rt, y1 - rt, rt, HALF_PI, Math.PI, false);
  s.lineTo(x0, y0 + rb);
  s.absarc(x0 + rb, y0 + rb, rb, Math.PI, Math.PI * 1.5, false);
  return s;
}

function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.absarc(x1 - r, y0 + r, r, -HALF_PI, 0, false);
  s.lineTo(x1, y1 - r);
  s.absarc(x1 - r, y1 - r, r, 0, HALF_PI, false);
  s.lineTo(x0 + r, y1);
  s.absarc(x0 + r, y1 - r, r, HALF_PI, Math.PI, false);
  s.lineTo(x0, y0 + r);
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** A bevelled frame: rounded rectangle with a rounded-rectangle hole. */
function frameGeometry(w: number, h: number, r: number, border: number, depth: number): THREE.ExtrudeGeometry {
  const shape = roundedRect(w + border * 2, h + border * 2, r + border);
  shape.holes.push(roundedRect(w, h, r));
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelOffset: -0.004,
    bevelSegments: 2,
    curveSegments: 10,
  });
}

function archShape(scale: number, yMin: number): THREE.Shape {
  const a = ARCH.a * scale;
  const b = ARCH.b * scale;
  const s = new THREE.Shape();
  s.moveTo(-a, yMin);
  s.lineTo(a, yMin);
  s.lineTo(a, ARCH.base);
  s.absellipse(0, ARCH.base, a, b, 0, Math.PI, false, 0);
  s.lineTo(-a, yMin);
  return s;
}

/** Weld coincident vertices and recompute normals so curved walls shade smoothly. */
function smooth(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

/** Rewrite uv as a planar projection of (x, y) onto the given rectangle. */
function planarUV(geo: THREE.BufferGeometry, x0: number, y0: number, w: number, h: number): void {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - x0) / w;
    uv[i * 2 + 1] = (pos.getY(i) - y0) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function bboxUV(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  planarUV(geo, b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
}

/** Cylinder whose axis points along +Z (towards the viewer on the front). */
function zCylinder(rFront: number, rBack: number, depth: number, seg = 32, open = false): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(rFront, rBack, depth, seg, 1, open);
  g.rotateX(HALF_PI);
  return g;
}

// --- the machine -----------------------------------------------------------

export class VendingMachine {
  /** Root; origin on the floor under the cabinet centre, front facing +Z. */
  readonly group = new THREE.Group();

  // Animation inputs, written by the vend sequence / main loop.
  /** 0 = dark, 1 = fully lit. */
  power = 0;
  /** 0..1 shake of the mechanism. */
  rumble = 0;
  /** 0..1 travel of the big button. */
  press = 0;
  /** 0..1 light in the pick-up bay. */
  bayGlow = 0;
  /** Speed multiplier for the idle motion. */
  tempo = 1;
  bulbMode: BulbMode = 'idle';

  /** Raycast targets. */
  readonly vendButton = new THREE.Group();
  readonly flavorButtons: THREE.Object3D[] = [];

  readonly kit = new BottleKit();
  readonly bottleMaterials: BottleMaterials;

  flavor: Flavor;

  private readonly body = new THREE.Group();
  /** Children use panel coordinates; z = 0 is the cabinet's front surface. */
  private readonly front = new THREE.Group();
  private readonly liveries = new Map<string, Livery>();

  private readonly paintFront: THREE.MeshPhysicalMaterial;
  private readonly paintShell: THREE.MeshPhysicalMaterial;
  private readonly chrome: THREE.MeshStandardMaterial;
  private readonly dark: THREE.MeshStandardMaterial;

  private readonly lightboxMat = new THREE.MeshBasicMaterial();
  private readonly archMat = new THREE.MeshBasicMaterial();
  private readonly discMat = new THREE.MeshBasicMaterial();
  private readonly neonMat = new THREE.MeshBasicMaterial();
  private readonly orbMat = new THREE.MeshBasicMaterial();
  private readonly electronMat = new THREE.MeshBasicMaterial();
  private readonly bayStripMat = new THREE.MeshBasicMaterial();
  private readonly vendMat: THREE.MeshStandardMaterial;
  private readonly jewelMats: THREE.MeshStandardMaterial[] = [];
  private readonly liquidMat: THREE.MeshStandardMaterial;
  private readonly labelMat: THREE.MeshStandardMaterial;

  private readonly signLight = new THREE.PointLight(0xffffff, 0, 5, 2);
  private readonly portLight = new THREE.PointLight(0xffffff, 0, 3.5, 2);
  /** No distance falloff: it sits centimetres from the bottles. */
  private readonly chamberLight = new THREE.PointLight(0xffffff, 0, 0.7, 0);
  private readonly bayLight = new THREE.PointLight(0xffffff, 0, 1.2, 2);

  private bulbs!: THREE.InstancedMesh;
  private readonly carousel = new THREE.Group();
  private readonly spinners: THREE.Object3D[] = [];
  private readonly vendCap = new THREE.Group();
  private readonly glow = new THREE.Color();
  private readonly tmpColor = new THREE.Color();
  private stutterAt = 4;
  private stutterUntil = 0;

  constructor(env: THREE.Texture, initial: Flavor) {
    this.flavor = initial;
    const smudge = smudgeTexture();

    this.paintFront = new THREE.MeshPhysicalMaterial({
      roughness: 0.55,
      roughnessMap: smudge,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      envMap: env,
      envMapIntensity: 0.55,
    });
    this.paintShell = new THREE.MeshPhysicalMaterial({
      map: shellGrimeTexture(),
      roughness: 0.55,
      clearcoat: 0.55,
      clearcoatRoughness: 0.28,
      envMap: env,
      envMapIntensity: 0.55,
    });
    this.chrome = new THREE.MeshStandardMaterial({
      color: 0xdfe3ea,
      metalness: 1,
      roughness: 0.26,
      roughnessMap: smudge,
      envMap: env,
      envMapIntensity: 1.5,
    });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.85, metalness: 0.2 });

    this.vendMat = new THREE.MeshStandardMaterial({ color: 0x241410, roughness: 0.25, envMap: env, envMapIntensity: 0.8 });
    this.liquidMat = new THREE.MeshStandardMaterial({ roughness: 0.35 });
    this.labelMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.bottleMaterials = {
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xd8efe6,
        transparent: true,
        opacity: 0.2,
        roughness: 0.04,
        envMap: env,
        envMapIntensity: 1.6,
        depthWrite: false,
      }),
      liquid: this.liquidMat,
      label: this.labelMat,
      cap: new THREE.MeshStandardMaterial({ color: 0xd9b25a, metalness: 1, roughness: 0.32, envMap: env, envMapIntensity: 1.4 }),
    };

    this.group.add(this.body);
    this.front.position.set(0, CAB.legs, CAB.d / 2);
    this.body.add(this.front);

    this.buildCabinet();
    this.buildPorthole(env);
    this.buildBay();
    this.buildLightbox();
    this.buildControls();
    this.buildTopper();
    this.buildTrim();

    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.noShadow) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });

    this.setFlavor(initial);
  }

  // --- construction --------------------------------------------------------

  private buildCabinet(): void {
    // Front panel with the porthole and bay cut out of it.
    const face = cabinetOutline();
    const port = new THREE.Path();
    port.absarc(PORT.x, PORT.y, PORT.r, 0, Math.PI * 2, true);
    face.holes.push(port, roundedRect(BAY.w, BAY.h, BAY.r, BAY.x, BAY.y));
    const panelGeo = new THREE.ExtrudeGeometry(face, {
      depth: 0.03,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelOffset: -0.012,
      bevelSegments: 3,
      curveSegments: 28,
    });
    planarUV(panelGeo, -CAB.w / 2, 0, CAB.w, CAB.h);
    const panel = new THREE.Mesh(panelGeo, this.paintFront);
    panel.position.z = -PANEL_T + 0.012;
    this.front.add(panel);

    // Hollow shell behind it: an extruded ring, so the outside wall is one
    // continuous smooth surface around the shoulders.
    const ring = cabinetOutline();
    ring.holes.push(cabinetOutline(0.03));
    const shellDepth = CAB.d - PANEL_T + 0.006;
    const shellGeo = smooth(new THREE.ExtrudeGeometry(ring, { depth: shellDepth, bevelEnabled: false, curveSegments: 28 }));
    // u: height up the cabinet, v: front-to-back, to match shellGrimeTexture.
    const pos = shellGeo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getY(i) / CAB.h;
      uv[i * 2 + 1] = pos.getZ(i) / shellDepth + pos.getX(i) * 0.37;
    }
    shellGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const shell = new THREE.Mesh(shellGeo, this.paintShell);
    shell.position.z = -CAB.d;
    this.front.add(shell);

    const back = new THREE.Mesh(new THREE.ShapeGeometry(cabinetOutline(), 20), this.dark);
    back.rotation.y = Math.PI;
    back.position.z = -CAB.d;
    this.front.add(back);

    // Legs.
    const legGeo = new THREE.CylinderGeometry(0.03, 0.022, CAB.legs, 16);
    const footGeo = new THREE.CylinderGeometry(0.04, 0.045, 0.012, 16);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, this.chrome);
        leg.position.set(sx * (CAB.w / 2 - 0.09), CAB.legs / 2, sz * (CAB.d / 2 - 0.08));
        const foot = new THREE.Mesh(footGeo, this.chrome);
        foot.position.set(leg.position.x, 0.006, leg.position.z);
        this.body.add(leg, foot);
      }
    }
  }

  private buildPorthole(env: THREE.Texture): void {
    const { x, y, r } = PORT;
    const chamberR = r + 0.06;
    const depth = 0.36;
    const zMid = -PANEL_T - depth / 2 + 0.006;

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x30323a,
      metalness: 0.9,
      roughness: 0.4,
      side: THREE.BackSide,
      envMap: env,
      envMapIntensity: 0.5,
    });
    const wall = new THREE.Mesh(zCylinder(chamberR, chamberR, depth, 40, true), wallMat);
    wall.position.set(x, y, zMid);
    wall.userData.noShadow = true;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(chamberR, 40), this.discMat);
    disc.position.set(x, y, zMid - depth / 2 + 0.002);
    disc.userData.noShadow = true;
    this.front.add(wall, disc);

    // Carousel: six bottles on a turntable.
    this.carousel.position.set(x, y - 0.135, zMid + 0.01);
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.012, 40), this.chrome);
    table.position.y = -0.006;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 12), this.chrome);
    pole.position.y = 0.15;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.01, 40), this.chrome);
    crown.position.y = 0.265;
    this.carousel.add(table, pole, crown);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const b = this.kit.full(this.bottleMaterials);
      b.group.position.set(Math.sin(a) * 0.118, 0, Math.cos(a) * 0.118);
      b.group.rotation.y = a;
      b.group.traverse((o) => (o.userData.noShadow = true));
      this.carousel.add(b.group);
    }
    this.carousel.traverse((o) => (o.userData.noShadow = true));
    this.front.add(this.carousel);

    this.chamberLight.position.set(x, y + 0.1, zMid + 0.12);
    this.front.add(this.chamberLight);

    // Bubble window.
    const R = 0.33;
    const theta = Math.asin((r + 0.005) / R);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 40, 10, 0, Math.PI * 2, 0, theta).rotateX(HALF_PI),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.07,
        roughness: 0.03,
        envMap: env,
        envMapIntensity: 2.2,
        depthWrite: false,
      }),
    );
    dome.position.set(x, y, -R * Math.cos(theta) + 0.004);
    dome.renderOrder = 5;
    dome.userData.noShadow = true;
    this.front.add(dome);

    const bezel = new THREE.Mesh(new THREE.TorusGeometry(r + 0.012, 0.022, 16, 72), this.chrome);
    bezel.position.set(x, y, 0.004);
    const neon = new THREE.Mesh(new THREE.TorusGeometry(r + 0.041, 0.006, 8, 96), this.neonMat);
    neon.position.set(x, y, 0.009);
    neon.userData.noShadow = true;
    this.front.add(bezel, neon);

    this.portLight.position.set(x, y + 0.05, 0.55);
    this.front.add(this.portLight);
  }

  private buildBay(): void {
    const { x, y, w, h } = BAY;
    const cw = w + 0.08;
    const ch = 0.62;
    const cd = 0.4;
    const floorY = y - h / 2 - 0.004;
    const liner = new THREE.Mesh(
      new THREE.BoxGeometry(cw, ch, cd),
      new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.6, side: THREE.BackSide }),
    );
    liner.position.set(x, floorY + ch / 2, -PANEL_T + 0.006 - cd / 2);
    liner.userData.noShadow = true;
    this.front.add(liner);

    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, 0.018), this.bayStripMat);
    strip.position.set(x, y + h / 2 - 0.04, -PANEL_T - cd + 0.012);
    strip.userData.noShadow = true;
    this.front.add(strip);

    const frame = new THREE.Mesh(frameGeometry(w, h, BAY.r, 0.028, 0.014), this.chrome);
    frame.position.set(x, y, -0.002);
    this.front.add(frame);

    // Drip lip.
    const lip = new THREE.Mesh(new RoundedBoxGeometry(w + 0.03, 0.014, 0.05, 3, 0.006), this.chrome);
    lip.position.set(x, y - h / 2 - 0.012, 0.03);
    this.front.add(lip);

    this.bayLight.position.set(x, y + 0.06, -0.1);
    this.front.add(this.bayLight);
  }

  private buildLightbox(): void {
    const { x, y, w, h } = LIGHTBOX;
    const frame = new THREE.Mesh(frameGeometry(w, h, 0.02, 0.022, 0.016), this.chrome);
    frame.position.set(x, y, -0.002);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.004, h + 0.004), this.lightboxMat);
    face.position.set(x, y, 0.004);
    face.userData.noShadow = true;
    this.front.add(frame, face);
  }

  private buildControls(): void {
    const plateGeo = new THREE.ExtrudeGeometry(roundedRect(PLATE.w, PLATE.h, 0.03, PLATE.x, PLATE.y), {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelOffset: -0.004,
      bevelSegments: 2,
      curveSegments: 10,
    });
    planarUV(plateGeo, PLATE.x - PLATE.w / 2, PLATE.y - PLATE.h / 2, PLATE.w, PLATE.h);
    const plate = new THREE.Mesh(
      plateGeo,
      new THREE.MeshStandardMaterial({
        map: controlPlateTexture(),
        metalness: 1,
        roughness: 0.42,
        envMap: this.chrome.envMap,
        envMapIntensity: 1.1,
      }),
    );
    this.front.add(plate);
    const z = 0.012;

    // Token slot.
    const slotBezel = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.09, 0.016, 3, 0.007), this.chrome);
    slotBezel.position.set(PLATE.x, CONTROLS.slotY, z + 0.006);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.046, 0.004), this.dark);
    slot.position.set(PLATE.x, CONTROLS.slotY, z + 0.0135);
    this.front.add(slotBezel, slot);

    // Four flavour jewels.
    const ringGeo = new THREE.TorusGeometry(0.029, 0.006, 10, 32);
    const jewelGeo = zCylinder(0.021, 0.025, 0.016, 24);
    FLAVORS.forEach((f, i) => {
      const g = new THREE.Group();
      g.position.set(PLATE.x + (i % 2 === 0 ? -0.047 : 0.047), CONTROLS.flavorY + (i < 2 ? 0.04 : -0.04), z);
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.25, emissive: new THREE.Color(f.glow) });
      mat.color.set(f.paint);
      this.jewelMats.push(mat);
      const jewel = new THREE.Mesh(jewelGeo, mat);
      jewel.position.z = 0.008;
      const ring = new THREE.Mesh(ringGeo, this.chrome);
      ring.position.z = 0.004;
      g.add(ring, jewel);
      g.userData.flavorIndex = i;
      this.flavorButtons.push(g);
      this.front.add(g);
    });

    // The big button.
    this.vendButton.position.set(PLATE.x, CONTROLS.vendY, z);
    const collar = new THREE.Mesh(zCylinder(0.066, 0.074, 0.022, 40), this.chrome);
    collar.position.z = 0.011;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.056, 32, 12, 0, Math.PI * 2, 0, HALF_PI).rotateX(HALF_PI).scale(1, 1, 0.5),
      this.vendMat,
    );
    this.vendCap.add(dome);
    this.vendButton.add(collar, this.vendCap);
    this.front.add(this.vendButton);

    // Token return.
    const cup = new THREE.Mesh(zCylinder(0.03, 0.03, 0.008, 24), this.dark);
    cup.position.set(PLATE.x, CONTROLS.returnY, z + 0.004);
    const cupRing = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.006, 10, 32), this.chrome);
    cupRing.position.set(PLATE.x, CONTROLS.returnY, z + 0.005);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.013, 16, 12), this.chrome);
    knob.position.set(PLATE.x, CONTROLS.returnY, z + 0.016);
    this.front.add(cup, cupRing, knob);
  }

  private buildTopper(): void {
    const top = new THREE.Group();
    top.position.set(0, CAB.legs + CAB.h, 0.14);
    this.body.add(top);

    const plinth = new THREE.Mesh(new RoundedBoxGeometry(ARCH.a * 2 + 0.06, 0.05, ARCH.depth + 0.08, 3, 0.012), this.chrome);
    plinth.position.y = 0;
    top.add(plinth);

    const housing = new THREE.Mesh(
      new THREE.ExtrudeGeometry(archShape(1, 0), {
        depth: ARCH.depth,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelOffset: -0.012,
        bevelSegments: 3,
        curveSegments: 40,
      }),
      this.chrome,
    );
    housing.position.set(0, 0.015, -ARCH.depth / 2);
    top.add(housing);

    const faceGeo = new THREE.ShapeGeometry(archShape(ARCH.faceScale, 0.04), 40);
    bboxUV(faceGeo);
    const face = new THREE.Mesh(faceGeo, this.archMat);
    face.position.set(0, 0.015, ARCH.depth / 2 + 0.0135);
    face.userData.noShadow = true;
    top.add(face);

    // Chaser bulbs around the arch.
    const n = 19;
    this.bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0155, 12, 8), new THREE.MeshBasicMaterial(), n);
    this.bulbs.userData.noShadow = true;
    const m = new THREE.Matrix4();
    const k = (1 + ARCH.faceScale) / 2;
    for (let i = 0; i < n; i++) {
      const th = -0.09 * Math.PI + (i / (n - 1)) * 1.18 * Math.PI;
      const bx = Math.cos(Math.max(0, Math.min(Math.PI, th))) * ARCH.a * k;
      const by = ARCH.base + Math.sin(th) * ARCH.b * (th < 0 || th > Math.PI ? 1.1 : k);
      m.makeTranslation(-bx, by + 0.015, ARCH.depth / 2 + 0.016);
      this.bulbs.setMatrixAt(i, m);
      this.bulbs.setColorAt(i, this.tmpColor.setRGB(0, 0, 0));
    }
    top.add(this.bulbs);

    // Atom finial.
    const apex = ARCH.base + ARCH.b + 0.015;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.1, 12), this.chrome);
    stem.position.y = apex + 0.045;
    const atom = new THREE.Group();
    atom.position.y = apex + 0.15;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 16), this.orbMat);
    orb.userData.noShadow = true;
    atom.add(orb);
    const orbitGeo = new THREE.TorusGeometry(0.125, 0.0045, 8, 64);
    const electronGeo = new THREE.SphereGeometry(0.013, 12, 8);
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i * Math.PI) / 3;
      const tilt = new THREE.Group();
      tilt.rotation.x = 1.2;
      const spinner = new THREE.Group();
      spinner.rotation.z = i * 2.1;
      const electron = new THREE.Mesh(electronGeo, this.electronMat);
      electron.position.x = 0.125;
      electron.userData.noShadow = true;
      spinner.add(electron);
      tilt.add(new THREE.Mesh(orbitGeo, this.chrome), spinner);
      pivot.add(tilt);
      atom.add(pivot);
      this.spinners.push(spinner);
    }
    top.add(stem, atom);

    this.signLight.position.set(0, 0.25, 0.5);
    top.add(this.signLight);
  }

  private buildTrim(): void {
    // Kick louvres.
    const slatGeo = new THREE.BoxGeometry(CAB.w - 0.16, 0.014, 0.012);
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(slatGeo, this.chrome);
      slat.position.set(0, 0.045 + i * 0.034, 0.004);
      slat.rotation.x = 0.55;
      this.front.add(slat);
    }
    // Speed lines and vents on both flanks.
    const lineGeo = new RoundedBoxGeometry(0.014, 0.02, 0.5, 2, 0.006);
    const ventGeo = new THREE.BoxGeometry(0.01, 0.014, 0.36);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const line = new THREE.Mesh(lineGeo, this.chrome);
        line.position.set(sx * (CAB.w / 2 + 0.003), CAB.legs + 1.2 + i * 0.055, 0.02 + i * 0.03);
        this.body.add(line);
      }
      for (let i = 0; i < 6; i++) {
        const vent = new THREE.Mesh(ventGeo, this.dark);
        vent.position.set(sx * (CAB.w / 2 + 0.002), CAB.legs + 0.2 + i * 0.04, -0.08);
        this.body.add(vent);
      }
    }
  }

  // --- livery --------------------------------------------------------------

  private livery(f: Flavor): Livery {
    let l = this.liveries.get(f.id);
    if (!l) {
      l = {
        panel: frontPanelTexture(f),
        lightbox: lightboxTexture(f),
        arch: archSignTexture(f),
        disc: glowDiscTexture(f),
        label: bottleLabelTexture(f),
      };
      this.liveries.set(f.id, l);
    }
    return l;
  }

  /** Paint every flavour's textures up front so switching never hitches. */
  warm(): void {
    for (const f of FLAVORS) this.livery(f);
  }

  setFlavor(f: Flavor): void {
    this.flavor = f;
    const l = this.livery(f);
    this.paintFront.map = l.panel;
    this.paintFront.needsUpdate = true;
    this.paintShell.color.set(f.paint);
    this.lightboxMat.map = l.lightbox;
    this.archMat.map = l.arch;
    this.discMat.map = l.disc;
    this.labelMat.map = l.label;
    for (const m of [this.lightboxMat, this.archMat, this.discMat, this.labelMat]) m.needsUpdate = true;
    this.glow.set(f.glow);
    this.liquidMat.color.set(f.liquid).multiplyScalar(0.8);
    this.liquidMat.emissive.set(f.liquid);
    this.vendMat.emissive.set(f.glow);
    for (const light of [this.signLight, this.portLight, this.bayLight]) light.color.copy(this.glow);
    this.chamberLight.color.copy(this.glow).lerp(this.tmpColor.set(0xffffff), 0.7);
  }

  // --- queries -------------------------------------------------------------

  /** World position of the token slot. */
  slotWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.front.localToWorld(out.set(PLATE.x, CONTROLS.slotY, 0.03));
  }

  /** World position where a vended bottle stands in the bay. */
  bayWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.front.localToWorld(out.set(BAY.x, BAY.y - BAY.h / 2 + 0.002, -0.15));
  }

  // --- per-frame -----------------------------------------------------------

  update(time: number, dt: number): void {
    const p = this.power;

    // Neon stutter: every few seconds the marquee blinks like a tired tube.
    if (time > this.stutterAt) {
      this.stutterUntil = time + 0.22;
      this.stutterAt = time + 3.5 + Math.random() * 7;
    }
    const stutter = time < this.stutterUntil ? (Math.sin(time * 90) > 0.2 ? 1 : 0.25) : 1;

    this.archMat.color.setScalar(p * stutter * 3.0);
    this.lightboxMat.color.setScalar(0.04 + p * 0.86);
    this.discMat.color.setScalar(0.03 + p * 0.62);
    this.neonMat.color.copy(this.glow).multiplyScalar(p * stutter * 4.5);
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 * this.tempo);
    this.orbMat.color.copy(this.glow).multiplyScalar(0.05 + p * (2.6 + pulse * 2.4));
    this.electronMat.color.setScalar(0.1 + p * 6);
    this.bayStripMat.color.copy(this.glow).multiplyScalar(p * this.bayGlow * 5);
    this.liquidMat.emissiveIntensity = 0.1 + p * 0.6;

    const busy = this.bulbMode !== 'idle';
    this.vendMat.emissiveIntensity = p * (busy ? 1.8 : 0.55 + 0.55 * (0.5 + 0.5 * Math.sin(time * 3.2)));
    this.jewelMats.forEach((m, i) => {
      m.emissiveIntensity = p * (i === this.flavor.index ? 1.0 : 0.04);
    });

    this.signLight.intensity = p * stutter * 1.5;
    this.portLight.intensity = p * 0.7;
    this.chamberLight.intensity = p * 0.55;
    this.bayLight.intensity = p * this.bayGlow * 0.9;

    // Chaser bulbs.
    const n = this.bulbs.count;
    const c = this.tmpColor;
    for (let i = 0; i < n; i++) {
      if (this.bulbMode === 'jackpot') {
        c.setHSL((i / n + time * 0.9) % 1, 1, 0.55).multiplyScalar(p * 6);
      } else {
        const step = Math.floor(time * (busy ? 16 : 5 * this.tempo));
        const on = busy ? (i + step) % 2 === 0 : (i + step) % 3 === 0;
        if (on) c.setRGB(1, 0.8, 0.45).multiplyScalar(p * 6.5);
        else c.setRGB(0.3, 0.2, 0.1).multiplyScalar(0.25 + p * 0.5);
      }
      this.bulbs.setColorAt(i, c);
    }
    this.bulbs.instanceColor!.needsUpdate = true;

    // Moving parts.
    this.carousel.rotation.y += dt * (0.45 * this.tempo + this.rumble * 9) * (0.15 + 0.85 * p);
    this.spinners.forEach((s, i) => {
      s.rotation.z += dt * (2.2 + i * 0.7) * this.tempo * (0.1 + 0.9 * p);
    });
    this.vendCap.position.z = 0.02 - this.press * 0.014;

    const r = this.rumble;
    this.body.position.set(Math.sin(time * 71) * 0.0035 * r, Math.abs(Math.sin(time * 47)) * 0.003 * r, 0);
    this.body.rotation.z = Math.sin(time * 53) * 0.005 * r;
  }
}
