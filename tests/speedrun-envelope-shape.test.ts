// The verifier reads a `.wsrun` as data (4.1.17, plan §9: the speedrun set's survivors): every shape it refuses, one
// field at a time, with the code that says so — not JSON, another format, a field it does not know, each field of the
// wrong type, a chunk of the wrong shape, a schema 1 or 2 seed, a world proof of the wrong shape (Daily, Mystery, the
// longest token accepted, one more character refused). A shape it accepts goes on to the next check, never to this one.
import { describe, expect, it } from 'vitest';
import { exportEnvelope } from '@engine/tools/speedrun/envelope';
import { verifyRun } from '@engine/tools/speedrun/verify';
import { playRun, verifyContext } from './fixtures/speedrun-run';

const base = await playRun();
const ctx = verifyContext(base.fingerprint);
const text = exportEnvelope(base.envelope);
type Env = Record<string, unknown> & { timing: Record<string, unknown>; chunks: Record<string, unknown>[] };
const edited = (f: (e: Env) => void) => {
  const e = JSON.parse(text) as Env;
  f(e);
  return e;
};
const codeOf = async (input: unknown) => (await verifyRun(input, ctx)).code;

describe('the envelope, read as data', () => {
  it('is JSON of the speedrun format, of schema 1 or 2', async () => {
    expect(await codeOf('{not json')).toBe('envelope-shape');
    expect(await codeOf(null)).toBe('envelope-shape');
    expect(await codeOf(42)).toBe('envelope-shape');
    expect(await codeOf(edited((e) => (e.format = 'web-scumm-save')))).toBe('envelope-shape');
    expect(
      await verifyRun(
        edited((e) => (e.schema = 3)),
        ctx,
      ),
    ).toMatchObject({
      verdict: 'unsupported-version',
      code: 'schema',
    });
    // The original verifies: what follows is each field broken alone.
    expect(await codeOf(text)).toBe('ok');
  });

  it('names a field it does not know', async () => {
    const r = await verifyRun(
      edited((e) => {
        e.bonus = 1;
        e.extra = 2;
      }),
      ctx,
    );
    expect(r).toMatchObject({ code: 'envelope-shape' });
    expect(r.reason).toContain('bonus, extra');
    // A schema 1 field in a schema 2 envelope is one it does not know either.
    expect(await codeOf(edited((e) => (e.seed = 'x')))).toBe('envelope-shape');
  });

  it('refuses each field of the wrong type, one at a time', async () => {
    const breaks: [string, (e: Env) => void][] = [
      ['gameId', (e) => (e.gameId = 1)],
      ['categoryId', (e) => (e.categoryId = null)],
      ['engineVersion', (e) => delete e.engineVersion],
      ['h0', (e) => (e.h0 = 0)],
      ['finalStateHash', (e) => (e.finalStateHash = {})],
      ['finalProof', (e) => delete e.finalProof],
      ['rulesVersion', (e) => (e.rulesVersion = 1.5)],
      ['prngVersion', (e) => (e.prngVersion = '1')],
      ['timingVersion', (e) => delete e.timingVersion],
      ['fingerprint', (e) => (e.fingerprint = null)],
      ['fingerprint, a string', (e) => (e.fingerprint = 'logic')],
      ['timing', (e) => delete (e as Record<string, unknown>).timing],
      ['logicalSteps', (e) => (e.timing.logicalSteps = 12)],
      ['logicalTime', (e) => (e.timing.logicalTime = '1.5')],
      ['activeTime', (e) => (e.timing.activeTime = 'soon')],
      ['rtaMs', (e) => (e.timing.rtaMs = '12')],
      ['excluded', (e) => (e.timing.excluded = {})],
      ['splits', (e) => (e.splits = null)],
      ['chunks', (e) => (e.chunks = {} as never)],
      ['a chunk', (e) => (e.chunks[0] = null as never)],
      ['a chunk index', (e) => (e.chunks[0]!.index = '0')],
      ['a chunk prevHash', (e) => (e.chunks[0]!.prevHash = 1)],
      ['a chunk hash', (e) => delete e.chunks[0]!.hash],
      ['a chunk entries', (e) => (e.chunks[0]!.entries = {})],
      ['runSeed (schema 2)', (e) => delete e.runSeed],
      ['loads', (e) => (e.loads = {})],
    ];
    for (const [what, f] of breaks) expect(await codeOf(edited(f)), what).toBe('envelope-shape');
    // A negative decimal is a decimal (the replay says the rest).
    expect(await codeOf(edited((e) => (e.timing.logicalTime = '-1')))).not.toBe('envelope-shape');
    // Loads may be absent or a list.
    expect(await codeOf(edited((e) => (e.loads = [])))).not.toBe('envelope-shape');
  });

  it('a schema 1 seed is a string when it is there; schema 2 names its world', async () => {
    const v1 = (f: (e: Env) => void) =>
      edited((e) => {
        e.schema = 1;
        e.seed = e.runSeed;
        delete e.runSeed;
        delete e.variant;
        f(e);
      });
    expect(await codeOf(v1(() => {}))).not.toBe('envelope-shape');
    expect(await codeOf(v1((e) => delete e.seed))).not.toBe('envelope-shape');
    expect(await codeOf(v1((e) => (e.seed = 7)))).toBe('envelope-shape');
    expect(await codeOf(edited((e) => delete e.variant))).toBe('world-missing');
  });

  it('a world proof is a Daily token or a Mystery commitment and reveal, of bounded size', async () => {
    // The reason tells this check from the later one (a Story run carries no token: also `world-shape`).
    const SHAPE = 'the world evidence is not a Daily or a Mystery proof';
    const proof = async (p: unknown) => {
      const r = await verifyRun(
        edited((e) => (e.worldEvidence = p)),
        ctx,
      );
      return r.reason === SHAPE ? 'shape' : r.code;
    };
    const token = (n: number) => 'a'.repeat(n);
    for (const bad of [
      null,
      'daily',
      { kind: 'weekly', token: 'x' },
      { kind: 'daily' },
      { kind: 'daily', token: 1 },
      { kind: 'daily', token: 'x', extra: 1 },
      { kind: 'daily', token: token(4097) },
      { kind: 'mystery', commitmentToken: 'c', revealToken: 'r' },
      { kind: 'mystery', commitmentToken: 'c', revealToken: 'r', startedAt: 1.5 },
      { kind: 'mystery', commitmentToken: 'c', revealToken: 7, startedAt: 1 },
      { kind: 'mystery', commitmentToken: token(4097), revealToken: 'r', startedAt: 1 },
      { kind: 'mystery', commitmentToken: 'c', revealToken: 'r', startedAt: 1, at: 2 },
      { kind: 'daily', commitmentToken: 'c', revealToken: 'r', startedAt: 1 },
    ])
      expect(await proof(bad), JSON.stringify(bad).slice(0, 60)).toBe('shape');
    // Shapes it accepts go on (and fail later: a story run has no proof to give).
    expect(await proof({ kind: 'daily', token: token(4096) })).toBe('world-shape');
    expect(await proof({ kind: 'mystery', commitmentToken: token(4096), revealToken: 'r', startedAt: 1 })).toBe(
      'world-shape',
    );
  });

  it('a replay over its budget is a timeout, a throw is a crash', async () => {
    expect(await verifyRun(text, { ...ctx, timeoutMs: 1 })).toMatchObject({ verdict: 'inconclusive', code: 'timeout' });
  });
});
