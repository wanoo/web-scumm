// A game that listens to the world outside (4.1.1, Reality Bridge): a vault opened by an emailed answer (required,
// with a radio as its fallback), and a bell that rings each time a webhook says so (repeatable).
import type { GameDef, Layout } from '@engine/core/types';

export function signals(): GameDef {
  return {
    id: 'signals',
    title: 'Signals',
    saveVersion: 1,
    hero: 'hero',
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
    ],
    characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } } },
    items: {},
    reality: {
      signals: [
        {
          id: 'mail.answer.correct',
          source: 'mail',
          availability: 'required',
          replay: 'record',
          fallback: { verb: 'use', a: 'radio' },
        },
        { id: 'mail.answer.wrong', source: 'mail', availability: 'optional', replay: 'record' },
        { id: 'hook.bell', source: 'webhook', availability: 'optional', replay: 'record', once: false },
      ],
    },
    events: [
      { id: 'mail-opens-vault', on: 'mail.answer.correct', do: [{ set: 'vault_open' }, 'The vault clicks open.'] },
      {
        id: 'bell-rings',
        on: 'hook.bell',
        do: [{ nth: [[{ set: 'rang_1' }], [{ set: 'rang_2' }], [{ set: 'rang_3' }]], key: 'bell' }],
      },
    ],
    rooms: [
      {
        id: 'hall',
        name: 'Hall',
        decor: 'd/hall',
        hotspots: { vault: { name: 'vault' }, radio: { name: 'radio' } },
        look: { vault: 'A vault.', radio: 'An old radio.' },
        on: [
          { verb: 'use', a: 'radio', if: '!vault_open', do: [{ set: 'vault_open' }, 'Static, then a click.'] },
          { verb: 'use', a: 'vault', if: 'vault_open', do: [{ end: true }] },
        ],
      },
    ],
    rules: { fallbacks: { use: ['No.'], look: ['Nothing.'] } },
    start: { room: 'hall' },
    skin: { icons: { map: 'map', pause: 'pause', music: 'music' } },
    ui: {} as GameDef['ui'],
  };
}
export const signalsLayouts: Record<string, Layout> = {
  hall: {
    entries: { default: [320, 360] },
    hotspots: { vault: { rect: [100, 100, 80, 80] }, radio: { rect: [400, 100, 60, 60] } },
  },
};
