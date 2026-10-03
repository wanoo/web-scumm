// Micro-game fixture for the engine tests: one primitive, a couple of rooms. See tests/core.test.ts.
import type { GameDef, Layout } from '@engine/core/types';

export function mini(): GameDef {
  return {
    id: 'mini', title: 'Mini', saveVersion: 1, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'give', label: 'Give', color: '#fff', join: 'to' }],
    characters: {
      hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } },
      voice: { name: 'Voice', color: '#f0f', offscreen: true },
      ann: { name: 'Ann', color: '#0ff', height: 108, sprites: { idle: ['m/1'], phone: ['m/2'] }, mouths: { phone: { closed: 'tm/1', open: ['tm/2', 'tm/3'] } } },
      bea: { name: 'Bea', color: '#ff0', height: 84, sprites: { idle: ['p/1'], phone: ['p/2'] } },
      uncle: { name: 'Uncle', color: '#0f0', sprites: { idle: ['pa/1'], front: ['pa/2'], attack: ['pa/3'] } },
    },
    items: { cle: { name: 'key', icon: 'i/cle' }, badge: { name: 'badge', icon: 'i/badge' } },
    rooms: [
      { id: 'a', name: 'A', decor: 'd/a',
        props: { valise: { img: 'o/valise', name: 'suitcase' } },
        actors: { uncle: { char: 'uncle', pose: 'front' } },
        on: [{ verb: 'use', a: 'cle', b: 'valise', do: [{ used: 'cle' }, 'Opened.'] }] },
      { id: 'b', name: 'B', decor: 'd/b',
        props: { cadenas: { img: 'o/cadenas', name: 'padlock' } },
        on: [{ verb: 'use', a: ['cle', 'badge'], b: 'cadenas', do: ['No, not that.'] }] },
    ],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], use2: ['These do not go together.'] } },
    start: { room: 'a', inventory: ['cle', 'badge'] },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}

export const miniLayouts: Record<string, Layout> = {
  a: { entries: { default: [320, 360] }, props: { valise: { x: 300, y: 340, h: 40, rot: 13, flipV: true, states: {} } }, actors: { uncle: { x: 200, y: 300, h: 110, z: 500 } } },
  b: { entries: { default: [320, 360] }, props: { cadenas: { x: 300, y: 340, h: 40 } } },
};
