// Micro-game fixture for the engine tests: one primitive, a couple of rooms. See tests/core.test.ts.
import type { GameDef, Layout } from '@engine/core/types';

export function scale(): GameDef {
  return {
    id: 'scale', title: 'Scale', saveVersion: 3, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'open', label: 'Open', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'take', label: 'Take', color: '#fff' }],
    characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } } },
    items: { key: { name: 'key', icon: 'i/key', look: 'A key.' }, gem: { name: 'gem', icon: 'i/gem', look: 'A gem.' } },
    rooms: [
      { id: 'hall', name: 'Hall', decor: 'd/hall',
        hotspots: { mat: { name: 'mat' } },
        exits: { door: { name: 'door', to: 'yard', entry: 'from_hall', if: { has: 'key' }, locked: 'Locked.', sfx: 'creak' } },
        look: { mat: 'A mat.', door: 'A door.' },
        on: [{ verb: 'take', a: 'mat', if: '!key_found', do: [{ gain: 'key' }, { set: 'key_found' }] }],
        hints: [{ until: { has: 'key' }, lines: ['Under the mat.'] }] },
      { id: 'yard', name: 'Yard', decor: 'd/yard',
        hotspots: { well: { name: 'well' } },
        exits: { back: { name: 'back door', to: 'hall', oneWay: true } },
        look: { well: 'A well.', back: 'The door.' },
        on: [{ verb: 'use', a: 'well', do: [{ gain: 'gem' }, { goto: 'attic' }] }],
        hints: [{ until: 'never', lines: ['Use the well.'] }] },
      { id: 'attic', name: 'Attic', decor: 'd/attic', hotspots: { chest: { name: 'chest' } }, look: { chest: 'A chest.' },
        on: [{ verb: 'use', a: 'gem', b: 'chest', do: ['Done.', { end: true }] }], hints: [{ until: 'never', lines: ['The chest.'] }] },
      { id: 'cellar', name: 'Cellar', decor: 'd/cellar', hotspots: { barrel: { name: 'barrel' } }, look: { barrel: 'A barrel.' } },
    ],
    rules: { fallbacks: { look: ['Nothing.'], open: ['No.'], use: ['No.'], take: ['No.'], use2: ['No.'] } },
    audio: { sfx: { creak: 'creak.mp3' } },
    start: { room: 'hall' },
    checkpoints: {
      yard: { room: 'yard', inventory: ['key'], flags: { key_found: true }, goals: [{ has: 'key' }, { room: 'yard' }] },
    },
    invariants: [{ all: [{ has: 'gem' }, { not: { has: 'key' } }] }],
    migrations: [
      { from: 1, renameFlag: { found: 'key_found' }, renameItem: { cle: 'key' } },
      { from: 2, renameRoom: { lobby: 'hall' }, dropFlag: ['tmp'] },
    ],
    saves: { slots: 2 },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}
export const scaleLayouts: Record<string, Layout> = {
  hall: { entries: { default: [320, 360] }, hotspots: { mat: { rect: [10, 10, 50, 50] }, door: { rect: [100, 10, 50, 50] } } },
  yard: { entries: { default: [320, 360], from_hall: [40, 360] }, hotspots: { well: { rect: [10, 10, 50, 50] }, back: { rect: [100, 10, 50, 50] } } },
  attic: { entries: { default: [320, 360] }, hotspots: { chest: { rect: [10, 10, 50, 50] } } },
  cellar: { entries: { default: [320, 360] }, hotspots: { barrel: { rect: [10, 10, 50, 50] } } },
};
