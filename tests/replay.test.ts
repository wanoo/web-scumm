// Replay: the solver's solution is a session the engine plays again; a recorded session comes back identical,
// through JSON, and a tampered one says where it stops matching.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef, Layout, Session } from '@engine/core/types';
import { solve } from '@engine/tools/solve';
import { labelOf, replay } from '@engine/tools/replay';
import { stateDigest } from '@engine/core/diff';
import { game as demo } from '../games/demo/game';
import { commands } from '../games/demo/index';
import house from '../games/demo/layout/house.json';
import garden from '../games/demo/layout/garden.json';
import market from '../games/demo/layout/market.json';
import { dott, dottLayouts, grog, grogLayouts, insults, insultsLayouts, mansion, mansionLayouts, stan, stanLayouts } from './fixtures/classics';

const demoLayouts: Record<string, Layout> = { house: house as unknown as Layout, garden: garden as unknown as Layout, market: market as unknown as Layout };

describe('the solver\'s solution replays', () => {
  const games: [string, () => GameDef, Record<string, Layout>][] = [
    ['insults', insults, insultsLayouts], ['grog', grog, grogLayouts], ['dott', dott, dottLayouts], ['mansion', mansion, mansionLayouts], ['stan', stan, stanLayouts],
  ];
  for (const [name, make, layouts] of games) it(`${name}: the steps reach the ending`, async () => {
    const r = await solve(make(), layouts, { maxStates: 5000 });
    expect(r.finished).toBe(true);
    expect(r.steps.length).toBeGreaterThan(0);
    const p = await replay(make(), layouts, { start: { kind: 'new' }, log: r.steps });
    expect(p.divergedAt).toBeUndefined();
    expect(p.ended).toBe(true);
    expect(p.played).toBe(r.steps.filter((s) => !('start' in s)).length);
  });

  it('demo: the steps reach the sealed ending, every entry has a label', async () => {
    const r = await solve(structuredClone(demo), demoLayouts, { maxStates: 20000, commands });
    expect(r.finished).toBe(true);
    const p = await replay(demo, demoLayouts, { start: { kind: 'new' }, log: r.steps }, { commands });
    expect(p.divergedAt).toBeUndefined();
    expect(p.ended).toBe(true);
    for (const s of r.steps) expect(labelOf(demo, s)).toBeTruthy();
    expect(r.steps[0]).toMatchObject({ start: 'new', picks: [2] });
    expect(r.steps.at(-1)).toMatchObject({ act: { verb: 'use', a: 'key', b: 'pantry' }, ran: ['rule:house/on[6]'] });
  });
});

describe('a recorded session', () => {
  async function record() {
    const ui = new FakePresenter();
    const e = new Engine(structuredClone(demo), demoLayouts, ui, new MemoryStore(), { commands });
    e.digestOn = true;
    e.random = () => 0.7;
    ui.picks = [1]; // the opening guess
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const p = e.newGame();
    await tick();
    // the tutorial: look at the pantry, talk to grandma (a topic, then bye), pick up the shell phone
    await e.act({ verb: 'look', a: 'pantry' });
    await tick();
    ui.picks = [0];
    await e.act({ verb: 'talk', a: 'grandma' });
    await tick();
    await e.act({ verb: 'take', a: 'shell' });
    await p;
    await e.act({ verb: 'open', a: 'armchair' });
    await e.act({ verb: 'use', a: 'shell_phone', b: 'armchair' }); // a fallback line: a random draw
    await e.act({ verb: 'open', a: 'window' });
    return { e, ui };
  }

  it('comes back identical, through JSON', async () => {
    const { e } = await record();
    const s = JSON.parse(JSON.stringify(e.session)) as Session;
    expect(s.start).toEqual({ kind: 'new' });
    expect(s.log[0]).toMatchObject({ start: 'new', picks: [1] });
    expect((s.log.find((x) => 'act' in x && x.act.a === 'grandma') as { picks: number[] }).picks[0]).toBe(0);
    expect(s.log.find((x) => 'act' in x && x.act.b === 'armchair')).toMatchObject({ rnd: [0.7] });
    const p = await replay(demo, demoLayouts, s, { commands });
    expect(p.divergedAt).toBeUndefined();
    expect(p.played).toBe(s.log.length - 1);
    expect(stateDigest(p.state)).toBe(stateDigest(e.state));
    expect(p.state.room).toBe('garden');
    expect(p.trace.some((t) => t.text.includes('open armchair'))).toBe(true);
  });

  it('says where a tampered one diverges, and stops at upTo', async () => {
    const { e } = await record();
    const s = JSON.parse(JSON.stringify(e.session)) as Session;
    const i = s.log.findIndex((x) => 'act' in x && x.act.a === 'armchair' && !x.act.b);
    (s.log[i] as { act: { a: string } }).act.a = 'clock';
    const p = await replay(demo, demoLayouts, s, { commands });
    expect(p.divergedAt).toBe(i);
    expect(p.divergence).toContain('differs');
    const q = await replay(demo, demoLayouts, s, { commands, upTo: i });
    expect(q.divergedAt).toBeUndefined();
    expect(q.played).toBe(i - 1);
    expect(q.state.inventory).toContain('shell_phone');
  });

  it('starts from a save or a checkpoint', async () => {
    const ui = new FakePresenter();
    const e = new Engine(structuredClone(demo), demoLayouts, ui, new MemoryStore(), { commands });
    e.digestOn = true;
    await e.checkpoint('garden');
    expect(e.session?.start).toEqual({ kind: 'checkpoint', id: 'garden' });
    await e.act({ verb: 'look', a: 'tank' });
    const p = await replay(demo, demoLayouts, e.session!, { commands });
    expect(p.divergedAt).toBeUndefined();
    const saved = structuredClone(e.state);
    await e.load(saved);
    expect(e.session?.start).toEqual({ kind: 'load' });
    expect(e.session?.log).toEqual([]);
    const q = await replay(demo, demoLayouts, e.session!, { commands });
    expect(q.state.room).toBe(saved.room);
  });
});
