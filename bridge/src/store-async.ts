// What the Bridge keeps, asynchronously and per tenant (4.1.10, ADR 0009): the contract every store meets (memory,
// the 4.1.9 journal wrapped, SQLite, Postgres), so the Bridge calls nothing else. Every method takes the tenant first;
// a store never answers a question about one tenant with another's rows. `appendSignal` is the one write that orders
// anything: one transaction for the deduplication, the sequence (`MAX + 1`), the Bridge's checks and signature, and the
// row. Nothing here knows HTTP, Biscuit or a key.
import type { WorldSignal } from '../../src/engine/reality/protocol';
import type { JournalEntry, Pairing, Player } from './store';

/** The tenant of a single-tenant Bridge, and of every 4.1.9 journal. */
export const DEFAULT_TENANT = 'default';

/** A tenant's id: what a request resolves to, what every row carries. */
const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** A signal as the store keeps it: the journal entry of 4.1.9 and the tenant it belongs to. */
export interface StoredSignal extends Omit<JournalEntry, 'payload'> {
  tenantId: string;
  payload?: WorldSignal;
}

/** What the Bridge returns from inside `appendSignal`'s transaction once it knows the sequence. */
interface SignalDraft {
  id: string;
  jws: string;
  kid: string;
  payload: WorldSignal;
  at: number;
}

/** A proposal on its way into the journal. */
export interface ProposedSignalRow {
  tenantId: string;
  playerId: string;
  dedupeKey: string;
  /**
   * Called once, inside the transaction, with the sequence drawn and the player's acknowledgement: the Bridge checks
   * its quotas and signs. A throw rolls the transaction back and reaches the caller; nothing is written.
   */
  sign(ctx: { sequence: number; acked: number }): SignalDraft;
}

/** The outcome of `appendSignal`: the row, and whether it was already there (the same `dedupeKey`). */
export interface AppendResult {
  signal: StoredSignal;
  duplicate: boolean;
}

/** A key a tenant signs with, or signed with (the public half only). */
export interface KeyRow {
  tenantId: string;
  keyId: string;
  publicKey: string;
  /** ISO date after which the key is no longer listed for players; absent for the current key. */
  retireAfter?: string;
}

/** A row the Bridge could not deliver (its JWS or payload no longer reads): kept aside, listed by `bridge doctor`. */
export interface QuarantineRow {
  tenantId: string;
  playerId: string;
  sequence: number;
  reason: string;
  at: number;
}

/** Everything a store holds about one tenant (`bridge tenant export`). */
export interface TenantExport {
  tenantId: string;
  players: Player[];
  signals: StoredSignal[];
  acks: { playerId: string; through: number }[];
  revokedTokens: string[];
  keys: KeyRow[];
  quarantine: QuarantineRow[];
  /** The pairing codes held (4.1.10, after the second reading): absent in an export written before them. */
  pairings?: Pairing[];
}

/** The outcome of claiming a confirmed pairing code. */
export type ClaimOutcome = 'claimed' | 'pending' | 'already' | 'missing';

export interface RealityStore {
  /** What the store is (said by `/readyz`, `bridge doctor`). */
  readonly kind: 'memory' | 'jsonl' | 'sqlite' | 'postgres';
  /** Answers when the store can be read and written (`/readyz`). */
  ping(): Promise<void>;
  /** The tenants that have rows (`bridge backup`). */
  tenants(): Promise<string[]>;

  // Pairing codes: anyone may ask for one, so they are bounded (`pendingPairings`) and swept.
  pendingPairings(tenantId: string, now: number): Promise<number>;
  sweepPairings(tenantId: string, now: number): Promise<void>;
  putPairing(tenantId: string, p: Pairing): Promise<void>;
  pairing(tenantId: string, code: string): Promise<Pairing | undefined>;
  /** Links the code to a new player, once: false when another confirmation got there first (nothing written). */
  confirmPairing(tenantId: string, code: string, player: Player): Promise<boolean>;
  /** Hands the player its capability, once: the code marked claimed and the player's hash set, together. */
  claimPairing(tenantId: string, code: string, capabilityHash: string): Promise<ClaimOutcome>;

  // Players.
  player(tenantId: string, playerId: string): Promise<Player | undefined>;
  playerByCapability(tenantId: string, hash: string): Promise<Player | undefined>;
  putPlayer(tenantId: string, p: Player): Promise<void>;
  /** Deletes everything about a player: its link, journal, acknowledgement, pairing. */
  forgetPlayer(tenantId: string, playerId: string): Promise<void>;

  // The journal.
  appendSignal(input: ProposedSignalRow): Promise<AppendResult>;
  listAfter(cursor: { tenantId: string; playerId: string; after: number; limit: number }): Promise<StoredSignal[]>;
  lastSequence(tenantId: string, playerId: string): Promise<number>;
  acked(tenantId: string, playerId: string): Promise<number>;
  acknowledge(input: { tenantId: string; playerId: string; sequence: number }): Promise<void>;

  // Connector tokens revoked (by revocation id).
  revokeToken(tenantId: string, id: string): Promise<void>;
  tokenRevoked(tenantId: string, id: string): Promise<boolean>;
  revokedTokens(tenantId: string): Promise<ReadonlySet<string>>;

  // Keys (public halves), per tenant: rotation and retirement independent of any other tenant.
  rotateKeys(input: { tenantId: string; keyId: string; publicKey: string; retireAfter?: string }): Promise<void>;
  keys(tenantId: string): Promise<KeyRow[]>;

  // Rows that could not be delivered.
  quarantine(row: QuarantineRow): Promise<void>;
  quarantined(tenantId?: string): Promise<QuarantineRow[]>;

  // A tenant as a whole.
  exportTenant(tenantId: string): Promise<TenantExport>;
  /**
   * Writes an export back (`bridge restore`, `bridge migrate`): into a tenant that holds nothing yet, or, with
   * `replace`, instead of what it holds, in one transaction (a failure leaves the tenant as it was).
   */
  importTenant(x: TenantExport, o?: { replace?: boolean }): Promise<void>;
  deleteTenant(tenantId: string): Promise<void>;

  /**
   * Calls `wake(playerId)` when a signal of this tenant may have been accepted elsewhere (another instance, another
   * process). A wake-up is a hint: the reader reads the store. Returns the function that stops watching.
   */
  watch(tenantId: string, wake: (playerId: string) => void): () => void;
  close(): Promise<void>;
}

/** Whether a store is a `RealityStore` (a 4.1.9 `BridgeStore` has no `appendSignal`). */
export const isRealityStore = (s: object): s is RealityStore =>
  typeof (s as { appendSignal?: unknown }).appendSignal === 'function';

/** Refuses a tenant id that is not one (a store is never asked with an empty or arbitrary string). */
export function checkTenant(tenantId: string): string {
  if (!TENANT_ID.test(tenantId)) throw new Error(`not a tenant id: ${JSON.stringify(tenantId.slice(0, 64))}`);
  return tenantId;
}

/** The store could not take its write lock in time (SQLite busy): the server answers 503 and `Retry-After`. */
export class StoreBusyError extends Error {}
