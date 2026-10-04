// What a player downloads (src/engine/tools/weight.ts, npm run weight): the images the engine preloads for a room,
// its music and sound effects; the title, the column's icons and the first room before play; budgets in KB.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { GameDef, RoomDef } from '@engine/core/types';
import { initialAssets, roomAssets, weigh, weightReport } from '@engine/tools/weight';

const room = (id: string, extra: Partial<RoomDef> = {}): RoomDef => ({ id, name: id, decor: `decor/${id}`, ...extra } as RoomDef);
const game = {
  hero: 'ann', start: { room: 'hall', inventory: ['key'] }, players: { ids: ['ann', 'bob'] },
  characters: { ann: { name: 'Ann', sprites: { idle: ['ann/idle'] }, mouths: { idle: { closed: 'ann/m0', open: ['ann/m1'] } } }, bob: { name: 'Bob', sprites: { idle: ['bob/idle'] } }, cat: { name: 'Cat', sprites: { idle: ['cat/idle'] }, variants: [{ if: 'x', sprites: { idle: ['cat/wet'] } }] } },
  items: { key: { name: 'key', icon: 'items/key' } },
  audio: { music: { calm: 'calm.mp3' }, sfx: { ding: 'ding.mp3' } },
  titleScreen: { decor: 'decor/title', logo: 'ui/logo', music: 'calm' },
  skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
  rooms: [
    room('hall', { music: 'calm', props: { lamp: { img: 'props/lamp', states: { on: 'props/lamp_on' } } } as never, actors: { cat: { char: 'cat' } } as never, on: [{ verb: 'use', a: 'lamp', do: [{ sfx: 'ding' }] }] as never }),
    room('attic'),
  ],
} as unknown as GameDef;

describe('weight', () => {
  it('a room needs its backdrop, props in every state, every character who can stand there, its music and sounds', () => {
    expect(roomAssets(game, game.rooms[0])).toEqual(['img:ann/idle', 'img:ann/m0', 'img:ann/m1', 'img:bob/idle', 'img:cat/idle', 'img:cat/wet', 'img:decor/hall', 'img:props/lamp', 'img:props/lamp_on', 'music:calm.mp3', 'sfx:ding.mp3']);
    expect(roomAssets(game, game.rooms[1])).toEqual(['img:ann/idle', 'img:ann/m0', 'img:ann/m1', 'img:bob/idle', 'img:decor/attic']);
  });
  it('before play: the first room, the title, the column icons, the bag at the start', () => {
    const i = initialAssets(game);
    for (const k of ['img:decor/title', 'img:ui/logo', 'img:ui/map', 'img:ui/pause', 'img:ui/music', 'img:items/key', 'img:decor/hall', 'music:calm.mp3']) expect(i).toContain(k);
    expect(i).not.toContain('img:decor/attic');
  });
  it('weighs, reports missing files and every budget exceeded', () => {
    const sizes: Record<string, number | null> = Object.fromEntries([...new Set([...initialAssets(game), ...game.rooms.flatMap((r) => roomAssets(game, r))])].map((k) => [k, 100 * 1024]));
    sizes['img:decor/attic'] = null;
    expect(weigh(['img:decor/hall', 'img:decor/attic'], sizes)).toEqual({ bytes: 100 * 1024, files: 1, missing: ['img:decor/attic'] });
    const r = weightReport(game, sizes, [{ id: 'one', rooms: ['hall', 'attic'] }], { initialKB: 1000, roomKB: 1000, chapterKB: 1000 });
    expect(r.rooms[0]).toMatchObject({ id: 'hall', bytes: 11 * 100 * 1024 });
    expect(r.over).toEqual(['initial download 1700 KB > initialKB 1000', 'room hall 1100 KB > roomKB 1000', 'chapter one 1100 KB > chapterKB 1000']);
  });
  it('the demo stays within its budgets, chapter by chapter', () => {
    const r = spawnSync('npx', ['tsx', 'tools/weight.ts', '--release', '--json'], { encoding: 'utf8', env: { ...process.env, GAME: 'demo' } });
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.over).toEqual([]);
    expect(j.missing).toEqual([]);
    expect(j.chapters.map((c: { id: string }) => c.id)).toContain('ending');
    expect(j.initial.bytes).toBeGreaterThan(0);
  }, 120000);
});
