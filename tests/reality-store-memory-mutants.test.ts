// The memory store and the open streams, judged under mutation (4.1.18, `reality-store`): each test pins one decision a
// surviving mutant changed: a tenant or a player kept apart, a key or a quarantined row kept once, a wake-up reaching
// every watcher, a stream sending in order, once each, from its cursor, and reading no more than it needs.
import { describe, expect, it } from 'vitest';
import type { WorldSignal } from '@engine/reality/protocol';
import { type BridgeStore, MemoryBridgeStore, type Player } from '../bridge/src/store';
import type { QuarantineRow, TenantExport } from '../bridge/src/store-async';
import { fromBridgeStore, MemoryRealityStore } from '../bridge/src/store-memory';
import { type Stream, type StreamSource, Streams } from '../bridge/src/streams';

const player = (playerId: string): Player => ({
  playerId,
  gameId: 'g',
  capabilityHash: `h-${playerId}`,
  capabilityExpiresAt: 1e12,
});
const pairing = (code: string, expiresAt = 1000) => ({ code, gameId: 'g', expiresAt });
const q = (tenantId: string, playerId: string, sequence: number): QuarantineRow => ({
  tenantId,
  playerId,
  sequence,
  reason: 'jws',
  at: 1,
});
const exported = (tenantId: string, ...ids: string[]): TenantExport => ({
  tenantId,
  players: ids.map(player),
  signals: [],
  acks: [],
  revokedTokens: [],
  keys: [],
  quarantine: [],
});
const propose = (tenantId: string, playerId: string, dedupeKey: string) => ({
  tenantId,
  playerId,
  dedupeKey,
  sign: ({ sequence }: { sequence: number }) => ({
    id: `s${sequence}`,
    jws: `jws${sequence}`,
    kid: 'k',
    payload: {} as WorldSignal,
    at: 1,
  }),
});

describe('the memory store', () => {
  it('a pairing code expiring right now is still pending, not swept', async () => {
    const s = new MemoryRealityStore();
    await s.putPairing('t1', pairing('AAA', 100));
    await s.sweepPairings('t1', 100);
    expect(await s.pairing('t1', 'AAA')).toBeDefined();
    await s.sweepPairings('t1', 101);
    expect(await s.pairing('t1', 'AAA')).toBeUndefined();
  });

  it('a confirmed code whose player is gone is missing, and nothing is written', async () => {
    const inner = new MemoryBridgeStore();
    const s = fromBridgeStore(inner);
    await s.putPairing('default', pairing('AAA'));
    expect(await s.confirmPairing('default', 'AAA', player('A'))).toBe(true);
    inner.write({ t: 'forget', playerId: 'A' });
    expect(await s.claimPairing('default', 'AAA', 'cap')).toBe('missing');
    expect(inner.allPlayers()).toEqual([]);
  });

  it("forgetting a player drops its codes and its quarantined rows, no one else's", async () => {
    const s = new MemoryRealityStore();
    for (const code of ['AAA', 'BBB', 'CCC']) await s.putPairing('t1', pairing(code));
    await s.confirmPairing('t1', 'AAA', player('A'));
    await s.confirmPairing('t1', 'BBB', player('B'));
    for (const r of [q('t1', 'A', 1), q('t1', 'B', 1), q('t2', 'A', 1)]) await s.quarantine(r);
    await s.forgetPlayer('t1', 'A');
    expect(await s.pairing('t1', 'AAA')).toBeUndefined();
    expect((await s.pairing('t1', 'BBB'))?.playerId).toBe('B');
    expect(await s.pairing('t1', 'CCC')).toBeDefined();
    expect((await s.quarantined()).map((r) => `${r.tenantId}/${r.playerId}`)).toEqual(['t1/B', 't2/A']);
  });

  it('every key rotated is kept, with its retirement date only when it has one', async () => {
    const s = new MemoryRealityStore();
    await s.rotateKeys({ tenantId: 't1', keyId: 'k1', publicKey: 'p1', retireAfter: '2026-12-01' });
    await s.rotateKeys({ tenantId: 't1', keyId: 'k2', publicKey: 'p2' });
    const keys = await s.keys('t1');
    expect(keys).toStrictEqual([
      { tenantId: 't1', keyId: 'k1', publicKey: 'p1', retireAfter: '2026-12-01' },
      { tenantId: 't1', keyId: 'k2', publicKey: 'p2' },
    ]);
    expect('retireAfter' in (keys[1] as object)).toBe(false);
  });

  it('a quarantined row is kept once; rows differing by tenant, player or sequence are each kept', async () => {
    const s = new MemoryRealityStore();
    for (const r of [q('t1', 'A', 1), q('t1', 'A', 1), q('t1', 'A', 2), q('t1', 'B', 1), q('t2', 'A', 1)])
      await s.quarantine(r);
    expect((await s.quarantined()).map((r) => `${r.tenantId}/${r.playerId}/${r.sequence}`)).toEqual([
      't1/A/1',
      't1/A/2',
      't1/B/1',
      't2/A/1',
    ]);
    expect(await s.quarantined('t2')).toHaveLength(1);
  });

  it('an export lists the acknowledgements made, not the players who never acknowledged', async () => {
    const s = new MemoryRealityStore();
    await s.putPlayer('t1', player('A'));
    await s.putPlayer('t1', player('B'));
    await s.acknowledge({ tenantId: 't1', playerId: 'B', sequence: 3 });
    expect((await s.exportTenant('t1')).acks).toEqual([{ playerId: 'B', through: 3 }]);
  });

  it('an export over a store that cannot list its players lists none, and does not throw', async () => {
    const m = new MemoryBridgeStore();
    // A `BridgeStore` that is not a `MemoryBridgeStore`: the interface has no `allPlayers`.
    const bare: BridgeStore = {
      pairing: (c) => m.pairing(c),
      player: (p) => m.player(p),
      playerByCapability: (h) => m.playerByCapability(h),
      signals: (p, a) => m.signals(p, a),
      bySequenceKey: (p, k) => m.bySequenceKey(p, k),
      lastSequence: (p) => m.lastSequence(p),
      acked: (p) => m.acked(p),
      tokenRevoked: (i) => m.tokenRevoked(i),
      revokedTokens: () => m.revokedTokens(),
      write: (e) => m.write(e),
    };
    m.write({ t: 'player', p: player('A') });
    const x = await fromBridgeStore(bare).exportTenant('default');
    expect(x.players).toEqual([]);
  });

  it('an import adds to the tenant; with `replace` it takes its place', async () => {
    const s = new MemoryRealityStore();
    await s.importTenant(exported('t1', 'A'));
    await s.importTenant(exported('t1', 'B'));
    expect((await s.player('t1', 'A'))?.playerId).toBe('A');
    expect((await s.player('t1', 'B'))?.playerId).toBe('B');
    await s.importTenant(exported('t1', 'C'), { replace: true });
    expect(await s.player('t1', 'A')).toBeUndefined();
    expect((await s.player('t1', 'C'))?.playerId).toBe('C');
  });

  it('every watcher of a tenant is woken by an accepted signal', async () => {
    const s = new MemoryRealityStore();
    const woken: string[] = [];
    s.watch('t1', (p) => woken.push(`1:${p}`));
    s.watch('t1', (p) => woken.push(`2:${p}`));
    await s.appendSignal(propose('t1', 'A', 'd1'));
    expect(woken).toEqual(['1:A', '2:A']);
  });

  it('a tenant holding only a player, or only a revoked token, is a tenant', async () => {
    const s = new MemoryRealityStore();
    await s.putPlayer('t1', player('A'));
    await s.revokeToken('t2', 'r1');
    await s.keys('t3');
    expect((await s.tenants()).sort()).toEqual(['t1', 't2']);
  });
});

/** A source over a fixed journal; it counts its reads and how many run at once. */
const source = (seqs: number[], o: { ends?: 'revoked'; raw?: boolean } = {}) => {
  const c = { pages: 0, ends: 0, busy: 0, most: 0 };
  const src: StreamSource = {
    async page(_p, after, limit) {
      c.pages++;
      c.most = Math.max(c.most, ++c.busy);
      await new Promise((r) => setTimeout(r, 1));
      c.busy--;
      const rows = (o.raw ? seqs : seqs.filter((n) => n > after)).slice(0, limit);
      return rows.map((n) => ({ sequence: n, jws: `j${n}` }));
    },
    async ends() {
      c.ends++;
      return o.ends;
    },
  };
  return { c, src };
};
const stream = (playerId: string, cursor = 0) => {
  const sent: number[] = [];
  const closed: string[] = [];
  const s: Stream = { playerId, cursor, on: (n) => sent.push(n), close: (w) => closed.push(w) };
  return { s, sent, closed };
};

describe('the open streams', () => {
  it("count and endAll touch one player's streams only; a stream is closed once", () => {
    const st = new Streams(source([]).src, () => 10);
    const a = stream('A');
    const b = stream('B');
    st.add(a.s);
    st.add(b.s);
    expect(st.count('A')).toBe(1);
    st.endAll('A', 'revoked');
    expect(st.count('B')).toBe(1);
    expect(b.closed).toEqual([]);
    st.end(a.s, 'expired');
    expect(a.closed).toEqual(['revoked']);
  });

  it('a wake-up during a read joins it: one read at a time, every signal once, in order', async () => {
    const { c, src } = source([1, 2, 3]);
    const st = new Streams(src, () => 10);
    const a = stream('A');
    st.add(a.s);
    const first = st.read(a.s);
    const second = st.read(a.s);
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(c.most).toBe(1);
    expect(a.sent).toEqual([1, 2, 3]);
  });

  it('a stream no longer open is not read', async () => {
    const { c, src } = source([1]);
    const st = new Streams(src, () => 10);
    const a = stream('A');
    st.add(a.s)();
    await st.read(a.s);
    expect(c.pages).toBe(0);
    expect(a.sent).toEqual([]);
  });

  it('nothing new costs one read: the link is not checked and a short page is the last', async () => {
    const empty = source([], { ends: 'revoked' });
    const st = new Streams(empty.src, () => 10);
    const a = stream('A');
    st.add(a.s);
    await st.read(a.s);
    expect(empty.c).toMatchObject({ pages: 1, ends: 0 });
    expect(a.closed).toEqual([]);
    const short = source([1, 2]);
    const b = stream('B');
    const st2 = new Streams(short.src, () => 10);
    st2.add(b.s);
    await st2.read(b.s);
    expect(b.sent).toEqual([1, 2]);
    expect(short.c.pages).toBe(1);
  });

  it('a stream ended while it sends stops at once', async () => {
    const { src } = source([1, 2, 3]);
    const st = new Streams(src, () => 10);
    const sent: number[] = [];
    const s: Stream = {
      playerId: 'A',
      cursor: 0,
      on: (n) => {
        sent.push(n);
        st.end(s, 'revoked');
      },
      close: () => {},
    };
    st.add(s);
    await st.read(s);
    expect(sent).toEqual([1]);
  });

  it('rows at or before the cursor are never sent again', async () => {
    const { src } = source([1, 2, 3], { raw: true });
    const st = new Streams(src, () => 10);
    const a = stream('A', 2);
    st.add(a.s);
    await st.read(a.s);
    expect(a.sent).toEqual([3]);
  });

  it('a full page is followed by the next one, until a short page', async () => {
    const { c, src } = source([1, 2, 3, 4, 5]);
    const st = new Streams(src, () => 2);
    const a = stream('A');
    st.add(a.s);
    await st.read(a.s);
    expect(a.sent).toEqual([1, 2, 3, 4, 5]);
    expect(c.pages).toBe(3);
  });
});
