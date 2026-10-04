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

describe('boundaries and the proof by chapters', () => {
  it('a proof with a goal returns every state where the goal holds; the next chapter starts from each distinct one', async () => {
    const { proveChapters } = await import('@engine/tools/chapters');
    const { makeStressGame } = await import('@engine/tools/stress');
    const stress = makeStressGame({ rooms: 6, players: 1, items: 6, flags: 10, npcs: 0, scripts: 0, topics: 2, chapters: 2 });
    const first = Object.entries(stress.game.checkpoints!)[0];
    const r = await solve(stress.game, stress.layouts, { mode: 'prove', goal: first[1].goals });
    expect(r.status).toBe('solved');
    expect(r.boundaries.length).toBeGreaterThan(0);
    const p = await proveChapters(stress.game, stress.layouts, { mode: 'prove' });
    expect(p.status).toBe('solved');
    expect(p.chapters.map((c) => c.id)).toEqual([...Object.keys(stress.game.checkpoints!), 'ending']);
    expect(p.chapters[0].from).toBe(1);
    expect(p.chapters[1].from).toBe(p.chapters[0].boundaries);
    expect(p.chapters.every((c) => !c.checkpointUnreachable)).toBe(true);
  }, 60000);

  it('a checkpoint that no reachable boundary state matches is reported', async () => {
    const { proveChapters } = await import('@engine/tools/chapters');
    const game = base();
    game.rooms[0].on = [
      { verb: 'use', a: 'danger', do: [{ set: 'armed' }] },
      { verb: 'use', a: 'exit', if: { all: ['armed', '!bogus'] }, do: [{ end: true }] },
    ];
    // `bogus` is read by the ending's rule, so the next chapter's projection keeps it: no reachable state has it.
    game.checkpoints = { armed: { room: 'room', flags: { armed: true, bogus: true }, goals: ['armed'] } };
    const p = await proveChapters(game, layouts, { mode: 'prove' });
    expect(p.chapters[0].checkpointUnreachable).toBe(true);
    expect(p.status).toBe('checkpoint_mismatch');
    const { chaptersExitCode } = await import('@engine/tools/chapters');
    expect(chaptersExitCode(p)).toBe(1);
  });
});

describe('the proof by chapters stays honest past its budget', () => {
  it('a chapter with more boundary states than the cap is truncated, and nothing after it is claimed', async () => {
    const { proveChapters } = await import('@engine/tools/chapters');
    const { makeStressGame } = await import('@engine/tools/stress');
    const stress = makeStressGame({ rooms: 10, players: 2, items: 6, flags: 10, npcs: 0, scripts: 0, topics: 2, chapters: 2 });
    const p = await proveChapters(stress.game, stress.layouts, { mode: 'prove', maxStarts: 3 });
    expect(p.status).toBe('truncated');
    expect(p.chapters.at(-1)!.status).toBe('truncated');
    expect(p.chapters.map((c) => c.id)).not.toContain('ending');
  }, 60000);
});

describe('the proof by chapters has one state budget', () => {
  it('past the budget the proof is truncated, never green', async () => {
    const { proveChapters } = await import('@engine/tools/chapters');
    const { makeStressGame } = await import('@engine/tools/stress');
    const stress = makeStressGame({ rooms: 10, players: 2, items: 6, flags: 10, npcs: 0, scripts: 0, topics: 2, chapters: 2 });
    const p = await proveChapters(stress.game, stress.layouts, { mode: 'prove', budget: 50 });
    expect(p.status).toBe('truncated');
    expect(p.chapters.reduce((n, c) => n + c.states, 0)).toBeLessThanOrEqual(50 + 20000);
  }, 60000);
});

describe('the solver measures itself', () => {
  it('splits its time by phase and counts character positions', async () => {
    const { makeStressGame } = await import('@engine/tools/stress');
    const g = makeStressGame({ rooms: 6, players: 2, items: 4, flags: 6, npcs: 0, scripts: 0, topics: 2 });
    const r = await solve(g.game, g.layouts, { mode: 'prove', maxStates: 400 });
    expect(Object.keys(r.profile.timing).sort()).toEqual(['classify', 'clone', 'engine', 'hash', 'other', 'queue', 'run', 'tries']);
    expect(Object.values(r.profile.timing).every((v) => v >= 0)).toBe(true);
    expect(r.profile.timing.run).toBeGreaterThan(0);
    expect(r.profile.positions).toBeGreaterThan(1);
    expect(r.profile.positions).toBeLessThanOrEqual(r.states);
  }, 60000);
});
