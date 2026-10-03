// The solver's partial-order reduction: the same answers as the plain search, fewer engine runs where actions commute.
import { describe, expect, it } from 'vitest';
import type { GameDef, Layout } from '@engine/core/types';
import { solve, type SolveOptions, type SolveResult } from '@engine/tools/solve';
import { makeStressGame } from '@engine/tools/stress';
import { game as demo } from '../games/demo/game';
import { commands } from '../games/demo/index';
import house from '../games/demo/layout/house.json';
import garden from '../games/demo/layout/garden.json';
import market from '../games/demo/layout/market.json';
import { dott, dottLayouts, grog, grogLayouts, insults, insultsLayouts, mansion, mansionLayouts, stan, stanLayouts } from './fixtures/classics';
import { pickups, pickupsLayouts, trials, trialsLayouts } from './fixtures/por';
import { world, worldLayouts } from './fixtures/world';
import { cast, castLayouts } from './fixtures/cast';

const demoLayouts: Record<string, Layout> = { house: house as unknown as Layout, garden: garden as unknown as Layout, market: market as unknown as Layout };
const same = (a: SolveResult, b: SolveResult) => {
  expect(b.finished).toBe(a.finished);
  expect(b.flagsReached).toEqual(a.flagsReached);
  expect(b.roomsReached).toEqual(a.roomsReached);
  expect(b.unlockedReached).toEqual(a.unlockedReached);
  expect(b.unusedItems).toEqual(a.unusedItems);
  expect(b.broken).toEqual(a.broken);
  expect(b.states).toBe(a.states);
};

describe('sleep sets give the same answers', () => {
  const stress = makeStressGame({ rooms: 10, players: 2, items: 12, flags: 30, npcs: 2, scripts: 4, topics: 6 });
  const games: [string, GameDef, Record<string, Layout>, Partial<SolveOptions>][] = [
    ['insults', insults(), insultsLayouts, {}], ['grog', grog(), grogLayouts, {}], ['dott', dott(), dottLayouts, {}], ['mansion', mansion(), mansionLayouts, {}], ['stan', stan(), stanLayouts, {}],
    ['world', world(), worldLayouts, {}], ['cast', cast(), castLayouts, {}], ['trials', trials(), trialsLayouts, {}],
    ['pickups 4 (dead end)', pickups(4, false), pickupsLayouts, {}], ['stress 10 rooms', stress.game, stress.layouts, { maxStates: 5000 }],
    ['demo', structuredClone(demo), demoLayouts, { commands }],
  ];
  for (const [name, game, layouts, o] of games) it(name, async () => {
    const plain = await solve(structuredClone(game), layouts, { ...o, por: false });
    const sleep = await solve(structuredClone(game), layouts, { ...o, por: 'sleep' });
    same(plain, sleep);
    expect(sleep.profile.tries).toBeLessThanOrEqual(plain.profile.tries);
    // Stubborn sets explore fewer states: the proof is the same, the counts are not.
    const stubborn = await solve(structuredClone(game), layouts, { ...o, por: 'stubborn' });
    expect(stubborn.finished).toBe(plain.finished);
    expect(stubborn.broken).toEqual(plain.broken);
    expect(stubborn.states).toBeLessThanOrEqual(plain.states);
    expect(stubborn.profile.tries).toBeLessThanOrEqual(plain.profile.tries);
  });
});

describe('what the reduction saves', () => {
  it('k independent pickups before a door that can never open: every subset is a state, but far fewer runs', async () => {
    const k = 6;
    const plain = await solve(pickups(k, false), pickupsLayouts, { por: false });
    const sleep = await solve(pickups(k, false), pickupsLayouts, { por: 'sleep' });
    expect(plain.finished).toBe(false);
    expect(plain.states).toBe(2 ** k);
    expect(sleep.states).toBe(2 ** k);
    expect(plain.profile.tries).toBeGreaterThan(k * 2 ** (k - 1));
    expect(sleep.profile.slept).toBeGreaterThan(0);
    expect(sleep.profile.tries).toBeLessThan(plain.profile.tries);
    // one pickup at a time: k + 1 states, k·(k+1)/2 + k + 1 runs, instead of 2^k states
    const stubborn = await solve(pickups(k, false), pickupsLayouts, { por: 'stubborn' });
    expect(stubborn.finished).toBe(false);
    expect(stubborn.states).toBe(k + 1);
    expect(stubborn.profile.postponed).toBeGreaterThan(0);
    expect(stubborn.profile.tries).toBeLessThan(plain.profile.tries / 4);
  });
  it('the three trials: one order instead of six', async () => {
    const plain = await solve(trials(), trialsLayouts, { por: false });
    const stubborn = await solve(trials(), trialsLayouts, { por: 'stubborn' });
    expect(stubborn.finished).toBe(true);
    expect(stubborn.states).toBeLessThan(plain.states);
    expect(stubborn.path).toHaveLength(4);
  });
  it('the finishable variant ends in k + 1 steps either way', async () => {
    const r = await solve(pickups(5), pickupsLayouts, { por: 'sleep' });
    expect(r.finished).toBe(true);
    expect(r.path.length).toBe(6);
  });
});
