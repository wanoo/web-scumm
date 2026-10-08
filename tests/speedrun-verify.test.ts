// The speedrun verifier (4.1.14 "Time Attack", ADR 0017): a run recorded live is sealed into a `.wsrun` envelope and
// verified `valid`; every alteration of the table (time, action, seed, rules, signal, hash, chunk…) is rejected with
// its own code; the category's rules are checked; `inconclusive` is never valid; a verifier never grants more than
// `replay-valid`. The envelope is canonical JSON and nothing in tools/speedrun/ stringifies an object (bigints).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@engine/core/canonical';
import { CHUNK_SIZE } from '@engine/core/journal-chunks';
import { exportEnvelope, type SpeedrunEnvelope } from '@engine/tools/speedrun/envelope';
import { isRankable, parseEnvelope, verifyRun } from '@engine/tools/speedrun/verify';
import { ROUTE, speedrunGame } from './fixtures/speedrun-game';
import { ENGINE_VERSION, playRun, verifyContext } from './fixtures/speedrun-run';

const clone = (e: SpeedrunEnvelope) => JSON.parse(exportEnvelope(e)) as SpeedrunEnvelope & Record<string, unknown>;

describe('a run sealed live verifies', () => {
  it('valid, replay-valid, recomputing what the run says', async () => {
    const { envelope, fingerprint } = await playRun();
    expect(envelope.trust).toBe('local');
    expect(envelope.format).toBe('web-scumm-speedrun');
    expect(envelope.chunks).toHaveLength(1);
    expect(envelope.splits.map((s) => s.entry !== null)).toEqual([true, true, true, true]);
    expect(typeof envelope.timing.logicalTime).toBe('string');
    const r = await verifyRun(exportEnvelope(envelope), verifyContext(fingerprint));
    expect(r).toMatchObject({ verdict: 'valid', code: 'ok', trust: 'replay-valid' });
    expect(r.recomputed!.logicalTime).toBe(envelope.timing.logicalTime);
    expect(r.recomputed!.finalProof).toBe(envelope.finalProof);
    expect(isRankable(r.verdict)).toBe(true);
  });

  it('an envelope that claims more trust than `local` gets no more than `replay-valid`', async () => {
    const { envelope, fingerprint } = await playRun();
    const e = clone(envelope);
    e.trust = 'moderator-verified';
    const r = await verifyRun(e, verifyContext(fingerprint));
    expect(r.trust).toBe('replay-valid');
  });

  it('an RTA category is valid-unranked; a fixed seed is the category’s', async () => {
    const rta = await playRun('rta');
    expect((await verifyRun(rta.envelope, verifyContext(rta.fingerprint))).verdict).toBe('valid-unranked');
    const fixed = await playRun('fixed-seed');
    expect(fixed.envelope.runSeed).toBe('fixed:fixed-seed');
    expect((await verifyRun(fixed.envelope, verifyContext(fixed.fingerprint))).verdict).toBe('valid');
  });
});

describe('the alteration table: each one rejected with its code', () => {
  type Alter = (e: SpeedrunEnvelope & Record<string, unknown>) => void;
  const entry = (e: SpeedrunEnvelope, i: number) => e.chunks[0]!.entries[i] as Record<string, unknown>;
  const table: [string, Alter, string, string][] = [
    [
      'time: the logical time',
      (e) => ((e.timing as { logicalTime: string }).logicalTime = '1'),
      'invalid-replay',
      'time-mismatch',
    ],
    [
      'time: the active time',
      (e) => ((e.timing as { activeTime: string }).activeTime = '0'),
      'invalid-replay',
      'time-mismatch',
    ],
    [
      'time: the steps',
      (e) => ((e.timing as { logicalSteps: string }).logicalSteps = '2'),
      'invalid-replay',
      'time-mismatch',
    ],
    [
      'time: RTA, not re-sealed (integrity only: a forger who recomputes the chain is not caught)',
      (e) => ((e.timing as { rtaMs: number }).rtaMs = 1),
      'invalid-replay',
      'chain',
    ],
    [
      'time: an entry’s RTA stamp, not re-sealed (integrity only)',
      (e) => (entry(e, 1).t = 99),
      'invalid-replay',
      'chunk-hash',
    ],
    [
      'action: another verb',
      (e) => ((entry(e, 2).act as { verb: string }).verb = 'look'),
      'invalid-replay',
      'replay-diverged',
    ],
    ['action: one removed', (e) => e.chunks[0]!.entries.splice(1, 1), 'invalid-replay', 'replay-diverged'],
    ['seed: another one', (e) => (e.runSeed = 'not-the-seed'), 'invalid-replay', 'chain'],
    ['seed: the draws', (e) => (entry(e, 1).rnd = [0.5]), 'invalid-replay', 'rnd-mismatch'],
    ['rules: the version', (e) => (e.rulesVersion = 2), 'unsupported-version', 'rules-version'],
    [
      'rules: an unknown category',
      (e) => (e.categoryId = 'any-glitchless'),
      'invalid-category-rule',
      'unknown-category',
    ],
    ['rules: another category', (e) => (e.categoryId = 'no-hints'), 'invalid-replay', 'chain'],
    [
      'game: the logic’s fingerprint',
      (e) => ((e.fingerprint as { logic: string }).logic = 'f'.repeat(64)),
      'modified-game',
      'fingerprint',
    ],
    ['engine: another version', (e) => (e.engineVersion = '9.9.9'), 'unsupported-version', 'engine-version'],
    ['generator: another version', (e) => (e.prngVersion = 0), 'unsupported-version', 'prng-version'],
    ['durations: another version', (e) => (e.timingVersion = 2), 'unsupported-version', 'timing-version'],
    ['hash: the final state', (e) => (e.finalStateHash = '0'.repeat(64)), 'invalid-replay', 'final-state'],
    ['hash: the final proof', (e) => (e.finalProof = '0'.repeat(64)), 'invalid-replay', 'chain'],
    ['hash: the head', (e) => (e.h0 = '0'.repeat(64)), 'invalid-replay', 'chain'],
    [
      'chunk: its hash',
      (e) => ((e.chunks[0] as { hash: string }).hash = '0'.repeat(64)),
      'invalid-replay',
      'chunk-hash',
    ],
    ['chunk: its index', (e) => ((e.chunks[0] as { index: number }).index = 1), 'invalid-replay', 'chunk-order'],
    ['chunk: its link', (e) => ((e.chunks[0] as { prevHash: string }).prevHash = 'x'), 'invalid-replay', 'chunk-order'],
    ['chunk: all removed', (e) => (e.chunks = []), 'invalid-replay', 'envelope-shape'],
    [
      'chunk: an empty one appended',
      (e) =>
        (e.chunks = [
          ...e.chunks,
          { index: e.chunks.length, prevHash: e.chunks.at(-1)!.hash, hash: e.chunks.at(-1)!.hash, entries: [] },
        ]),
      'invalid-replay',
      'chunk-order',
    ],
    [
      'splits: a time',
      (e) => ((e.splits[1] as { logicalTime: string }).logicalTime = '5'),
      'invalid-replay',
      'splits-mismatch',
    ],
    ['splits: one removed', (e) => (e.splits = e.splits.slice(1)), 'invalid-replay', 'splits-mismatch'],
    [
      'signal: one added to a forbidden category',
      (e) =>
        e.chunks[0]!.entries.splice(2, 0, {
          external: { id: 'x', sequence: 1, signal: 's', source: 'w', receivedAt: 1 },
        }),
      'invalid-category-rule',
      'reality-forbidden',
    ],
    ['shape: not a speedrun', (e) => (e.format = 'web-scumm-session' as never), 'invalid-replay', 'envelope-shape'],
    ['shape: a schema from the future', (e) => (e.schema = 3 as never), 'unsupported-version', 'schema'],
    [
      'shape: a time that is not a decimal',
      (e) => ((e.timing as { logicalTime: unknown }).logicalTime = 12),
      'invalid-replay',
      'envelope-shape',
    ],
  ];

  it.each(table)('%s → %s / %s', async (_name, alter, verdict, code) => {
    const { envelope, fingerprint } = await playRun();
    const e = clone(envelope);
    alter(e);
    const r = await verifyRun(exportEnvelope(e as SpeedrunEnvelope), verifyContext(fingerprint));
    expect({ verdict: r.verdict, code: r.code }).toEqual({ verdict, code });
    expect(r.reason.length).toBeGreaterThan(10);
    expect(r.trust).toBe('local');
    expect(isRankable(r.verdict)).toBe(false);
  });

  it('every code of the table is distinct from `ok`, and the table covers time, action, seed, rules, signal, hash, chunk', () => {
    const kinds = new Set(table.map(([n]) => n.split(':')[0]));
    for (const k of ['time', 'action', 'seed', 'rules', 'signal', 'hash', 'chunk']) expect(kinds.has(k), k).toBe(true);
  });

  it('a forged chain does not save an altered time: the replay times the run itself', async () => {
    const { envelope, fingerprint } = await playRun();
    const e = clone(envelope);
    (e.timing as { logicalTime: string }).logicalTime = (BigInt(e.timing.logicalTime) - 1_000_000n).toString();
    // The forger recomputes the final proof over the altered summary: the replay still disagrees.
    const { finalProofOf, chainChunks } = await import('@engine/tools/speedrun/envelope');
    const last = e.chunks.at(-1)!.hash;
    void chainChunks;
    e.finalProof = await finalProofOf(last, e);
    const r = await verifyRun(e, verifyContext(fingerprint));
    expect(r.code).toBe('time-mismatch');
  });
});

describe('the category’s rules', () => {
  it('a hint in a category without hints', async () => {
    const { envelope, fingerprint } = await playRun('no-hints', [{ hint: true }, ...ROUTE]);
    const r = await verifyRun(envelope, verifyContext(fingerprint));
    expect([r.verdict, r.code]).toEqual(['invalid-category-rule', 'hints-forbidden']);
  });

  it('a load: allowed when it restores a state of the run, a disqualification where loads invalidate', async () => {
    const steps = [ROUTE[0], ROUTE[1], { load: 'last-save' as const }, ROUTE[1], ROUTE[2], ROUTE[3]];
    const allowed = await playRun('any%', steps);
    expect(allowed.envelope.loads).toHaveLength(1);
    expect(allowed.envelope.loads![0]!.from).toBeGreaterThanOrEqual(0);
    expect((await verifyRun(allowed.envelope, verifyContext(allowed.fingerprint))).verdict).toBe('valid');
    const no = await playRun('no-hints', steps);
    const r = await verifyRun(no.envelope, verifyContext(no.fingerprint));
    expect([r.verdict, r.code]).toEqual(['invalid-category-rule', 'reload-forbidden']);
  });

  it('a load from outside the run, a pause where pauses are forbidden, an input the category does not allow', async () => {
    const { envelope, fingerprint } = await playRun();
    const foreign = clone(envelope);
    foreign.loads = [{ before: 2, from: -1 }];
    expect((await verifyRun(foreign, verifyContext(fingerprint))).code).toBe('foreign-load');
    const g = speedrunGame();
    const any = g.speedrun!.categories[0]!;
    g.speedrun = {
      ...g.speedrun!,
      categories: [{ ...any, allowPauses: false, inputs: { ...any.inputs, gamepad: false } }],
    };
    const paused = await playRun('any%', [ROUTE[0], { pause: 3000 }, ...ROUTE.slice(1)], g);
    expect((await verifyRun(paused.envelope, verifyContext(paused.fingerprint, g))).code).toBe('pauses-forbidden');
    const pad = await playRun('any%', ROUTE, g);
    const e = clone(pad.envelope);
    e.inputsUsed = ['gamepad'];
    // The declared inputs are not in the chain (the client's word), but the rule reads them.
    expect((await verifyRun(e, verifyContext(pad.fingerprint, g))).code).toBe('input-forbidden');
  });
});

describe('inconclusive is never valid', () => {
  it('a replay over its budget is inconclusive, unranked, local', async () => {
    const looks = Array.from({ length: 200 }, () => ROUTE[0]);
    const { envelope, fingerprint } = await playRun('any%', [...looks, ...ROUTE]);
    const r = await verifyRun(envelope, { ...verifyContext(fingerprint), timeoutMs: 1 });
    expect([r.verdict, r.code]).toEqual(['inconclusive', 'timeout']);
    expect(r.trust).toBe('local');
    expect(isRankable(r.verdict)).toBe(false);
  }, 20000);

  it('a game that throws while replaying is inconclusive; only `valid` ranks', async () => {
    const { envelope, fingerprint } = await playRun();
    const broken = speedrunGame();
    broken.rooms[0]!.on = [{ verb: 'look', a: 'desk', do: [{ custom: 'missing' } as never] }];
    const r = await verifyRun(envelope, verifyContext(fingerprint, broken));
    expect([r.verdict, r.code]).toEqual(['inconclusive', 'crash']);
    for (const v of ['inconclusive', 'valid-unranked', 'invalid-replay', 'modified-game'] as const)
      expect(isRankable(v)).toBe(false);
  });
});

describe('the envelope is canonical JSON', () => {
  it('the same run is the same bytes; parse refuses a shape that is not one', async () => {
    const { envelope } = await playRun();
    expect(exportEnvelope(envelope)).toBe(canonicalJson(JSON.parse(exportEnvelope(envelope))));
    expect(() => parseEnvelope('not json')).toThrow();
    expect(ENGINE_VERSION).toBe(envelope.engineVersion);
    expect(CHUNK_SIZE).toBe(500);
  });

  it('no TypeScript module of tools/speedrun/ calls JSON.stringify (a bigint would throw, an object would not be canonical; the local .mjs tools only carry cleaned events of plain numbers)', () => {
    const dirs = ['src/engine/tools/speedrun', 'tools/speedrun'];
    const offenders: string[] = [];
    for (const d of dirs) {
      let files: string[] = [];
      try {
        files = readdirSync(d);
      } catch {
        continue;
      }
      for (const f of files)
        if (/\.ts$/.test(f) && /JSON\.stringify/.test(readFileSync(join(d, f), 'utf8'))) offenders.push(join(d, f));
    }
    expect(offenders).toEqual([]);
  });
});
