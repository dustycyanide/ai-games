/**
 * Soda bottle: lathed glass, a glowing liquid core that can drain, a wrap
 * label and a crown cap. Geometry is shared between every bottle in the scene.
 */

import * as THREE from 'three';

export const BOTTLE_HEIGHT = 0.236;
const LIQUID_BASE = 0.005;
const LIQUID_TOP = 0.186;

/** Outer radius of the bottle at height y. */
function radiusAt(y: number): number {
  if (y < 0.006) return 0.03 + 0.005 * (y / 0.006);
  if (y < 0.105) return 0.035;
  if (y < 0.19) {
    const t = (y - 0.105) / 0.085;
    const s = t * t * (3 - 2 * t);
    return 0.035 + (0.014 - 0.035) * s;
  }
  if (y < 0.22) return 0.014 - 0.0012 * ((y - 0.19) / 0.03);
  return 0.0152;
}

function glassGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const ys = [0, 0.003, 0.006];
  for (let y = 0.02; y <= 0.2201; y += 0.0085) ys.push(y);
  ys.push(0.2205, 0.228, 0.234);
  for (const y of ys) pts.push(new THREE.Vector2(radiusAt(y), y));
  pts.push(new THREE.Vector2(0.0125, BOTTLE_HEIGHT));
  return new THREE.LatheGeometry(pts, 28);
}

/** Liquid core; its origin is its own base so scale.y drains it downward. */
function liquidGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  for (let y = LIQUID_BASE; y <= LIQUID_TOP + 1e-6; y += (LIQUID_TOP - LIQUID_BASE) / 20) {
    pts.push(new THREE.Vector2(radiusAt(y) * 0.86, y - LIQUID_BASE));
  }
  pts.push(new THREE.Vector2(0, LIQUID_TOP - LIQUID_BASE));
  return new THREE.LatheGeometry(pts, 24);
}

export interface BottleMaterials {
  glass: THREE.Material;
  liquid: THREE.Material;
  label: THREE.Material;
  cap: THREE.Material;
}

export interface Bottle {
  group: THREE.Group;
  liquid: THREE.Mesh;
  cap: THREE.Mesh;
  /** Cap's resting height, for the pop animation. */
  capY: number;
}

export class BottleKit {
  private readonly glassGeo = glassGeometry();
  private readonly liquidGeo = liquidGeometry();
  private readonly labelGeo = new THREE.CylinderGeometry(0.0356, 0.0356, 0.06, 28, 1, true, -2.2, 4.4);
  private readonly capGeo = new THREE.CylinderGeometry(0.0158, 0.018, 0.012, 21);

  /** A full, capped, labelled bottle. */
  full(m: BottleMaterials): Bottle {
    const group = new THREE.Group();
    const liquid = new THREE.Mesh(this.liquidGeo, m.liquid);
    liquid.position.y = LIQUID_BASE;
    const glass = new THREE.Mesh(this.glassGeo, m.glass);
    glass.renderOrder = 2;
    const label = new THREE.Mesh(this.labelGeo, m.label);
    label.position.y = 0.062;
    const capY = BOTTLE_HEIGHT + 0.001;
    const cap = new THREE.Mesh(this.capGeo, m.cap);
    cap.position.y = capY;
    cap.castShadow = true;
    group.add(liquid, label, glass, cap);
    return { group, liquid, cap, capY };
  }

  /** An empty with no cap, label or liquid. */
  empty(glass: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(this.glassGeo, glass);
    mesh.castShadow = true;
    return mesh;
  }
}
