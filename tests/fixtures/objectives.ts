// A small game with objectives (4.1.12, ADR 0014): a chest to open with a key found under a rug, a gate behind it, a
// side objective (the bell). The propagation test (tests/propagation.test.ts) and tests/objectives.test.ts play it.
import type { GameDef, Layout } from '@engine/core/types';

export function quest(): GameDef {
  return {
    id: 'quest',
    title: 'Quest',
    schemaVersion: 3,
    saveVersion: 1,
    hero: 'hero',
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
      { id: 'take', label: 'Take', color: '#fff' },
    ],
    characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } } },
    items: { key: { name: 'key', icon: 'i/key', look: 'A key.' } },
    rooms: [
      {
        id: 'hall',
        name: 'Hall',
        decor: 'd/hall',
        props: {
          rug: { img: 'o/rug', name: 'rug' },
          chest: { name: 'chest', states: { shut: 'o/chest', open: 'o/chest-open' } },
          bell: { img: 'o/bell', name: 'bell' },
          gate: { img: 'o/gate', name: 'gate' },
        },
        look: { rug: 'A rug.', chest: 'A chest.', bell: 'A bell.', gate: 'A gate.' },
        on: [
          {
            id: 'hall.take-rug',
            verb: 'take',
            a: 'rug',
            if: '!key_found',
            do: [{ gain: 'key' }, { set: 'key_found' }],
          },
          {
            id: 'hall.use-key-chest',
            verb: 'use',
            a: 'key',
            b: 'chest',
            do: [{ prop: ['chest', 'open'] }, { set: 'chest_open' }],
          },
          { id: 'hall.use-bell', verb: 'use', a: 'bell', do: [{ set: 'rang' }, 'Ding.'] },
          { id: 'hall.use-gate', verb: 'use', a: 'gate', if: 'chest_open', do: [{ set: 'out' }, { end: true }] },
        ],
      },
    ],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], take: ['No.'], use2: ['No.'] } },
    start: { room: 'hall' },
    objectives: {
      escape: { title: 'Get out of the hall', done: 'out' },
      chest: { title: 'Open the chest', done: 'chest_open', parent: 'escape' },
      key: { title: 'Find the key', done: 'key_found', parent: 'chest' },
      bell: { title: 'Ring the bell', done: 'rang', optional: true },
    },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}

export const questLayouts: Record<string, Layout> = {
  hall: {
    entries: { default: [320, 360] },
    props: {
      rug: { x: 100, y: 340, h: 40 },
      chest: { x: 300, y: 340, h: 40 },
      bell: { x: 400, y: 200, h: 40 },
      gate: { x: 560, y: 300, h: 120 },
    },
  },
};
