// The signed signal (4.1.1, src/engine/reality/protocol.ts): every case of the conformance corpus
// (tests/fixtures/reality/conformance.json, the same file the Rust cross-check reads) gives its verdict, and nothing
// is decoded before its signature is checked.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importBridgeKey, verifySignal, type Keyring } from '@engine/reality/protocol';
import { manifestHash, realityManifest } from '@engine/reality/manifest';
import type { GameDef } from '@engine/core/types';

const corpus = JSON.parse(readFileSync('tests/fixtures/reality/conformance.json', 'utf8')) as {
  keys: { kid: string; raw: string; notBefore?: number; notAfter?: number }[];
  expect: { gameId: string; playerId: string; signals: string[]; now: number };
  cases: { name: string; jws: string; verdict: string; expect?: { now?: number } }[];
};
const keyring = async (): Promise<Keyring> =>
  Promise.all(corpus.keys.map(({ kid, raw, ...w }) => importBridgeKey(kid, raw, w)));

describe('the signed signal', () => {
  it.each(corpus.cases.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    const r = await verifySignal(c.jws, await keyring(), {
      ...corpus.expect,
      signals: new Set(corpus.expect.signals),
      ...c.expect,
    });
    expect(r.ok ? 'ok' : r.code).toBe(c.verdict);
  });

  it('the corpus covers every refusal code', () => {
    const codes = new Set(corpus.cases.map((c) => c.verdict));
    for (const c of [
      'size',
      'shape',
      'header',
      'algorithm',
      'key',
      'key-window',
      'signature',
      'payload',
      'schema',
      'game',
      'player',
      'signal',
      'expired',
    ])
      expect(codes.has(c), c).toBe(true);
  });

  it('refuses what is not a string, without throwing', async () => {
    for (const v of [null, 42, {}, ['a.b.c']]) {
      const r = await verifySignal(v, await keyring(), { ...corpus.expect, signals: new Set() });
      expect(r).toMatchObject({ ok: false, code: 'shape' });
    }
  });
});

describe('the manifest', () => {
  const game = {
    id: 'signals',
    reality: {
      signals: [
        { id: 'mail.answer.wrong', source: 'mail', availability: 'optional', replay: 'record' },
        {
          id: 'mail.answer.correct',
          source: 'mail',
          availability: 'required',
          replay: 'record',
          fallback: { verb: 'use', a: 'radio' },
        },
      ],
    },
  } as unknown as GameDef;

  it('lists the declared signals, sorted, without the game-side details', () => {
    expect(realityManifest(game)).toEqual({
      format: 'web-scumm-reality-manifest',
      schema: 1,
      gameId: 'signals',
      signals: [
        { id: 'mail.answer.correct', source: 'mail', availability: 'required', replay: 'record' },
        { id: 'mail.answer.wrong', source: 'mail', availability: 'optional', replay: 'record' },
      ],
    });
    expect(realityManifest({ id: 'demo' } as GameDef)).toBeNull();
  });

  it('has a hash that changes when a signal is renamed', async () => {
    const m = realityManifest(game)!;
    const h = await manifestHash(m);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(await manifestHash(realityManifest(game)!)).toBe(h);
    const renamed = { ...m, signals: m.signals.map((s, i) => (i ? s : { ...s, id: 'mail.answer.right' })) };
    expect(await manifestHash(renamed)).not.toBe(h);
  });
});
