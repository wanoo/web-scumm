// Micro-game fixture for the engine tests: one primitive, a couple of rooms. See tests/core.test.ts.
import type { GameDef, Layout } from '@engine/core/types';

export function world(): GameDef {
  return {
    id: 'world',
    title: 'World',
    saveVersion: 1,
    hero: 'hero',
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
      { id: 'talk', label: 'Talk', color: '#fff' },
    ],
    characters: {
      hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } },
      cook: { name: 'Cook', color: '#0f0', room: 'kitchen', sprites: { idle: ['c/1'] } },
    },
    items: {},
    rooms: [
      {
        id: 'hall',
        name: 'Hall',
        decor: 'd/hall',
        actors: { cook: { char: 'cook' } },
        hotspots: { door: { name: 'door' }, gong: { name: 'gong' } },
        look: { door: 'A door.', gong: 'A gong.', cook: 'The cook.' },
        on: [
          { verb: 'use', a: 'door', do: [{ goto: 'kitchen' }] },
          { verb: 'use', a: 'gong', do: [{ emit: 'gong' }] },
          {
            verb: 'talk',
            a: 'cook',
            if: { actorIn: ['cook', 'hall'] },
            do: [{ say: ['cook', 'Dinner!'] }, { set: 'dinner' }, { end: true }],
          },
        ],
        events: [{ on: 'gong', once: true, do: [{ set: 'rang' }] }],
        scripts: [{ id: 'hall_clock', loop: true, do: [{ wait: 1000 }, { inc: 'ticks' }] }],
      },
      {
        id: 'kitchen',
        name: 'Kitchen',
        decor: 'd/kitchen',
        actors: { cook: { char: 'cook' } },
        hotspots: { door: { name: 'door' } },
        look: { door: 'A door.', cook: 'The cook, cooking.' },
        on: [{ verb: 'use', a: 'door', do: [{ goto: 'hall' }] }],
      },
    ],
    scripts: [
      { id: 'cook_comes', do: [{ waitEvent: 'gong' }, { moveActor: ['cook', 'hall'] }, { toast: 'The cook comes.' }] },
    ],
    events: [{ on: 'gong', do: [{ inc: 'gongs' }] }],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], talk: ['...'], use2: ['No.'] } },
    start: { room: 'hall' },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}

export const worldLayouts: Record<string, Layout> = {
  hall: {
    entries: { default: [320, 360] },
    actors: { cook: { x: 200, y: 300, h: 100 } },
    hotspots: { door: { rect: [0, 0, 50, 50] }, gong: { rect: [100, 0, 50, 50] } },
  },
  kitchen: {
    entries: { default: [320, 360] },
    actors: { cook: { x: 400, y: 320, h: 100 } },
    hotspots: { door: { rect: [0, 0, 50, 50] } },
  },
};
