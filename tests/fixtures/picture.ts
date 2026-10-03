// Micro-game fixture for the engine tests: one primitive, a couple of rooms. See tests/core.test.ts.
import type { GameDef, Layout } from '@engine/core/types';

export function picture(): GameDef {
  return {
    id: 'picture', title: 'Picture', saveVersion: 1, hero: 'hero',
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }],
    characters: { hero: { name: 'Hero', color: '#fff', fps: 10, sprites: { idle: ['h/1'], jump: ['h/2', 'h/3', 'h/4'] } } },
    items: {},
    rooms: [
      { id: 'street', name: 'Street', decor: 'd/street',
        props: { door: { name: 'door', states: { shut: 'p/shut', open: 'p/open' }, initial: 'shut',
          anims: { rattle: { frames: ['p/a', 'p/b', 'p/a'], fps: 10, at: { 1: [{ sfx: 'latch' }] } }, glow: { frames: ['p/g1', 'p/g2'], fps: 4, loop: true } } } },
        hotspots: { far: { name: 'far end' } },
        look: { door: 'A door.', far: 'Far.' },
        on: [
          { verb: 'use', a: 'door', do: [{ play: ['door', 'rattle'] }, 'Locked.'] },
          { verb: 'look', a: 'far', do: [{ camera: { to: 'far', ms: 300 } }, { camera: { pan: 100 } }, 'Far away.', { camera: 'follow' }] },
          { verb: 'use', a: 'far', do: [{ anim: ['hero', 'jump'], ms: 300, at: { 2: [{ set: 'jumped' }] } }, { play: ['door', 'glow'] }, { say: ['hero', 'Glowing.'], voice: 'v1' }, { stopAnim: 'door' }, { end: true }] },
        ],
        hints: [{ until: 'never', lines: ['Use the far end.'] }] },
    ],
    rules: { fallbacks: { look: ['Nothing.'], use: ['No.'], use2: ['No.'] } },
    audio: { sfx: { latch: 'latch.mp3' }, voices: { v1: 'hero-01.mp3' } },
    start: { room: 'street' },
    settings: true,
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
}
export const pictureLayouts: Record<string, Layout> = {
  street: { width: 1200, entries: { default: [100, 360] }, props: { door: { x: 300, y: 340, h: 80 } }, hotspots: { far: { rect: [1000, 200, 100, 100], approach: [1000, 360] } } },
};
