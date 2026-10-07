// A small game with a complete speedrun manifest written as content only (4.1.14 "Time Attack"): two rooms, a key, a
// random line, a hint item, a cutscene, an ending, and three categories (Any%, No Hints, Fixed Seed) with their splits.
// No file of src/ knows it: tests/speedrun-manifest.test.ts checks that a category defined here validates, runs, is
// timed and splits; tests/speedrun-verify.test.ts alters its runs.
import type { GameDef, Layout, SpeedrunCategory } from '@engine/core/types';

const base: Omit<SpeedrunCategory, 'id' | 'name'> = {
  timing: 'igt',
  start: { event: 'sessionStarted', session: 'new' },
  finish: { event: 'endingReached' },
  allowSaves: true,
  allowPauses: true,
  allowHints: true,
  reload: 'allowed',
  realityPolicy: 'forbidden',
  fingerprint: ['logic', 'trustedExtensions'],
  inputs: { mouse: true, touch: true, keyboard: true, gamepad: true, macros: 'forbidden' },
};

export function speedrunGame(): GameDef {
  return {
    id: 'vault',
    title: 'The Vault',
    saveVersion: 1,
    hero: 'hero',
    hintItem: 'phone',
    verbs: [
      { id: 'look', label: 'Look', color: '#fff' },
      { id: 'take', label: 'Take', color: '#fff' },
      { id: 'use', label: 'Use', color: '#fff', join: 'with' },
    ],
    characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['h/1'] } } },
    items: { key: { name: 'key', icon: 'i/key' }, phone: { name: 'phone', icon: 'i/phone' } },
    rooms: [
      {
        id: 'hall',
        name: 'Hall',
        decor: 'd/hall',
        props: {
          desk: { img: 'o/desk', name: 'desk' },
          door: { img: 'o/door', name: 'door' },
        },
        hints: [{ until: { has: 'key' }, lines: ['The desk, maybe?'] }],
        on: [
          { verb: 'look', a: 'desk', do: [{ random: [['Dusty.'], ['Very dusty.'], ['Dust, mostly.']] }] },
          { verb: 'take', a: 'desk', if: { not: { has: 'key' } }, do: [{ gain: 'key' }, { set: 'found' }, 'Got it.'] },
          {
            verb: 'use',
            a: 'key',
            b: 'door',
            do: [{ cutscene: [{ wait: 1500 }, 'Click.'] }, { goto: 'vault' }],
          },
        ],
      },
      {
        id: 'vault',
        name: 'Vault',
        decor: 'd/vault',
        props: { gem: { img: 'o/gem', name: 'gem' } },
        on: [{ verb: 'take', a: 'gem', do: ['Mine.', { end: true }] }],
      },
    ],
    rules: { fallbacks: { look: ['Nothing.'], take: ['No.'], use: ['No.'], use2: ['No.'], talk: ['Hm.'] } },
    start: { room: 'hall', inventory: ['phone'] },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
    speedrun: {
      rulesVersion: 1,
      categories: [
        { ...base, id: 'any%', name: 'Any%' },
        { ...base, id: 'no-hints', name: 'No Hints', allowHints: false, reload: 'invalidates', allowSaves: false },
        { ...base, id: 'fixed-seed', name: 'Fixed Seed', seed: 'fixed', timing: 'active-igt' },
        { ...base, id: 'rta', name: 'Real Time', timing: 'rta' },
      ],
      splits: [
        { id: 'key', name: 'Key', at: { event: 'itemAcquired', item: 'key' } },
        { id: 'found', name: 'Found it', at: { event: 'flagChanged', flag: 'found', value: true }, parent: 'key' },
        { id: 'vault', name: 'Vault', at: { event: 'roomEntered', room: 'vault' } },
        { id: 'end', name: 'Gem', at: { event: 'endingReached' } },
      ],
    },
  };
}

export const speedrunLayouts: Record<string, Layout> = {
  hall: {
    entries: { default: [100, 360] },
    props: { desk: { x: 300, y: 340, h: 40 }, door: { x: 560, y: 330, h: 120 } },
  },
  vault: { entries: { default: [320, 360] }, props: { gem: { x: 420, y: 330, h: 20 } } },
};

/** The route of an Any% run: look (a random line), take the key, use it on the door, take the gem. */
export const ROUTE = [
  { verb: 'look', a: 'desk' },
  { verb: 'take', a: 'desk' },
  { verb: 'use', a: 'key', b: 'door' },
  { verb: 'take', a: 'gem' },
] as const;
