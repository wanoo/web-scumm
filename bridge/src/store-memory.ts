// `RealityStore` over the 4.1.9 synchronous stores (4.1.10, ADR 0009): `MemoryRealityStore` keeps one
// `MemoryBridgeStore` per tenant (the tests, a Bridge in one process); `fromBridgeStore` wraps a store the caller
// already holds (a `JsonlBridgeStore`, the journal of `npm run bridge`) for the single tenant `default` and refuses
// any other. Every section between a read and its write is synchronous, so in one process nothing interleaves; the
// pairing codes waiting and the keys stay in memory, as in 4.1.9 (a restart forgets an unclaimed code).
import {
  type AppendResult,
  type ClaimOutcome,
  checkTenant,
  DEFAULT_TENANT,
  type KeyRow,
  type ProposedSignalRow,
  type QuarantineRow,
  type RealityStore,
  type StoredSignal,
  type TenantExport,
} from './store-async';
import { type BridgeStore, type JournalEntry, MemoryBridgeStore, type Pairing, type Player } from './store';

const stored = (tenantId: string, e: JournalEntry): StoredSignal => ({ ...e, tenantId });

class SyncBackedStore implements RealityStore {
  readonly kind: 'memory' | 'jsonl';
  private pairings = new Map<string, Map<string, Pairing>>();
  private keyRows = new Map<string, Map<string, KeyRow>>();
  private quarantineRows: QuarantineRow[] = [];
  private watchers = new Map<string, Set<(playerId: string) => void>>();

  constructor(
    private of: (tenantId: string) => BridgeStore,
    private list: () => string[],
    kind: 'memory' | 'jsonl',
    private onDelete: (tenantId: string) => void,
  ) {
    this.kind = kind;
  }

  private t(tenantId: string): BridgeStore {
    return this.of(checkTenant(tenantId));
  }
  private codes(tenantId: string): Map<string, Pairing> {
    let m = this.pairings.get(tenantId);
    if (!m) this.pairings.set(tenantId, (m = new Map()));
    return m;
  }

  async ping(): Promise<void> {}
  async tenants(): Promise<string[]> {
    return this.list();
  }

  async pendingPairings(tenantId: string, now: number) {
    this.t(tenantId);
    let n = 0;
    for (const p of this.codes(tenantId).values()) if (p.expiresAt >= now) n++;
    return n;
  }
  async sweepPairings(tenantId: string, now: number) {
    this.t(tenantId);
    const m = this.codes(tenantId);
    for (const [code, p] of m) if (p.expiresAt < now) m.delete(code);
  }
  async putPairing(tenantId: string, p: Pairing) {
    this.t(tenantId);
    this.codes(tenantId).set(p.code, { ...p });
  }
  async pairing(tenantId: string, code: string) {
    this.t(tenantId);
    const p = this.codes(tenantId).get(code);
    return p ? { ...p } : undefined;
  }
  async confirmPairing(tenantId: string, code: string, player: Player) {
    const s = this.t(tenantId);
    const p = this.codes(tenantId).get(code);
    if (!p || p.playerId) return false;
    s.write({ t: 'player', p: player });
    // The trace of 4.1.1: the pairing with its player, never a capability.
    s.write({ t: 'pairing', p: { code: p.code, gameId: p.gameId, expiresAt: p.expiresAt, playerId: player.playerId } });
    this.codes(tenantId).set(code, { ...p, playerId: player.playerId });
    return true;
  }
  async claimPairing(tenantId: string, code: string, capabilityHash: string): Promise<ClaimOutcome> {
    const s = this.t(tenantId);
    const p = this.codes(tenantId).get(code);
    if (!p) return 'missing';
    if (!p.playerId) return 'pending';
    if (p.claimed) return 'already';
    const player = s.player(p.playerId);
    if (!player) return 'missing';
    s.write({ t: 'player', p: { ...player, capabilityHash } });
    this.codes(tenantId).set(code, { ...p, claimed: true });
    return 'claimed';
  }

  async player(tenantId: string, playerId: string) {
    return this.t(tenantId).player(playerId);
  }
  async playerByCapability(tenantId: string, hash: string) {
    return this.t(tenantId).playerByCapability(hash);
  }
  async putPlayer(tenantId: string, p: Player) {
    this.t(tenantId).write({ t: 'player', p });
  }
  async forgetPlayer(tenantId: string, playerId: string) {
    this.t(tenantId).write({ t: 'forget', playerId });
    const m = this.codes(tenantId);
    for (const [c, p] of m) if (p.playerId === playerId) m.delete(c);
    this.quarantineRows = this.quarantineRows.filter((q) => q.tenantId !== tenantId || q.playerId !== playerId);
  }

  async appendSignal(input: ProposedSignalRow): Promise<AppendResult> {
    const s = this.t(input.tenantId);
    // One synchronous section: nothing else of this process runs between the reads and the write.
    const seen = s.bySequenceKey(input.playerId, input.dedupeKey);
    if (seen) return { signal: stored(input.tenantId, seen), duplicate: true };
    const sequence = s.lastSequence(input.playerId) + 1;
    const d = input.sign({ sequence, acked: s.acked(input.playerId) });
    const e: JournalEntry = {
      playerId: input.playerId,
      sequence,
      id: d.id,
      dedupeKey: input.dedupeKey,
      jws: d.jws,
      at: d.at,
      kid: d.kid,
      payload: d.payload,
    };
    s.write({ t: 'signal', e });
    for (const w of this.watchers.get(input.tenantId) ?? []) w(input.playerId);
    return { signal: stored(input.tenantId, e), duplicate: false };
  }
  async listAfter(c: { tenantId: string; playerId: string; after: number; limit: number }) {
    return this.t(c.tenantId)
      .signals(c.playerId, c.after)
      .slice(0, c.limit)
      .map((e) => stored(c.tenantId, e));
  }
  async lastSequence(tenantId: string, playerId: string) {
    return this.t(tenantId).lastSequence(playerId);
  }
  async acked(tenantId: string, playerId: string) {
    return this.t(tenantId).acked(playerId);
  }
  async acknowledge(i: { tenantId: string; playerId: string; sequence: number }) {
    this.t(i.tenantId).write({ t: 'ack', playerId: i.playerId, through: i.sequence });
  }

  async revokeToken(tenantId: string, id: string) {
    this.t(tenantId).write({ t: 'revoke-token', id });
  }
  async tokenRevoked(tenantId: string, id: string) {
    return this.t(tenantId).tokenRevoked(id);
  }
  async revokedTokens(tenantId: string) {
    return this.t(tenantId).revokedTokens();
  }

  async rotateKeys(i: { tenantId: string; keyId: string; publicKey: string; retireAfter?: string }) {
    this.t(i.tenantId);
    let m = this.keyRows.get(i.tenantId);
    if (!m) this.keyRows.set(i.tenantId, (m = new Map()));
    m.set(i.keyId, {
      tenantId: i.tenantId,
      keyId: i.keyId,
      publicKey: i.publicKey,
      ...(i.retireAfter ? { retireAfter: i.retireAfter } : {}),
    });
  }
  async keys(tenantId: string) {
    this.t(tenantId);
    return [...(this.keyRows.get(tenantId)?.values() ?? [])];
  }

  async quarantine(row: QuarantineRow) {
    this.t(row.tenantId);
    if (
      !this.quarantineRows.some(
        (q) => q.tenantId === row.tenantId && q.playerId === row.playerId && q.sequence === row.sequence,
      )
    )
      this.quarantineRows.push({ ...row });
  }
  async quarantined(tenantId?: string) {
    return this.quarantineRows.filter((q) => tenantId === undefined || q.tenantId === tenantId);
  }

  async exportTenant(tenantId: string): Promise<TenantExport> {
    const s = this.t(tenantId);
    const players = s instanceof MemoryBridgeStore ? s.allPlayers() : [];
    return {
      tenantId,
      players,
      signals: players.flatMap((p) => s.signals(p.playerId, 0).map((e) => stored(tenantId, e))),
      acks: players.map((p) => ({ playerId: p.playerId, through: s.acked(p.playerId) })).filter((a) => a.through > 0),
      revokedTokens: [...s.revokedTokens()],
      keys: await this.keys(tenantId),
      quarantine: await this.quarantined(tenantId),
      pairings: [...this.codes(tenantId).values()].map((p) => ({ ...p })),
    };
  }
  async importTenant(x: TenantExport, o: { replace?: boolean } = {}) {
    if (o.replace) await this.deleteTenant(x.tenantId);
    const s = this.t(x.tenantId);
    for (const p of x.pairings ?? []) this.codes(x.tenantId).set(p.code, { ...p });
    for (const p of x.players) s.write({ t: 'player', p });
    for (const e of x.signals) {
      const { tenantId: _, ...entry } = e;
      s.write({ t: 'signal', e: entry });
    }
    for (const a of x.acks) s.write({ t: 'ack', playerId: a.playerId, through: a.through });
    for (const id of x.revokedTokens) s.write({ t: 'revoke-token', id });
    for (const k of x.keys) await this.rotateKeys(k);
    for (const q of x.quarantine) await this.quarantine(q);
  }
  async deleteTenant(tenantId: string) {
    checkTenant(tenantId);
    this.pairings.delete(tenantId);
    this.keyRows.delete(tenantId);
    this.quarantineRows = this.quarantineRows.filter((q) => q.tenantId !== tenantId);
    this.onDelete(tenantId);
  }

  watch(tenantId: string, wake: (playerId: string) => void): () => void {
    let set = this.watchers.get(tenantId);
    if (!set) this.watchers.set(tenantId, (set = new Set()));
    set.add(wake);
    return () => set.delete(wake);
  }
  async close() {
    this.watchers.clear();
  }
}

/** Every tenant in memory, each its own `MemoryBridgeStore` (the tests; two Bridges in one process sharing it). */
export class MemoryRealityStore extends SyncBackedStore {
  constructor() {
    const tenants = new Map<string, MemoryBridgeStore>();
    super(
      (t) => {
        let s = tenants.get(t);
        if (!s) tenants.set(t, (s = new MemoryBridgeStore()));
        return s;
      },
      // The tenants that hold something (a read creates an empty store; it is not a tenant for that).
      () => [...tenants].filter(([, s]) => s.allPlayers().length > 0 || s.revokedTokens().size > 0).map(([t]) => t),
      'memory',
      (t) => tenants.delete(t),
    );
  }
}

/**
 * A 4.1.9 store (memory or the JSON-lines journal) as a `RealityStore` of the single tenant `default`: another tenant
 * is refused, never served from this one's rows.
 */
export function fromBridgeStore(store: BridgeStore, kind: 'memory' | 'jsonl' = 'memory'): RealityStore {
  return new SyncBackedStore(
    (t) => {
      if (t !== DEFAULT_TENANT) throw new Error(`this store holds the tenant "${DEFAULT_TENANT}" only, not "${t}"`);
      return store;
    },
    () => [DEFAULT_TENANT],
    kind,
    () => {
      throw new Error('a single-tenant journal is deleted as a file, not through the Bridge');
    },
  );
}
