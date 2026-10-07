// The formats 4.1.7 writes and reads, frozen before 4.1.8 changes the toolchain (programme rule: capture the
// artefact formats before migrating): a session file, a save envelope, a signed world signal, a solver report. Each
// fixture is parsed by the code that reads it in production (the session by `parseSessionFile`, the save by its zod
// schema, the signal by `verifySignal`; the solver report has no reader beyond a cast, so its keys are listed), so a
// change of format is a change of this test, said in the CHANGELOG. Regenerate `session.json` and `solve.json` from the `signals` fixture
// game (an Engine with one received signal, `sessionFile()`; `solve(…, { mode: 'prove' })`) when a format moves on
// purpose; `demo-4.1.7.json` is the golden save of `tools/golden-save.ts`; the signal is `conformance.json`'s first.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SaveEnvelopeV3Schema } from '@engine/core/save';
import { importBridgeKey, verifySignal, WorldSignalV1Schema } from '@engine/reality/protocol';
import { parseSessionFile, replay } from '@engine/tools/replay';
import type { SolveResult } from '@engine/tools/solve';
import { signals, signalsLayouts } from './fixtures/signals';

const read = (f: string) => readFileSync(`tests/fixtures/${f}`, 'utf8');

describe('the formats of 4.1.7, frozen', () => {
  it('a session file: kind, game, v, at, session {v, start, base, log}, trace; it replays to its digest', async () => {
    const sf = parseSessionFile(read('formats/session.json'));
    expect(Object.keys(JSON.parse(read('formats/session.json'))).sort()).toEqual(
      ['at', 'game', 'kind', 'session', 'trace', 'v'].sort(),
    );
    expect(sf.kind).toBe('web-scumm-session');
    expect(sf.game).toBe('signals');
    expect(Object.keys(sf.session).sort()).toEqual(['base', 'log', 'start', 'v'].sort());
    expect(sf.session.start).toEqual({ kind: 'new' });
    // One received signal: an `external` entry with its id and sequence, and the digest of the state after it.
    const ext = sf.session.log.find((l) => 'external' in l);
    expect(ext).toMatchObject({ external: { id: 'sig-0001', sequence: 1, signal: 'mail.answer.correct' } });
    expect(ext?.digest).toMatch(/^[0-9a-f]{8}$/);
    const r = await replay(signals(), signalsLayouts, sf.session);
    expect(r.divergedAt).toBeUndefined();
    expect(r.state.flags.vault_open).toBe(true);
  });

  it('a save envelope: format, schema 3, gameId, gameSaveVersion, savedAt, state', () => {
    const golden = JSON.parse(read('saves/demo-4.1.7.json')) as { engine: string; envelope: unknown };
    expect(golden.engine).toBe('4.1.7');
    expect(Object.keys(golden.envelope as object).sort()).toEqual(
      ['format', 'gameId', 'gameSaveVersion', 'savedAt', 'schema', 'state'].sort(),
    );
    const env = golden.envelope as { format: string; schema: number };
    expect(env.format).toBe('web-scumm-save');
    expect(env.schema).toBe(3);
    expect(SaveEnvelopeV3Schema.safeParse(golden.envelope).success).toBe(true);
  });

  it('a world signal: a compact EdDSA JWS whose payload is WorldSignalV1 (format, schema 1, id, sequence, …)', async () => {
    const vectors = JSON.parse(read('reality/conformance.json')) as {
      keys: { kid: string; raw: string }[];
      cases: { name: string; jws: string; verdict: string }[];
    };
    const first = vectors.cases.find((c) => c.verdict === 'ok')!;
    const [h, p] = first.jws.split('.');
    const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    expect(JSON.parse(b64(h!))).toEqual({ alg: 'EdDSA', kid: 'k1' });
    const payload = WorldSignalV1Schema.parse(JSON.parse(b64(p!)));
    expect(Object.keys(payload).sort()).toEqual(
      [
        'dedupeKey',
        'format',
        'gameId',
        'id',
        'playerId',
        'policyVersion',
        'receivedAt',
        'schema',
        'sequence',
        'signal',
        'source',
      ].sort(),
    );
    const keyring = await Promise.all(vectors.keys.map((k) => importBridgeKey(k.kid, k.raw)));
    const v = await verifySignal(first.jws, keyring, {
      gameId: payload.gameId,
      playerId: payload.playerId,
      signals: new Set([payload.signal]),
      now: payload.receivedAt,
    });
    expect(v.ok).toBe(true);
  });

  it('a solver report: status, exit, headline, mode, finished, path, steps, states, truncated, softlocks, …', () => {
    const r = JSON.parse(read('formats/solve.json')) as SolveResult;
    expect(Object.keys(r).sort()).toEqual(
      [
        'assumptions',
        'boundaries',
        'broken',
        'deadEnds',
        'errors',
        'exit',
        'finished',
        'flagsReached',
        'headline',
        'itemsNeverUsed',
        'liveFlags',
        'mode',
        'path',
        'profile',
        'reality',
        'roomsReached',
        'softlockCauses',
        'softlockCount',
        'softlocks',
        'states',
        'status',
        'steps',
        'truncated',
        'unlockedReached',
        'unusedItems',
      ].sort(),
    );
    expect(r).toMatchObject({
      status: 'solved',
      exit: 0,
      mode: 'prove',
      finished: true,
      truncated: false,
      softlockCount: 0,
    });
    expect(r.steps[0]).toMatchObject({ start: 'new' });
  });
});
