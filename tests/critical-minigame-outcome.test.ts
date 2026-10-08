// A minigame's result counts (4.1.16, plan §9): a minigame that says how it ended (the code wheel's `mg-record`) has
// its result recorded in the session (`mg`, fed back on a replay like a choice), written in the reserved flag
// `minigame.<id>` (the story reads it, the journal says `flagChanged`), and judged by a speedrun category's code wheel
// rule. A session of 4.1.15 (no `mg`) replays as it was: nothing is written for a minigame that said nothing.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { MemoryChunkStore } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef, MinigameResult, SpeedrunCategory } from '@engine/core/types';
import { replay } from '@engine/tools/replay';
import { SpeedrunRecorder } from '@engine/tools/speedrun/recorder';
import { verifyRun } from '@engine/tools/speedrun/verify';
import { judge, generateWheel } from '@engine/core/remix/code-wheel';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';
import { ENGINE_VERSION, fixtureFingerprint, verifyContext } from './fixtures/speedrun-run';

/** A presenter whose minigames end as told (the player's code wheel, in a test). */
const ending = (result: MinigameResult | undefined) => {
  const p = new FakePresenter();
  p.minigame = async () => result;
  return p;
};

describe("a minigame's result", () => {
  it('is recorded in the session, written in its reserved flag, said by the journal, and fed back on a replay', async () => {
    const game = speedrunGame();
    const e = new Engine(game, speedrunLayouts, ending('failed'), new MemoryStore());
    const events: string[] = [];
    e.journal.subscribe((ev) => {
      if (ev.kind === 'flagChanged') events.push(`${ev.flag}=${String(ev.value)}`);
    });
    await e.newGame();
    await e.script([{ minigame: 'code-wheel' }]);
    expect(e.state.flags['minigame.code-wheel']).toBe('failed');
    expect(events).toContain('minigame.code-wheel=failed');
    const session = structuredClone(e.session!);
    expect(session.log.at(-1)).toMatchObject({ mg: ['failed'] });
    // The replay never plays it again: the recorded result is fed (its presenter would say nothing).
    const r = await replay(game, speedrunLayouts, session);
    expect(r.divergedAt).toBeUndefined();
    expect(r.state.flags['minigame.code-wheel']).toBe('failed');
  });

  it('a minigame that says nothing records nothing: a 4.1.15 session replays as it was', async () => {
    const game = speedrunGame();
    const e = new Engine(game, speedrunLayouts, ending(undefined), new MemoryStore());
    await e.newGame();
    await e.script([{ minigame: 'cables' }]);
    expect(e.state.flags['minigame.cables']).toBeUndefined();
    expect(e.session!.log.at(-1)!.mg).toBeUndefined();
  });

  it('a story wheel lost after its tries is failed; a parody lets through', () => {
    const w = generateWheel(
      {
        actors: [1, 2, 3].map((i) => ({ id: `a${i}`, label: `A${i}` })),
        symbols: [1, 2, 3].map((i) => ({ id: `s${i}`, label: `S${i}` })),
        answers: ['x', 'y', 'z'],
      },
      'story',
    );
    const bad = ['x', 'y', 'z'].find((a) => a !== w.answer)!;
    expect(judge(w, 'story', bad, 2)).toBe('failed');
    expect(judge(w, 'story', bad, 0)).toBe('wrong');
    expect(judge(w, 'parody', bad, 2)).toBe('passed');
  });
});

describe("a speedrun category's code wheel rule", () => {
  const withWheel = (codeWheel: NonNullable<SpeedrunCategory['world']>['codeWheel']): GameDef => {
    const g = speedrunGame();
    g.speedrun = {
      ...g.speedrun!,
      categories: g.speedrun!.categories.map((c) =>
        c.id === 'any%' ? { ...c, world: { policy: 'story', mode: 'story', codeWheel } } : c,
      ),
    };
    return g;
  };
  async function run(game: GameDef, result: MinigameResult | undefined) {
    const fingerprint = await fixtureFingerprint(game);
    const engine = new Engine(game, speedrunLayouts, ending(result), new MemoryStore());
    const rec = new SpeedrunRecorder({
      engine,
      gameId: game.id,
      manifest: game.speedrun!,
      category: game.speedrun!.categories.find((c) => c.id === 'any%')!,
      store: new MemoryChunkStore(),
      fingerprint,
      engineVersion: ENGINE_VERSION,
      now: () => 0,
    });
    await rec.start();
    await engine.script([{ minigame: 'code-wheel' }]);
    for (const a of ROUTE) await engine.act({ ...a });
    return verifyRun(await rec.seal(), verifyContext(fingerprint, game));
  }
  it('a category that wants the wheel won refuses a parody pass; one that lets it be skipped takes it', async () => {
    const strict = withWheel({ enabled: true, skip: false, medium: 'either' });
    expect(await run(strict, 'won')).toMatchObject({ verdict: 'valid' });
    expect(await run(strict, 'passed')).toMatchObject({ verdict: 'invalid-category-rule', code: 'code-wheel-rule' });
    // A wheel played without a result (a client that dropped it) is no win where the category wants one.
    expect(await run(strict, undefined)).toMatchObject({
      code: 'code-wheel-rule',
      reason: expect.stringMatching(/no result/),
    });
    const lenient = withWheel({ enabled: true, skip: true, medium: 'either' });
    expect(await run(lenient, 'passed')).toMatchObject({ verdict: 'valid' });
    expect(await run(lenient, undefined)).toMatchObject({ verdict: 'valid' });
    const off = withWheel({ enabled: false, skip: true, medium: 'digital' });
    expect(await run(off, 'skipped')).toMatchObject({ verdict: 'valid' });
    expect(await run(off, 'won')).toMatchObject({ code: 'code-wheel-rule' });
  });
});

describe('the validator knows the minigame flags', () => {
  it('a story reading minigame.<id> where the game plays that minigame is not "never set"', async () => {
    const { validate } = await import('@engine/tools/validate');
    const g = speedrunGame();
    (g.rooms[0]!.on ??= []).push(
      { verb: 'look', a: 'door', do: [{ minigame: 'code-wheel' }] },
      { verb: 'use', a: 'phone', if: { flag: 'minigame.code-wheel', eq: 'failed' }, do: ['The wheel stays silent.'] },
    );
    const warnings = validate(g, speedrunLayouts).warnings.filter((w) => w.includes('minigame.code-wheel'));
    expect(warnings).toEqual([]);
  });
});
