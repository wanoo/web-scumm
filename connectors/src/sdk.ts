// The connector SDK (4.1.9 "Gateways", ADR 0008, D19): what every connector of the world outside shares. A connector
// is a process of its own, beside the Bridge and far from the game. It receives something from outside (an email, a
// line typed on a terminal, a badge), treats it as hostile, validates and normalises it, binds it to a player, gives
// it a deduplication key, then proposes a signal to the Bridge under its own attenuated Biscuit. The Bridge sequences
// and signs (unchanged since 4.1.1). Delivery is at least once, applied idempotently: one logical effect per key,
// never "exactly once". The payload never leaves the connector: its SHA-256 goes to the Bridge as `evidenceHash`
// (the protocol has no payload field, and the game never receives what a connector saw).
import { createHash } from 'node:crypto';
import type { RealityManifest } from '../../src/engine/reality/manifest';

/** The limits every connector applies before anything reaches the Bridge. */
export interface ConnectorLimits {
  /** A payload, as canonical JSON, in bytes; and the largest input a connector reads at once. */
  maxBytes: number;
  /** Proposals per minute, all players together (the Bridge has its own quota per token). */
  maxPerMinute: number;
  /** One call to the Bridge, in milliseconds. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ConnectorLimits = { maxBytes: 4096, maxPerMinute: 60, timeoutMs: 5000 };

/** A log line's fields: identifiers and counts only. A string that looks like content is redacted by `safeLog`. */
export type LogFields = Record<string, string | number | boolean>;

export interface ConnectorContext {
  /** The Bridge and the connector's attenuated Biscuit. */
  bridge: { url: string; token: string };
  gameId: string;
  /** Reserved for 4.1.10 (Constellation): `'default'` until then. */
  tenantId?: string;
  limits: ConnectorLimits;
  /** The game's Reality manifest: the signals it declares and what each connector may turn into one. */
  manifest: RealityManifest;
  /** Never a payload, an address, a code or a secret: `safeLog` redacts what looks like one. */
  log: (event: string, fields?: LogFields) => void;
  propose: (signal: ProposedSignal) => Promise<ProposeResult>;
  /** Confirms a pairing code the player typed or sent (the token must carry `pair(true)`): the player it links. */
  pair: (code: string) => Promise<{ ok: true; playerId: string } | { ok: false; refusal: RefusalCode }>;
  /** An input the connector turned down itself (too big, malformed, hostile, over a limit): counted and logged. */
  reject: (reason: string, fields?: LogFields) => void;
  /** The counters of this context (proposals, refusals by code), for `/metrics`. */
  metrics: () => ConnectorMetrics;
}

export interface ProposedSignal {
  /** The connector family: `email`, `telnet`, `ssh`, `open-badge`. Informative; the Bridge checks the manifest's. */
  source: string;
  /** The signal, as the game declares it (`reality.signals[].id`). */
  kind: string;
  playerId: string;
  sessionId?: string;
  /** Idempotence: the same fact twice has the same key (`dedupeKey(source, external id)`). */
  dedupeKey: string;
  /** Flat JSON (strings, numbers, booleans, null), no markup, at most `limits.maxBytes`. Kept here, hashed out. */
  payload: Record<string, unknown>;
  /** ISO time on the connector's clock (the Bridge stamps its own). */
  receivedAt: string;
}

/** Why a proposal was not accepted: a fixed vocabulary, never the Bridge's free text. */
export type RefusalCode =
  | 'shape'
  | 'too-large'
  | 'quota'
  | 'not-declared'
  | 'denied'
  | 'revoked'
  | 'player'
  | 'pending'
  | 'pairing'
  | 'bridge-quota'
  | 'timeout'
  | 'unreachable'
  | 'stopped'
  | 'bridge';

export type ProposeResult = { ok: true; sequence: number; duplicate: boolean } | { ok: false; refusal: RefusalCode };

export interface ConnectorHealth {
  ok: boolean;
  detail: string;
  since: string;
}

export interface RealityConnector {
  readonly id: string;
  start(ctx: ConnectorContext): Promise<void>;
  /** Stops taking input, lets what is in flight finish (at most `DRAIN_MS`), closes every socket. */
  stop(): Promise<void>;
  health(): Promise<ConnectorHealth>;
}

export interface ConnectorMetrics {
  proposed: number;
  accepted: number;
  duplicates: number;
  refused: Partial<Record<RefusalCode, number>>;
  /** Inputs the connector itself turned down before any proposal (too big, malformed, hostile, over a limit). */
  rejectedInputs: number;
  retries: number;
}

/** How long `stop()` waits for work in flight (SIGTERM → stop → drain). */
export const DRAIN_MS = 5000;

const IDENT = /^[\w.:-]{1,128}$/;

/** The deduplication key of an external fact: SHA-256 of `<source>:<its id outside>`, hex. */
export function dedupeKey(source: string, external: string): string {
  return createHash('sha256').update(`${source}:${external}`).digest('hex');
}

/** JSON with sorted keys (the payload's hash does not depend on the order a connector built it in). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

/** Why a payload is refused, or null: flat, scalar values, no markup, within the size. */
export function payloadProblem(p: unknown, maxBytes: number): 'shape' | 'too-large' | null {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return 'shape';
  for (const v of Object.values(p as Record<string, unknown>)) {
    if (v === null || typeof v === 'boolean') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (typeof v === 'string' && !/[<>]/.test(v)) continue;
    return 'shape';
  }
  return Buffer.byteLength(canonicalJson(p)) > maxBytes ? 'too-large' : null;
}

/**
 * A log line that cannot carry content: numbers and booleans as they are; a string only when it is an identifier
 * (letters, digits, `.`, `_`, `:`, `-`, at most 64), never with an `@`, a space or a slash. Anything else is
 * `[redacted]`. The test "a log without content" greps every fixture's text in the lines a run wrote.
 */
export function safeLog(write: (line: string) => void, connector: string) {
  return (event: string, fields: LogFields = {}) => {
    const out: Record<string, string | number | boolean> = {
      event: IDENT.test(event) ? event : '[redacted]',
      connector,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (!/^[a-zA-Z][\w]{0,31}$/.test(k)) continue;
      out[k] = typeof v === 'string' && !/^[\w.:-]{0,64}$/.test(v) ? '[redacted]' : v;
    }
    write(JSON.stringify(out));
  };
}

/** Proposals per sliding minute. */
class Window {
  private at: number[] = [];
  constructor(
    private perMinute: number,
    private now: () => number,
  ) {}
  take(): boolean {
    const t = this.now();
    this.at = this.at.filter((x) => x > t - 60_000);
    if (this.at.length >= this.perMinute) return false;
    this.at.push(t);
    return true;
  }
}

/** The Bridge's error code (`{ error }`) → the SDK's vocabulary. */
function refusalOf(status: number, code: string | undefined): RefusalCode {
  if (status === 413) return 'too-large';
  if (status === 422) return 'not-declared';
  if (status === 404) return code === 'pairing' ? 'pairing' : 'player';
  if (status === 409 || status === 410) return 'pairing';
  if (status === 401) return code === 'revoked' ? 'revoked' : 'denied';
  if (status === 403) return 'denied';
  if (status === 429) return code === 'pending' ? 'pending' : 'bridge-quota';
  if (status === 400) return 'shape';
  return 'bridge';
}

export interface ContextOptions {
  bridge: { url: string; token: string };
  gameId: string;
  tenantId?: string;
  limits?: Partial<ConnectorLimits>;
  manifest: RealityManifest;
  connector: string;
  /** Where log lines go (default: stdout). */
  write?: (line: string) => void;
  now?: () => number;
  /** Network retries of one proposal with the same key (at least once): 2 by default. */
  retries?: number;
  fetch?: typeof fetch;
}

/** A context bound to one Bridge: limits, the local quota, retries with the same key, metrics, a safe log. */
export function createContext(o: ContextOptions): ConnectorContext & { close(): void } {
  const limits = { ...DEFAULT_LIMITS, ...o.limits };
  const now = o.now ?? Date.now;
  const doFetch = o.fetch ?? fetch;
  const log = safeLog(o.write ?? ((l) => process.stdout.write(`${l}\n`)), o.connector);
  const window = new Window(limits.maxPerMinute, now);
  const m: ConnectorMetrics = { proposed: 0, accepted: 0, duplicates: 0, refused: {}, rejectedInputs: 0, retries: 0 };
  let closed = false;
  const refuse = (code: RefusalCode, kind?: string): { ok: false; refusal: RefusalCode } => {
    m.refused[code] = (m.refused[code] ?? 0) + 1;
    log('signal.refused', { code, ...(kind && IDENT.test(kind) ? { kind } : {}) });
    return { ok: false, refusal: code };
  };
  const call = async (path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    const r = await doFetch(new URL(path, o.bridge.url), {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(limits.timeoutMs),
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON: the status says enough */
    }
    return { status: r.status, json };
  };
  const declared = new Map(o.manifest.signals.map((s) => [s.id, s.source]));

  const propose = async (s: ProposedSignal): Promise<ProposeResult> => {
    if (closed) return refuse('stopped', s.kind);
    m.proposed++;
    if (!IDENT.test(s.kind) || !IDENT.test(s.playerId) || !/^.{1,256}$/s.test(s.dedupeKey))
      return refuse('shape', s.kind);
    const source = declared.get(s.kind);
    if (!source) return refuse('not-declared', s.kind);
    const problem = payloadProblem(s.payload, limits.maxBytes);
    if (problem) return refuse(problem, s.kind);
    if (!window.take()) return refuse('quota', s.kind);
    const received = Date.parse(s.receivedAt);
    const body = {
      playerId: s.playerId,
      signal: s.kind,
      source,
      dedupeKey: s.dedupeKey,
      ...(Number.isFinite(received) && received >= 0 ? { occurredAt: Math.floor(received) } : {}),
      evidenceHash: createHash('sha256').update(canonicalJson(s.payload)).digest('hex'),
    };
    // At least once: a call that timed out or lost its connection is sent again with the same key; the Bridge
    // answers the second one `duplicate` if the first got through. Refusals are never retried.
    const tries = 1 + (o.retries ?? 2);
    for (let i = 0; i < tries; i++) {
      if (i > 0) m.retries++;
      try {
        const r = await call('v1/signals', body);
        if (r.status === 200 || r.status === 202) {
          const sequence = Number(r.json.sequence);
          const duplicate = r.json.duplicate === true;
          if (duplicate) m.duplicates++;
          else m.accepted++;
          log(duplicate ? 'signal.duplicate' : 'signal.accepted', { kind: s.kind, sequence });
          return { ok: true, sequence, duplicate };
        }
        if (r.status >= 500 && i < tries - 1) continue;
        return refuse(refusalOf(r.status, typeof r.json.error === 'string' ? r.json.error : undefined), s.kind);
      } catch (e) {
        if (i < tries - 1) continue;
        return refuse((e as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable', s.kind);
      }
    }
    return refuse('bridge', s.kind);
  };

  const pair = async (code: string) => {
    if (closed) return refuse('stopped');
    if (!/^[A-Z0-9]{8}$/.test(code)) return refuse('pairing');
    try {
      const r = await call(`v1/pairings/${code}/confirm`, {});
      if (r.status === 200 && typeof r.json.playerId === 'string' && IDENT.test(r.json.playerId)) {
        log('pairing.confirmed', { playerId: r.json.playerId });
        return { ok: true as const, playerId: r.json.playerId };
      }
      return refuse(refusalOf(r.status, typeof r.json.error === 'string' ? r.json.error : undefined));
    } catch (e) {
      return refuse((e as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable');
    }
  };

  return {
    bridge: o.bridge,
    gameId: o.gameId,
    tenantId: o.tenantId ?? 'default',
    limits,
    manifest: o.manifest,
    log,
    propose,
    pair,
    reject: (reason, fields = {}) => {
      m.rejectedInputs++;
      log('input.rejected', { reason, ...fields });
    },
    metrics: () => ({ ...m, refused: { ...m.refused } }),
    close: () => {
      closed = true;
    },
  };
}

/** Resolves when `work` settles or after `ms`, whichever comes first (a drain never holds a stop longer). */
export async function within(work: Promise<unknown>, ms = DRAIN_MS): Promise<'done' | 'timeout'> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((ok) => {
    t = setTimeout(() => ok('timeout'), ms);
    t.unref?.();
  });
  try {
    return await Promise.race([
      work.then(
        () => 'done' as const,
        () => 'done' as const,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(t);
  }
}
