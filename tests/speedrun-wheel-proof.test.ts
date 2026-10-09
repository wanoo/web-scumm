// The code wheel's transcript (4.1.17, plan §8, D31, ADR 0020): a result is computed again, not taken at its word.
// The player records the answers it was given (their places in the author's list) and the wheel's hash; the replay
// generates the wheel from the world, judges them and must find the recorded result. A category with
// `codeWheel.proof: 'transcript'` refuses a result without its answers; a printed wheel without a moderator is
// `valid-unranked`; a category of 4.1.16 (no `proof`) reads what it read. A transcript proves a run consistent, not
// that a person played it: the trust stays `replay-valid`.
import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/core/engine';
import { MemoryChunkStore } from '@engine/core/journal-chunks';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import type { GameDef, MinigameOutcome, MinigameResult, SpeedrunCategory } from '@engine/core/types';
import { type CodeWheelParams, generateWheel, verifyWheelTranscript, wheelHash } from '@engine/core/remix/code-wheel';
import { exportEnvelope } from '@engine/tools/speedrun/envelope';
import { SpeedrunRecorder } from '@engine/tools/speedrun/recorder';
import { verifyRun } from '@engine/tools/speedrun/verify';
import { ROUTE, speedrunGame, speedrunLayouts } from './fixtures/speedrun-game';
import { WHEEL_CASES } from './fixtures/wheel-transcripts';
import { ENGINE_VERSION, fixtureFingerprint, verifyContext } from './fixtures/speedrun-run';

const PARAMS: CodeWheelParams = {
  actors: [1, 2, 3, 4, 5].map((i) => ({ id: `a${i}`, label: `A${i}` })),
  symbols: [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, label: `S${i}` })),
  answers: ['STREET', 'MARKET', 'ALLEY', 'YARD', 'CELLAR'],
  mode: 'parody',
  tries: 3,
  seed: 'story',
};
const wheel = generateWheel(PARAMS, 'story');
const right = PARAMS.answers.indexOf(wheel.answer);
const wrong = [0, 1, 2, 3, 4].filter((i) => i !== right);
const transcript = (answers: number[], end: 'decided' | 'skipped' = 'decided', p = PARAMS) => ({
  v: 1 as const,
  wheel: wheelHash(p, p.seed ?? 'story'),
  answers,
  end,
});

describe('a transcript, judged again', () => {
  it('gives the result its answers give', () => {
    expect(verifyWheelTranscript(PARAMS, transcript([right]))).toEqual({ result: 'won' });
    expect(verifyWheelTranscript(PARAMS, transcript([wrong[0]!, right]))).toEqual({ result: 'won' });
    expect(verifyWheelTranscript(PARAMS, transcript(wrong.slice(0, 3)))).toEqual({ result: 'passed' });
    expect(verifyWheelTranscript({ ...PARAMS, mode: 'story' }, transcript(wrong.slice(0, 3)))).toEqual({
      result: 'failed',
    });
    expect(verifyWheelTranscript(PARAMS, transcript([wrong[0]!], 'skipped'))).toEqual({ result: 'skipped' });
    expect(verifyWheelTranscript({ ...PARAMS, mode: 'disabled' }, transcript([], 'skipped'))).toEqual({
      result: 'disabled',
    });
  });

  it('refuses answers added, removed, changed or given to another wheel', () => {
    const bad = (p: Partial<CodeWheelParams>, t: unknown) => 'error' in verifyWheelTranscript({ ...PARAMS, ...p }, t);
    expect(bad({}, transcript([right, wrong[0]!]))).toBe(true); // an answer after the decision
    expect(bad({}, transcript([right], 'skipped'))).toBe(true); // decided, said skipped
    expect(bad({}, transcript([wrong[0]!]))).toBe(true); // undecided, said decided
    expect(bad({ mode: 'strict' }, transcript([wrong[0]!], 'skipped'))).toBe(true); // a strict wheel cannot be skipped
    expect(bad({}, transcript([9]))).toBe(true); // not an answer of this wheel
    expect(bad({}, transcript([1.5]))).toBe(true);
    expect(bad({}, { ...transcript([right]), wheel: '0'.repeat(16) })).toBe(true);
    expect(bad({ seed: 'WS-0000-02DZ' }, transcript([right]))).toBe(true); // the world's wheel, not this one
    expect(bad({}, { ...transcript([right]), v: 2 })).toBe(true);
    expect(bad({}, { ...transcript([]), answers: Array(65).fill(0) })).toBe(true); // bounded
    expect(bad({}, null)).toBe(true);
  });

  it('is the same proof in every language: answers by their place, the wheel hashed by places', () => {
    const fr = { ...PARAMS, answers: ['RUE', 'MARCHÉ', 'RUELLE', 'COUR', 'CAVE'] };
    expect(transcript([right], 'decided', fr)).toEqual(transcript([right]));
    expect(verifyWheelTranscript(fr, transcript([right]))).toEqual({ result: 'won' });
    // Two answers translated alike stay two places: the proof does not read the text.
    const twin = { ...PARAMS, answers: ['X', 'X', 'Y', 'Z', 'W'] };
    expect(verifyWheelTranscript(twin, transcript([right]))).toEqual({ result: 'won' });
    expect(verifyWheelTranscript(twin, transcript([wrong[0]!, wrong[1]!, wrong[2]!]))).toEqual({ result: 'passed' });
  });
});

describe('the same in every runtime', () => {
  it("Node writes the fixture's hashes and verdicts (npm run e2e:canonical holds the browsers to them)", () => {
    for (const c of WHEEL_CASES) expect(c.make(), c.name).toBe(c.expected);
  });
});

describe('a run with the wheel', () => {
  const game = (codeWheel: NonNullable<SpeedrunCategory['world']>['codeWheel']): GameDef => {
    const g = speedrunGame();
    g.speedrun = {
      ...g.speedrun!,
      categories: g.speedrun!.categories.map((c) =>
        c.id === 'any%' ? { ...c, world: { policy: 'story', mode: 'story', codeWheel } } : c,
      ),
    };
    return g;
  };
  /** Records the route after the wheel, whose presenter says `out`; returns the sealed text and its verdict. */
  async function run(
    g: GameDef,
    out: MinigameResult | MinigameOutcome | undefined,
    edit?: (env: string) => string,
    params: CodeWheelParams = PARAMS,
  ) {
    const fingerprint = await fixtureFingerprint(g);
    const p = new FakePresenter();
    p.minigame = async () => out;
    const engine = new Engine(g, speedrunLayouts, p, new MemoryStore());
    const rec = new SpeedrunRecorder({
      engine,
      gameId: g.id,
      manifest: g.speedrun!,
      category: g.speedrun!.categories.find((c) => c.id === 'any%')!,
      store: new MemoryChunkStore(),
      fingerprint,
      engineVersion: ENGINE_VERSION,
      now: () => 0,
    });
    await rec.start();
    await engine.script([{ minigame: 'code-wheel', params: params as never }]);
    for (const a of ROUTE) await engine.act({ ...a });
    const sealed = await rec.seal();
    return verifyRun(edit ? edit(exportEnvelope(sealed)) : sealed, verifyContext(fingerprint, g));
  }
  const proof = { enabled: true, skip: false, medium: 'digital', proof: 'transcript' } as const;

  it('a category that wants proof takes a win with its answers, and refuses the word alone', async () => {
    expect(await run(game(proof), { result: 'won', transcript: transcript([wrong[0]!, right]) })).toMatchObject({
      verdict: 'valid',
      trust: 'replay-valid',
    });
    expect(await run(game(proof), 'won')).toMatchObject({
      verdict: 'invalid-category-rule',
      code: 'code-wheel-proof',
    });
  });

  it('a result its answers do not give, or answers of another wheel: an invalid replay, not a crash', async () => {
    expect(await run(game(proof), { result: 'won', transcript: transcript(wrong.slice(0, 3)) })).toMatchObject({
      verdict: 'invalid-replay',
      code: 'minigame-transcript',
    });
    const other = { ...PARAMS, seed: 'WS-0000-02DZ' };
    expect(await run(game(proof), { result: 'won', transcript: transcript([right], 'decided', other) })).toMatchObject({
      verdict: 'invalid-replay',
      code: 'minigame-transcript',
    });
  });

  it('a transcript edited after the seal breaks the chain', async () => {
    const forged = (s: string) => {
      expect(s).toContain(`"answers":[${wrong[0]},${right}]`);
      return s.replace(`"answers":[${wrong[0]},${right}]`, `"answers":[${right}]`);
    };
    expect(await run(game(proof), { result: 'won', transcript: transcript([wrong[0]!, right]) }, forged)).toMatchObject(
      {
        verdict: 'invalid-replay',
      },
    );
  });

  it('a 4.1.16 category reads what it read: the word won, unproved, and the trust it had', async () => {
    expect(await run(game({ enabled: true, skip: false, medium: 'either' }), 'won')).toMatchObject({
      verdict: 'valid',
      trust: 'replay-valid',
    });
  });

  it('a wheel whose result was removed is still a played wheel: no escape from the proof or the printed wheel', async () => {
    const lenient = { enabled: true, skip: true, medium: 'digital', proof: 'transcript' } as const;
    expect(await run(game(lenient), undefined)).toMatchObject({
      verdict: 'invalid-category-rule',
      code: 'code-wheel-proof',
    });
    expect(await run(game(lenient), 'disabled')).toMatchObject({
      verdict: 'invalid-category-rule',
      code: 'code-wheel-proof',
    });
    expect(await run(game({ enabled: true, skip: true, medium: 'physical' }), undefined)).toMatchObject({
      verdict: 'valid-unranked',
      code: 'physical-wheel-unwitnessed',
    });
  });

  it('a printed wheel without a moderator is not ranked', async () => {
    expect(
      await run(game({ enabled: true, skip: true, medium: 'physical' }), {
        result: 'won',
        transcript: transcript([right]),
      }),
    ).toMatchObject({ verdict: 'valid-unranked', code: 'physical-wheel-unwitnessed', trust: 'replay-valid' });
    // Switched off, and proved so: nothing was played, the run is ranked.
    const off = { result: 'disabled' as const, transcript: transcript([], 'skipped', { ...PARAMS, mode: 'disabled' }) };
    const offParams = { ...PARAMS, mode: 'disabled' as const };
    expect(
      await run(game({ enabled: false, skip: true, medium: 'physical' }), off, undefined, offParams),
    ).toMatchObject({
      verdict: 'valid',
    });
  });
});
