// A minigame's transcript in the session (4.1.17, ADR 0020; the `core` mutation set): recorded beside its result when
// the presenter gives one, aligned with `mg` (a null for a result without one), and computed again when the session is
// replayed — the result it gives is fed, another result or another wheel stops the replay with the marked error the
// verifier reads; a null transcript is not checked.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { type CodeWheelParams, generateWheel, wheelHash } from '@engine/core/remix/code-wheel';
import type { MinigameOutcome, MinigameResult, Session } from '@engine/core/types';
import { TRANSCRIPT_REFUSED } from '@engine/core/minigame-proofs';
import { replay } from '@engine/tools/replay';
import { speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';

const P: CodeWheelParams = {
  actors: [1, 2, 3].map((i) => ({ id: `a${i}`, label: `A${i}` })),
  symbols: [1, 2, 3].map((i) => ({ id: `s${i}`, label: `S${i}` })),
  answers: ['x', 'y', 'z'],
  mode: 'parody',
  tries: 3,
  seed: 'story',
};
const right = P.answers.indexOf(generateWheel(P, 'story').answer);
const t = (answers: number[]) => ({ v: 1 as const, wheel: wheelHash(P, 'story'), answers, end: 'decided' as const });

/** Plays one script entry of minigames, each answered by the next outcome; returns the session. */
async function play(outs: (MinigameResult | MinigameOutcome | undefined)[]): Promise<Session> {
  const p = new FakePresenter();
  p.minigame = async () => outs.shift();
  const e = new Engine(speedrunGame(), speedrunLayouts, p, new MemoryStore());
  await e.newGame();
  await e.script([
    { minigame: 'code-wheel', params: P as never },
    { minigame: 'code-wheel', params: P as never },
  ]);
  return structuredClone(e.session!);
}

describe('a transcript in the session', () => {
  it('is kept beside its result, aligned (null for a result without one); a plain result keeps none', async () => {
    const s = await play(['passed', { result: 'won', transcript: t([right]) }]);
    expect(s.log.at(-1)).toMatchObject({ mg: ['passed', 'won'], mgt: [null, t([right])] });
    const plain = await play(['won', 'passed']);
    expect(plain.log.at(-1)!.mg).toEqual(['won', 'passed']);
    expect(plain.log.at(-1)!.mgt).toBeUndefined();
    const first = await play([{ result: 'won', transcript: t([right]) }, 'skipped']);
    expect(first.log.at(-1)!.mgt).toEqual([t([right])]);
  });

  it('is computed again on a replay: its result fed, another result or wheel refused with the marked error', async () => {
    const s = await play([
      { result: 'won', transcript: t([right]) },
      { result: 'won', transcript: t([right]) },
    ]);
    const ok = await replay(speedrunGame(), speedrunLayouts, s);
    expect(ok.divergedAt).toBeUndefined();
    expect(ok.errors).toEqual([]);
    expect(ok.state.flags['minigame.code-wheel']).toBe('won');
    const lied = structuredClone(s);
    lied.log.at(-1)!.mg = ['passed', 'won'];
    const r1 = await replay(speedrunGame(), speedrunLayouts, lied);
    expect(r1.errors.join(' ')).toContain(`${TRANSCRIPT_REFUSED} code-wheel: its transcript gives won, not passed`);
    const forged = structuredClone(s);
    forged.log.at(-1)!.mgt = [{ ...t([right]), wheel: '0'.repeat(16) }, null];
    const r2 = await replay(speedrunGame(), speedrunLayouts, forged);
    expect(r2.errors.join(' ')).toContain(`${TRANSCRIPT_REFUSED} code-wheel: its transcript is not one of this run`);
    // A null transcript is no transcript: nothing is checked, the result is fed.
    const none = structuredClone(s);
    none.log.at(-1)!.mg = ['passed', 'won'];
    none.log.at(-1)!.mgt = [null, t([right])];
    expect((await replay(speedrunGame(), speedrunLayouts, none)).errors).toEqual([]);
  });
});
