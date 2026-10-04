import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { analyzePlaytests, playtestsMarkdown } from '@engine/tools/playtests';
import { parseSessionFile, sessionFile } from '@engine/tools/replay';
import { solve } from '@engine/tools/solve';
import { game as demo, layouts as demoLayouts, commands } from '../games/demo';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A session played on the demo with a fake clock: a stall on the armchair, a hint, an interrupted walk. */
async function record() {
  const ui = new FakePresenter();
  const e = new Engine(structuredClone(demo), demoLayouts, ui, new MemoryStore(), { commands });
  e.digestOn = true;
  e.random = () => 0.7;
  let now = 0;
  e.clock = () => (now += 1500);
  ui.picks = [1];
  const p = e.newGame();
  await tick();
  await e.act({ verb: 'look', a: 'pantry' }); await tick();
  ui.picks = [0]; await e.act({ verb: 'talk', a: 'grandma' }); await tick();
  await e.act({ verb: 'take', a: 'shell' }); await p;
  // Three times the same useless action: a stall.
  for (let i = 0; i < 3; i++) await e.act({ verb: 'use', a: 'shell_phone', b: 'armchair' });
  // A hint.
  await e.act({ verb: 'talk', a: 'shell_phone' });
  // An interrupted walk: the presenter refuses once.
  const walk = ui.walk.bind(ui);
  ui.walk = (async () => { ui.walk = walk; return null; }) as unknown as typeof ui.walk;
  await e.act({ verb: 'open', a: 'armchair' });
  return e;
}

describe('playtests', () => {
  it('a shared session carries timestamps and ids only; the analysis finds the stall, the hint, the abort', async () => {
    const e = await record();
    const file = parseSessionFile(JSON.stringify(sessionFile('demo', e, { playtest: true })));
    expect(file.trace).toEqual([]);
    expect(file.session.at).toBeGreaterThan(0);
    const ts = file.session.log.map((en) => en.t!);
    expect(ts.every((t, i) => t !== undefined && (i === 0 || t >= ts[i - 1]))).toBe(true);
    expect(JSON.stringify(file)).not.toContain('smells like the sea');
    const r = await analyzePlaytests(demo, demoLayouts, [{ name: 'phone-1', file }], { commands });
    expect(r.files[0].divergedAt).toBeUndefined();
    expect(r.stalls[0]).toMatchObject({ file: 'phone-1', room: 'house', action: 'use shell_phone armchair', repeats: 3 });
    expect(Object.keys(r.hints).some((k) => k.startsWith('hint:house/'))).toBe(true);
    expect(r.rooms.house.hints).toBe(1);
    expect(r.aborts).toBe(1);
    expect(r.rooms.house.ms).toBeGreaterThan(0);
    expect(r.files[0].abandon.room).toBe('house');
    expect(Object.keys(r.heat).some((k) => k.startsWith('rule:house.'))).toBe(true);
    expect(r.heat['room:house']).toBeGreaterThan(0);
    const md = playtestsMarkdown(r, demo);
    expect(md).toContain('Where players stall');
    expect(md).toContain('phone-1');
  });

  it('a session the content outgrew is reported as diverged, never thrown', async () => {
    const e = await record();
    const file = parseSessionFile(JSON.stringify(sessionFile('demo', e, { playtest: true })));
    const changed = structuredClone(demo);
    const house = changed.rooms.find((r) => r.id === 'house')!;
    house.hotspots = Object.fromEntries(Object.entries(house.hotspots ?? {}).filter(([k]) => k !== 'pantry'));
    house.look = Object.fromEntries(Object.entries(house.look ?? {}).filter(([k]) => k !== 'pantry'));
    const r = await analyzePlaytests(changed, demoLayouts, [{ name: 'old', file }], { commands });
    expect(r.divergences).toBe(1);
    expect(r.files[0].divergedAt).toBeDefined();
  });

  it('without a clock, nothing is timestamped: the solver\'s steps stay as before', async () => {
    const s = await solve(demo, demoLayouts, { commands });
    expect(s.steps.every((en) => en.t === undefined)).toBe(true);
    const e = new Engine(structuredClone(demo), demoLayouts, new FakePresenter(), new MemoryStore(), { commands });
    await e.checkpoint(Object.keys(demo.checkpoints ?? {})[0]);
    expect(e.session?.at).toBeUndefined();
  });
});
