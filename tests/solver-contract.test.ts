import { describe, expect, it } from 'vitest';
import type { GameDef, Layout } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { pickups, pickupsLayouts } from './fixtures/por';

const layouts: Record<string, Layout> = { room: { entries: { default: [320, 360] } } };
const base = (): GameDef => ({
  id: 'solver-contract', title: 'Solver contract', saveVersion: 1, hero: 'hero',
  verbs: [{ id: 'use', label: 'Use', color: '#fff' }],
  characters: { hero: { name: 'Hero', color: '#fff', sprites: { idle: ['hero'] } } },
  items: {},
  rooms: [{
    id: 'room', name: 'Room', decor: 'room',
    hotspots: { exit: { name: 'exit' }, danger: { name: 'danger' } },
    look: { exit: 'The exit.', danger: 'Trouble.' },
    on: [
      { verb: 'use', a: 'exit', if: '!doomed', do: [{ end: true }] },
      { verb: 'use', a: 'danger', do: [{ set: 'doomed' }] },
    ],
  }],
  rules: { fallbacks: { use: ['No.'] } },
  start: { room: 'room' }, skin: { icons: { map: 'map', pause: 'pause', music: 'music' } }, ui: {} as GameDef['ui'],
});

describe('solver result contract', () => {
  it('reports an explicit truncation instead of a successful partial search', async () => {
    const result = await solve(pickups(5), pickupsLayouts, { mode: 'prove', maxStates: 1 });
    expect(result.status).toBe('truncated');
    expect(result.truncated).toBe(true);
  });

  it('distinguishes a witness from a proof containing a reachable softlock', async () => {
    expect((await solve(base(), layouts, { mode: 'witness' })).status).toBe('solved');
    const proof = await solve(base(), layouts, { mode: 'prove' });
    expect(proof.status).toBe('softlocks');
    expect(proof.finished).toBe(true);
    expect(proof.softlocks[0]?.path.at(-1)).toBe('Use danger');
  });

  it('explores state-changing random outcomes', async () => {
    const game = base();
    game.rooms[0].on = [
      { verb: 'use', a: 'exit', if: 'safe', do: [{ end: true }] },
      { verb: 'use', a: 'danger', if: '!doomed', do: [{ random: [[{ set: 'safe' }], [{ set: 'doomed' }]], key: 'danger-outcome' }] },
    ];
    const proof = await solve(game, layouts, { mode: 'prove' });
    expect(proof.status).toBe('softlocks');
    expect(proof.flagsReached).toEqual(expect.arrayContaining(['safe', 'doomed']));
  });

  it('records every attempted action, not only the ones that changed the state', async () => {
    const game = base();
    game.rooms[0].on = [
      { verb: 'use', a: 'danger', do: ['Just trouble, nothing to do about it.'] },
      { verb: 'use', a: 'exit', do: [{ end: true }] },
    ];
    const r = await solve(game, layouts, { mode: 'prove' });
    const ran = Object.keys(r.profile.perAction), tried = Object.keys(r.profile.attempted);
    expect(ran.every((id) => tried.includes(id))).toBe(true);
    expect(tried).toContain('rule:room/on[0]'); // the line-only rule: tried, nothing changed
    expect(ran).not.toContain('rule:room/on[0]');
  });

  it('reports an exhaustive game with no ending as unsolved', async () => {
    expect((await solve(pickups(3, false), pickupsLayouts, { mode: 'prove' })).status).toBe('unsolved');
  });
});
