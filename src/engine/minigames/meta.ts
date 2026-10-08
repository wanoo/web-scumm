// What the tools and the validator read of each built-in minigame (3.9): its params, texts and bindings, with none of
// its code, so the player loads a minigame only when one starts (minigames/index.ts).
import type { Minigame } from './types';

export const MINIGAME_META = {
  pipes: {
    required: ['tiles', 'source', 'nozzle', 'tank'],
    textParams: ['intro', 'win'],
  },
  stroke: {
    bindings: { sfx: ['sfx'] },
    required: ['target', 'hand'],
    textParams: ['intro', 'win', 'tooFast'],
  },
  pick: {
    required: ['rounds'],
    textParams: ['rounds.*.prompt', 'decoyLine', 'wrongLine', 'win'],
  },
  hide: {
    required: ['spots'],
    textParams: ['intro', 'win', 'spots.*.reply'],
  },
  runner: {
    required: ['hero', 'chaser', 'obstacles', 'bg'],
    textParams: ['intro', 'win', 'stumble'],
  },
  scratch: {
    required: ['ticket'],
    // `text` is the decrypted sealed ending, given at run time, never content to translate.
    textParams: ['intro'],
    bindings: { images: ['ticket'], sfx: ['sfx'] },
  },
  cables: {
    bindings: { sfx: ['sfx.ring', 'sfx.stamp'] },
    required: ['board', 'knot', 'plugs'],
    textParams: ['intro', 'win', 'windowsText'],
  },
  // 4.1.15: the diegetic code wheel (core/remix/code-wheel.ts), seeded by the world's `copy-protection` stream.
  'code-wheel': {
    required: ['actors', 'symbols', 'answers'],
    textParams: [
      'question',
      'wrong.*',
      'pass',
      'win',
      'fail',
      'list',
      'turnLeft',
      'turnRight',
      'actors.*.label',
      'symbols.*.label',
      'answers.*',
    ],
  },
} satisfies Record<string, Omit<Minigame, 'run'>>;
