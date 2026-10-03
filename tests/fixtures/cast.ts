// Micro-game fixture for the engine tests: one primitive, a couple of rooms. See tests/core.test.ts.
import type { GameDef, Layout } from '@engine/core/types';

export function cast(): GameDef {
  return {
    id: 'cast', title: 'Cast', saveVersion: 1, hero: 'ann',
    players: { ids: ['ann', 'bob'], start: { bob: { room: 'cellar', inventory: ['rope'] } }, give: 'Take this, {nom}: the {objet}.' },
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'give', label: 'Give', color: '#fff', join: 'to' }, { id: 'take', label: 'Take', color: '#fff' }],
    characters: {
      ann: { name: 'Ann', color: '#fff', sprites: { idle: ['a/1'] } },
      bob: { name: 'Bob', color: '#0ff', sprites: { idle: ['b/1'] } },
    },
    items: { rope: { name: 'rope', icon: 'i/rope', look: 'A rope.' }, key: { name: 'key', icon: 'i/key', look: 'A key.' } },
    rooms: [
      { id: 'hall', name: 'Hall', decor: 'd/hall', hotspots: { hook: { name: 'hook' }, hatch: { name: 'hatch' } }, look: { hook: 'A hook.', hatch: 'A hatch.' },
        on: [
          { verb: 'use', a: 'rope', b: 'hook', do: [{ lose: 'rope' }, { set: 'rope_tied' }] },
          { verb: 'use', a: 'hatch', if: 'rope_tied', do: [{ goto: 'cellar' }] },
        ], hints: [{ until: 'rope_tied', lines: ['Bob has the rope.'] }] },
      { id: 'cellar', name: 'Cellar', decor: 'd/cellar', hotspots: { chest: { name: 'chest' }, ladder: { name: 'ladder' } }, look: { chest: 'A chest.', ladder: 'A ladder.' },
        on: [
          { verb: 'take', a: 'chest', if: { player: 'bob' }, do: [{ gain: 'key' }, 'Bob opens it.'] },
          { verb: 'take', a: 'chest', do: ['Too heavy for Ann.'] },
          { verb: 'use', a: 'ladder', do: [{ goto: 'hall' }] },
          { verb: 'use', a: 'key', b: 'chest', if: { player: 'ann' }, do: ['Ann wins.', { end: true }] },
        ], hints: [{ until: 'never', lines: ['The chest.'] }] },
    ],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], give: ['No.'], take: ['No.'], use2: ['No.'] } },
    start: { room: 'hall' },
    checkpoints: { bobhome: { room: 'cellar', active: 'bob', inventory: ['rope'], players: { ann: { room: 'hall' } } } },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}
export const castLayouts: Record<string, Layout> = {
  hall: { entries: { default: [320, 360] }, hotspots: { hook: { rect: [10, 10, 50, 50] }, hatch: { rect: [100, 10, 50, 50] } } },
  cellar: { entries: { default: [200, 360] }, hotspots: { chest: { rect: [10, 10, 50, 50] }, ladder: { rect: [100, 10, 50, 50] } } },
};
