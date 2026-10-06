// Properties of saves, sessions and migrations over games played at random (4.1.0 "Clarity", fast-check): whatever
// a player does, the save comes back identical through JSON, the session replays to the same state, and a migration
// is a function of the save alone (twice is once).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { stateDigest } from '@engine/core/diff';
import { migrate } from '@engine/core/migrate';
import { parseSave, saveEnvelope } from '@engine/core/save';
import type { Action, GameDef, GameState, Layout, Session } from '@engine/core/types';
import { replay } from '@engine/tools/replay';
import { cast, castLayouts } from './fixtures/cast';
import { scale, scaleLayouts } from './fixtures/scale';
import { world, worldLayouts } from './fixtures/world';

const GAMES: [string, () => GameDef, Record<string, Layout>][] = [
  ['scale', scale, scaleLayouts],
  ['world', world, worldLayouts],
  ['cast', cast, castLayouts],
];

/** Plays `picks` as actions: each pick chooses a verb, a target and maybe an item among what the room offers. */
async function play(game: GameDef, layouts: Record<string, Layout>, picks: number[], draws: number[]) {
  const ui = new FakePresenter();
  const e = new Engine(structuredClone(game), layouts, ui, new MemoryStore());
  e.digestOn = true;
  let d = 0;
  e.random = () => draws[d++ % draws.length] ?? 0.5;
  ui.picks = picks.map((p) => p % 3);
  await e.newGame();
  for (const p of picks) {
    if (e.state.done) break;
    const targets = e.targets();
    const verbs = e.game.verbs.map((v) => v.id);
    const items = e.state.inventory;
    if (!targets.length || !verbs.length) break;
    const verb = verbs[p % verbs.length]!;
    const a = targets[Math.floor(p / verbs.length) % targets.length]!;
    const act: Action = items.length && p % 4 === 0 ? { verb, a: items[p % items.length]!, b: a } : { verb, a };
    await e.act(act);
  }
  return e;
}

const runs = fc.tuple(
  fc.array(fc.nat(500), { minLength: 1, maxLength: 14 }),
  fc.array(fc.double({ min: 0, max: 0.999, noNaN: true }), { minLength: 1, maxLength: 4 }),
);

describe.each(GAMES)('properties of %s, played at random', (_id, make, layouts) => {
  it('a save comes back identical through JSON', async () => {
    await fc.assert(
      fc.asyncProperty(runs, async ([picks, draws]) => {
        const game = make();
        const e = await play(game, layouts, picks, draws);
        const back = parseSave(e.game, JSON.parse(JSON.stringify(saveEnvelope(e.game, e.state))));
        expect(back).toEqual(e.state);
        expect(stateDigest(back)).toBe(stateDigest(e.state));
      }),
      { numRuns: 40 },
    );
  });

  it('a session replays to the same state, entry by entry', async () => {
    await fc.assert(
      fc.asyncProperty(runs, async ([picks, draws]) => {
        const game = make();
        const e = await play(game, layouts, picks, draws);
        const s = JSON.parse(JSON.stringify(e.session)) as Session;
        const r = await replay(game, layouts, s);
        expect(r.divergedAt).toBeUndefined();
        expect(stateDigest(r.state)).toBe(stateDigest(e.state));
      }),
      { numRuns: 40 },
    );
  });
});

describe('the random plays', () => {
  it('move the games: the properties are not checked on a game that never changes', async () => {
    for (const [id, make, layouts] of GAMES) {
      const start = JSON.stringify((await play(make(), layouts, [], [0.5])).state);
      const e = await play(
        make(),
        layouts,
        Array.from({ length: 40 }, (_, i) => i * 7),
        [0.5],
      );
      expect(JSON.stringify(e.state), id).not.toBe(start);
      expect(e.session?.log.length ?? 0, id).toBeGreaterThan(5);
    }
  });
});

describe('migrations', () => {
  const old = (s: GameState, flags: string[]): GameState => ({
    ...structuredClone(s),
    v: 1,
    flags: Object.fromEntries(flags.map((f) => [f, true])),
    inventory: flags.includes('found') ? ['cle'] : [],
  });

  it('bring any old save to the current version, and twice is once', async () => {
    const game = scale();
    const e = await play(game, scaleLayouts, [0], [0.5]);
    await fc.assert(
      fc.asyncProperty(fc.subarray(['found', 'tmp', 'other', 'key_found']), async (flags) => {
        const once = migrate(game, old(e.state, flags));
        expect(once?.v).toBe(game.saveVersion);
        expect(migrate(game, once)).toEqual(once);
        expect(once?.flags.tmp).toBeUndefined();
        if (flags.includes('found')) expect(once?.flags.key_found).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('leave a current save untouched, and an unreachable version refused', () => {
    const game = scale();
    const s = { ...structuredClone(game.start as unknown as GameState), v: game.saveVersion } as GameState;
    expect(migrate(game, s)).toBe(s);
    expect(migrate(game, { ...s, v: 99 })).toBeNull();
  });
});
