/**
 * The four tonics. Each one re-liveries the whole machine (enamel, signage,
 * glow colour, jingle) and grants one perk when drunk.
 */

export type EmblemKind = 'anvil' | 'chevrons' | 'owl' | 'star';
export type PerkId = 'grit' | 'hustle' | 'moonsight' | 'fortune';

/** [semitones above root, length in beats] */
export type Note = readonly [number, number];

export interface Flavor {
  readonly id: string;
  readonly index: number;
  /** Big word on the sign. */
  readonly name1: string;
  /** Small line under it. */
  readonly name2: string;
  readonly tagline: string;
  readonly perk: PerkId;
  readonly perkName: string;
  readonly perkBlurb: string;
  readonly paint: string;
  readonly paintDark: string;
  readonly glow: string;
  readonly liquid: string;
  readonly emblem: EmblemKind;
  readonly rootHz: number;
  readonly bpm: number;
  readonly timbre: 'organ' | 'bell';
  readonly jingle: readonly Note[];
}

export const CREAM = '#efe2c2';
export const INK = '#1b1410';

export const FLAVORS: readonly Flavor[] = [
  {
    id: 'ironroot',
    index: 0,
    name1: 'IRONROOT',
    name2: 'GINGER TONIC',
    tagline: 'Puts iron in your backbone',
    perk: 'grit',
    perkName: 'Grit',
    perkBlurb: 'Steel-rimmed vision. You feel riveted together.',
    paint: '#b8461c',
    paintDark: '#5a210d',
    glow: '#ff9a3c',
    liquid: '#ff7a14',
    emblem: 'anvil',
    rootHz: 261.63,
    bpm: 132,
    timbre: 'organ',
    jingle: [[0, 1], [0, 0.5], [4, 0.5], [7, 1], [4, 1], [7, 0.5], [9, 0.5], [12, 2]],
  },
  {
    id: 'quickstep',
    index: 1,
    name1: 'QUICKSTEP',
    name2: 'LIME TONIC',
    tagline: 'Twice the hustle in every bottle',
    perk: 'hustle',
    perkName: 'Hustle',
    perkBlurb: 'The machine works double-time for you.',
    paint: '#1c8450',
    paintDark: '#0c4428',
    glow: '#8dff6a',
    liquid: '#5dff2a',
    emblem: 'chevrons',
    rootHz: 440,
    bpm: 208,
    timbre: 'organ',
    jingle: [[0, 0.5], [4, 0.5], [7, 0.5], [12, 0.5], [7, 0.5], [4, 0.5], [7, 0.5], [12, 0.5], [16, 2]],
  },
  {
    id: 'nightowl',
    index: 2,
    name1: 'NIGHT OWL',
    name2: 'GRAPE TONIC',
    tagline: 'See what the dark is hiding',
    perk: 'moonsight',
    perkName: 'Moonsight',
    perkBlurb: 'The gloom lifts and the room brightens.',
    paint: '#4a2e94',
    paintDark: '#24154e',
    glow: '#b592ff',
    liquid: '#8a4dff',
    emblem: 'owl',
    rootHz: 293.66,
    bpm: 112,
    timbre: 'organ',
    jingle: [[7, 0.75], [3, 1.25], [7, 0.75], [3, 0.75], [0, 0.5], [2, 0.5], [3, 0.5], [7, 2]],
  },
  {
    id: 'luckystar',
    index: 3,
    name1: 'LUCKY STAR',
    name2: 'BLUEBERRY TONIC',
    tagline: 'Fortune favours the fizzy',
    perk: 'fortune',
    perkName: 'Fortune',
    perkBlurb: 'The dust in the air turns to stardust.',
    paint: '#1b5da6',
    paintDark: '#0c2f5c',
    glow: '#6fd2ff',
    liquid: '#1e9bff',
    emblem: 'star',
    rootHz: 392,
    bpm: 156,
    timbre: 'bell',
    jingle: [[12, 0.5], [9, 0.5], [7, 0.5], [4, 0.5], [7, 0.5], [9, 0.5], [12, 1], [16, 0.5], [19, 2]],
  },
];
