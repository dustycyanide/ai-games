import { describe, it } from 'vitest';
import { box, lathe, sphere, opSmin, opTranslate, surfaceNets } from '../src/index';
import { expectIdentical } from './helpers';

describe('determinism: same inputs -> byte-identical bundles', () => {
  it('box', () => {
    expectIdentical(box(1.2, 0.7, 2.1, { bevel: 0.1 }), box(1.2, 0.7, 2.1, { bevel: 0.1 }), 'box');
  });

  it('lathe', () => {
    const profile: [number, number][] = [
      [0.1, -1],
      [0.55, -0.2],
      [0.4, 0.5],
      [0.05, 1.1],
    ];
    expectIdentical(lathe(profile, 24), lathe(profile, 24), 'lathe');
  });

  it('surfaceNets of smin-blended spheres', () => {
    const make = () => {
      const s = opSmin(sphere(0.8), opTranslate(sphere(0.6), [0.7, 0.4, 0]), 0.3);
      return surfaceNets(s, { min: [-2, -2, -2], max: [2, 2, 2] }, 32);
    };
    expectIdentical(make(), make(), 'surfaceNets');
  });
});
