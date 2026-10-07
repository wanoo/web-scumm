// A speedrun manifest is content (4.1.14 "Time Attack"): `GameDef.speedrun` declares categories, splits and the
// rules' version; the validator checks their triggers and rules; and a complete category is defined by a game alone,
// with no change under src/ (the fixture's ids appear nowhere in the engine), then played to its finish trigger.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef } from '@engine/core/types';
import { validate } from '@engine/tools/validate';
import { matches } from '@engine/tools/speedrun/triggers';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';

const errorsOf = (g: GameDef) => validate(g, speedrunLayouts).errors.filter((e) => e.includes('speedrun'));
const warningsOf = (g: GameDef) => validate(g, speedrunLayouts).warnings.filter((e) => e.includes('speedrun'));

describe('the speedrun manifest', () => {
  it('the fixture’s manifest validates', () => {
    expect(errorsOf(speedrunGame())).toEqual([]);
    expect(warningsOf(speedrunGame())).toEqual([]);
  });

  it('refuses unknown triggers, ids, rules and parents, and says what is wrong', () => {
    const g = speedrunGame();
    const m = g.speedrun!;
    const c = { ...m.categories[0]! };
    g.speedrun = {
      rulesVersion: 0,
      categories: [
        { ...c, id: 'bad id!', start: { event: 'menuOpened' as never } },
        { ...c, finish: { event: 'roomEntered', room: 'nowhere' }, realityPolicy: 'live', reload: 'segment' },
        {
          ...c,
          start: c.finish,
          fingerprint: [],
          inputs: { ...c.inputs, mouse: false, touch: false, keyboard: false, gamepad: false },
        },
      ],
      splits: [
        { id: 'a', name: 'A', at: { event: 'itemAcquired', item: 'nothing' }, parent: 'b' },
        { id: 'b', name: 'B', at: { event: 'objectiveCompleted', objective: 'none' }, parent: 'a' },
      ],
    };
    const msgs = errorsOf(g);
    for (const m of [
      'rulesVersion is a whole number from 1',
      'category id "bad id!"',
      'unknown semantic event: "menuOpened"',
      'duplicate category id: "any%"',
      'unknown room: "nowhere"',
      'realityPolicy "live" needs',
      'the start and the finish are the same trigger',
      'names the fingerprint components',
      'allows one input at least',
      'unknown item: "nothing"',
      'unknown objective: "none"',
      'is its own ancestor',
      'reload "segment" is reserved, not implemented in 4.1.14',
    ])
      expect(
        msgs.some((x) => x.includes(m)),
        m,
      ).toBe(true);
  });

  it('warns about a trigger that cannot fire and a category that does not require the logic', () => {
    const g = speedrunGame();
    const c = g.speedrun!.categories[0]!;
    g.speedrun = {
      ...g.speedrun!,
      categories: [{ ...c, fingerprint: ['presentation'], finish: { event: 'flagChanged', flag: 'never' } }],
    };
    const w = warningsOf(g);
    expect(w.some((x) => x.includes('flag "never" is never set'))).toBe(true);
    expect(w.some((x) => x.includes('does not require `logic`'))).toBe(true);
  });
});

describe('a complete category defined in content only', () => {
  it('names nothing of the engine: the fixture’s game and category ids appear nowhere under src/', () => {
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((e) => {
        const p = join(d, e);
        return statSync(p).isDirectory() ? files(p) : /\.(ts|css|html)$/.test(e) ? [p] : [];
      });
    const offenders = files('src').filter((f) => /['"`](vault|no-hints|fixed-seed)['"`]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('its start and finish triggers fire on the route, in order, from the semantic journal', async () => {
    const g = speedrunGame();
    const e = new Engine(g, speedrunLayouts, new FakePresenter(), new MemoryStore());
    await e.newGame();
    for (const a of ROUTE) await e.act({ ...a });
    const cat = g.speedrun!.categories.find((c) => c.id === 'no-hints')!;
    const events = e.journal.since(0);
    const start = events.findIndex((x) => matches(cat.start, x));
    const finish = events.findIndex((x) => matches(cat.finish, x));
    expect(start).toBe(0);
    expect(finish).toBeGreaterThan(start);
    for (const s of g.speedrun!.splits)
      expect(
        events.some((x) => matches(s.at, x)),
        s.id,
      ).toBe(true);
    expect(e.state.done).toBe(true);
  });
});
