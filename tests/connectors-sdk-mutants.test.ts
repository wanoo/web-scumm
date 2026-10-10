// The connector SDK's edges (connectors/src/sdk.ts), each test written for a mutant of the connectors set that the
// other connector tests let live (tools/mutate.ts; docs/dev/MUTANTS.md): a payload that is not an object or exactly
// at its size, the instant the local quota's minute ends, every Bridge status and code mapped to the SDK's refusals,
// the shapes refused before the Bridge, `occurredAt`, a 5xx retried, a timeout told from a lost connection, pairing.
import { describe, expect, it } from 'vitest';
import { createContext, payloadProblem } from '../connectors/src/sdk';
import type { RealityManifest } from '../src/engine/reality/manifest';

const MANIFEST = {
  signals: [{ id: 'sig', source: 'email', availability: 'optional', replay: 'record' }],
} as unknown as RealityManifest;

type Answer = { status: number; body?: unknown } | Error;

/** A context whose Bridge is a script of answers: the calls it got (path, body) and the log lines it wrote. */
function scripted(answers: Answer[], o: { retries?: number; now?: () => number; maxPerMinute?: number } = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const lines: Record<string, unknown>[] = [];
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)) });
    const a = answers.shift() ?? { status: 200, body: { sequence: 1 } };
    if (a instanceof Error) throw a;
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status });
  }) as typeof globalThis.fetch;
  const ctx = createContext({
    bridge: { url: 'http://127.0.0.1:1/', token: 't' },
    gameId: 'g',
    manifest: MANIFEST,
    connector: 'email',
    write: (l) => lines.push(JSON.parse(l)),
    fetch,
    retries: o.retries ?? 0,
    ...(o.now ? { now: o.now } : {}),
    ...(o.maxPerMinute ? { limits: { maxPerMinute: o.maxPerMinute } } : {}),
  });
  return { ctx, calls, lines };
}

const signal = (over: Partial<{ kind: string; playerId: string; dedupeKey: string; receivedAt: string }> = {}) => ({
  source: 'email',
  kind: 'sig',
  playerId: 'p1',
  dedupeKey: 'k1',
  payload: { a: 1 },
  receivedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

const timeoutError = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });

describe('payloadProblem', () => {
  it('a string or an array is a shape, not a payload', () => {
    expect(payloadProblem('abc', 100)).toBe('shape');
    expect(payloadProblem([1], 100)).toBe('shape');
  });
  it('a payload of exactly maxBytes passes', () => {
    expect(payloadProblem({}, 2)).toBeNull();
    expect(payloadProblem({}, 1)).toBe('too-large');
  });
});

describe('propose', () => {
  it('the local quota frees its slot exactly one minute later', async () => {
    let t = 0;
    const { ctx } = scripted([], { now: () => t, maxPerMinute: 1 });
    expect((await ctx.propose(signal({ dedupeKey: 'a' }))).ok).toBe(true);
    t = 59_999;
    expect(await ctx.propose(signal({ dedupeKey: 'b' }))).toEqual({ ok: false, refusal: 'quota' });
    t = 60_000;
    expect((await ctx.propose(signal({ dedupeKey: 'c' }))).ok).toBe(true);
  });

  it.each([
    [413, undefined, 'too-large'],
    [422, undefined, 'not-declared'],
    [404, 'pairing', 'pairing'],
    [404, 'unknown-player', 'player'],
    [409, undefined, 'pairing'],
    [410, undefined, 'pairing'],
    [401, 'revoked', 'revoked'],
    [401, 'bad-token', 'denied'],
    [403, undefined, 'denied'],
    [429, 'pending', 'pending'],
    [429, 'quota', 'bridge-quota'],
    [400, undefined, 'shape'],
    [418, undefined, 'bridge'],
  ])('a Bridge %i (%s) is refused as %s, never retried', async (status, error, refusal) => {
    const { ctx, calls } = scripted([{ status, body: error ? { error } : {} }], { retries: 2 });
    expect(await ctx.propose(signal())).toEqual({ ok: false, refusal });
    expect(calls).toHaveLength(1);
    expect(ctx.metrics().retries).toBe(0);
  });

  it('a non-string error is no code', async () => {
    const { ctx } = scripted([{ status: 404, body: { error: ['pairing'] } }]);
    expect(await ctx.propose(signal())).toEqual({ ok: false, refusal: 'player' });
  });

  it('a refusal logs the kind only when it is an identifier', async () => {
    const { ctx, lines } = scripted([{ status: 403 }]);
    await ctx.propose(signal({ kind: 'bad kind' }));
    expect(lines.at(-1)).toEqual({ event: 'signal.refused', connector: 'email', code: 'shape' });
    await ctx.propose(signal());
    expect(lines.at(-1)).toEqual({ event: 'signal.refused', connector: 'email', code: 'denied', kind: 'sig' });
  });

  it.each([
    ['a player id that is not an identifier', { playerId: 'p 1' }],
    ['an empty dedupe key', { dedupeKey: '' }],
    ['a dedupe key over 256 characters', { dedupeKey: 'k'.repeat(257) }],
  ])('%s is a shape, before the Bridge', async (_, over) => {
    const { ctx, calls } = scripted([]);
    expect(await ctx.propose(signal(over))).toEqual({ ok: false, refusal: 'shape' });
    expect(calls).toHaveLength(0);
  });

  it('occurredAt is the connector time when it is a time at or after the epoch', async () => {
    const { ctx, calls } = scripted([]);
    await ctx.propose(signal({ receivedAt: '2026-10-10T00:00:00.500Z' }));
    await ctx.propose(signal({ receivedAt: '1970-01-01T00:00:00.000Z' }));
    await ctx.propose(signal({ receivedAt: '1969-12-31T23:59:59.000Z' }));
    await ctx.propose(signal({ receivedAt: 'not a time' }));
    expect(calls.map((c) => c.body.occurredAt)).toEqual([
      Date.parse('2026-10-10T00:00:00Z') + 500,
      0,
      undefined,
      undefined,
    ]);
    expect(calls.map((c) => 'occurredAt' in c.body)).toEqual([true, true, false, false]);
  });

  it('with no try at all, nothing is sent', async () => {
    const { ctx, calls } = scripted([], { retries: -1 });
    expect(await ctx.propose(signal())).toEqual({ ok: false, refusal: 'bridge' });
    expect(calls).toHaveLength(0);
  });

  it('an accepted signal is counted and logged as accepted, a duplicate as a duplicate', async () => {
    const { ctx, lines } = scripted([
      { status: 200, body: { sequence: 7 } },
      { status: 200, body: { sequence: 7, duplicate: true } },
    ]);
    expect(await ctx.propose(signal())).toEqual({ ok: true, sequence: 7, duplicate: false });
    expect(ctx.metrics()).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(lines.at(-1)).toMatchObject({ event: 'signal.accepted', sequence: 7 });
    expect(await ctx.propose(signal())).toEqual({ ok: true, sequence: 7, duplicate: true });
    expect(ctx.metrics()).toMatchObject({ accepted: 1, duplicates: 1 });
    expect(lines.at(-1)).toMatchObject({ event: 'signal.duplicate', sequence: 7 });
  });

  it('a 500 is retried with the same body, and a 5xx on the last try is a bridge refusal', async () => {
    const { ctx, calls } = scripted([{ status: 500 }, { status: 202, body: { sequence: 3 } }], { retries: 1 });
    expect(await ctx.propose(signal())).toEqual({ ok: true, sequence: 3, duplicate: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual(calls[0].body);
    expect(ctx.metrics().retries).toBe(1);
    const last = scripted([{ status: 500 }, { status: 503, body: { error: 'pending' } }], { retries: 1 });
    expect(await last.ctx.propose(signal())).toEqual({ ok: false, refusal: 'bridge' });
  });

  it('a timeout is told from a lost connection', async () => {
    expect(await scripted([timeoutError()]).ctx.propose(signal())).toEqual({ ok: false, refusal: 'timeout' });
    expect(await scripted([new TypeError('fetch failed')]).ctx.propose(signal())).toEqual({
      ok: false,
      refusal: 'unreachable',
    });
  });
});

describe('pair', () => {
  it('a closed context confirms nothing', async () => {
    const { ctx, calls } = scripted([{ status: 200, body: { playerId: 'p1' } }]);
    ctx.close();
    expect(await ctx.pair('ABCD1234')).toEqual({ ok: false, refusal: 'stopped' });
    expect(calls).toHaveLength(0);
  });

  it('only a 200 with an identifier links a player', async () => {
    const ok = scripted([{ status: 200, body: { playerId: 'p1' } }]);
    expect(await ok.ctx.pair('ABCD1234')).toEqual({ ok: true, playerId: 'p1' });
    expect(ok.calls[0].path).toBe('/v1/pairings/ABCD1234/confirm');
    const notFound = scripted([{ status: 404, body: { playerId: 'p1', error: 'pairing' } }]);
    expect(await notFound.ctx.pair('ABCD1234')).toEqual({ ok: false, refusal: 'pairing' });
    const notString = scripted([{ status: 400, body: { playerId: 12345 } }]);
    expect(await notString.ctx.pair('ABCD1234')).toEqual({ ok: false, refusal: 'shape' });
    const notIdent = scripted([{ status: 200, body: { playerId: 'p 1' } }]);
    expect(await notIdent.ctx.pair('ABCD1234')).toEqual({ ok: false, refusal: 'bridge' });
  });

  it('the Bridge code reaches the refusal', async () => {
    expect(await scripted([{ status: 404, body: { error: 'pairing' } }]).ctx.pair('ABCD1234')).toEqual({
      ok: false,
      refusal: 'pairing',
    });
    expect(await scripted([{ status: 401, body: { error: 'revoked' } }]).ctx.pair('ABCD1234')).toEqual({
      ok: false,
      refusal: 'revoked',
    });
  });

  it('a timeout is told from a lost connection', async () => {
    expect(await scripted([timeoutError()]).ctx.pair('ABCD1234')).toEqual({ ok: false, refusal: 'timeout' });
    expect(await scripted([new TypeError('fetch failed')]).ctx.pair('ABCD1234')).toEqual({
      ok: false,
      refusal: 'unreachable',
    });
  });
});
