// The proof of a run (4.1.14 "Time Attack", ADR 0016): the `.wsrun` envelope. Its chunks carry the run's entries and
// the hashes of the chain H0 → Hn over the tape's links (core/run-tape.ts, core/journal-chunks.ts); `finalProof` seals
// the chain with the summary a leaderboard shows (timing, splits, final state, loads, signals). Every `bigint` is a
// decimal string and every hash is over `canonicalJson`: nothing here stringifies an object with JSON (a lint test
// greps this folder). Integrity is not authenticity: the chain shows the file was not altered after it was sealed,
// not that the client was honest; a verifier replays it (verify.ts) and only a witness raises its trust (ADR 0017).
import { canonicalJson } from '../../core/canonical';
import { logicalState } from '../../core/diff';
import type { GameFingerprint } from '../../core/fingerprint';
import { sha256Hex } from '../../core/fingerprint';
import { CHUNK_SIZE, chainStep } from '../../core/journal-chunks';
import { PRNG_VERSION } from '../../core/prng';
import type { TapeLink } from '../../core/run-tape';
import { TIMING_VERSION } from '../../core/timing';
import type { GameState, SessionEntry, SpeedrunCategory } from '../../core/types';
import type { TrustLevel } from './records';
import type { RunLoad } from './replay-run';
import type { RecordedSplit } from './splits';

/**
 * A stretch of real time the client declares (a pause, a menu, the tab in the background, a load, a manual save):
 * where in the run (`entry`: the next entry's index), when (`atMs` since the start, monotonic) and how long.
 */
export interface ExcludedInterval {
  kind: 'pause' | 'menu' | 'background' | 'load' | 'save';
  entry: number;
  atMs: number;
  durationMs: number;
}

/** A signal from outside as a run keeps it: the Bridge's signed JWS, its key, its hash and the client's verdict. */
export interface RecordedRealitySignal {
  id: string;
  sequence: number;
  signal: string;
  source: string;
  receivedAt: number;
  jws: string;
  kid?: string;
  /** SHA-256 of the JWS, hex. */
  hash: string;
  verdict: 'ok' | 'skipped';
}

/** One chunk of the envelope: its entries and the chain's hashes before and after them. */
export interface EnvelopeChunk {
  index: number;
  prevHash: string;
  hash: string;
  entries: SessionEntry[];
}

/** A `.wsrun` file: the proof of one speedrun (schema 1). @public */
export interface SpeedrunEnvelope {
  format: 'web-scumm-speedrun';
  schema: 1;
  gameId: string;
  fingerprint: GameFingerprint;
  engineVersion: string;
  prngVersion: number;
  timingVersion: number;
  categoryId: string;
  rulesVersion: number;
  seed?: string;
  timing: {
    rtaMs: number;
    logicalSteps: string;
    logicalTime: string;
    activeTime: string;
    excluded: readonly ExcludedInterval[];
  };
  splits: readonly RecordedSplit[];
  chunks: readonly EnvelopeChunk[];
  loads?: readonly RunLoad[];
  /** The inputs the run used (declared by the client: an accessibility option is never an implicit cheat). */
  inputsUsed?: readonly ('mouse' | 'touch' | 'keyboard' | 'gamepad')[];
  realitySignals?: readonly RecordedRealitySignal[];
  h0: string;
  finalStateHash: string;
  finalProof: string;
  trust: TrustLevel;
}

/** The chain's first hash: the rules the run was played under. */
export function headHash(o: {
  fingerprint: GameFingerprint;
  category: Pick<SpeedrunCategory, 'id' | 'fingerprint'>;
  rulesVersion: number;
  seed?: string;
  prngVersion?: number;
  timingVersion?: number;
}): Promise<string> {
  const fp: Record<string, string> = {};
  for (const k of o.category.fingerprint) fp[k] = o.fingerprint[k];
  return sha256Hex(
    canonicalJson({
      fingerprint: fp,
      categoryId: o.category.id,
      rulesVersion: o.rulesVersion,
      seed: o.seed ?? null,
      prngVersion: o.prngVersion ?? PRNG_VERSION,
      timingVersion: o.timingVersion ?? TIMING_VERSION,
    }),
  );
}

/** The SHA-256 of a state's logical part (positions, camera and timestamps aside). */
export function stateHash(s: GameState): Promise<string> {
  return sha256Hex(canonicalJson(logicalState(s)));
}

/** The links in chunks of `CHUNK_SIZE`, each with the chain's hashes from `h0`. */
export async function chainChunks(
  h0: string,
  links: readonly TapeLink[],
): Promise<{ chunks: EnvelopeChunk[]; last: string }> {
  const chunks: EnvelopeChunk[] = [];
  let h = h0;
  for (let i = 0; i < links.length; i += CHUNK_SIZE) {
    const part = links.slice(i, i + CHUNK_SIZE);
    const prevHash = h;
    for (const l of part) h = await chainStep(h, l);
    chunks.push({ index: chunks.length, prevHash, hash: h, entries: part.map((l) => l.entry) });
  }
  return { chunks, last: h };
}

/** What `finalProof` seals besides the chain. */
export function proofSummary(
  e: Pick<SpeedrunEnvelope, 'timing' | 'splits' | 'finalStateHash' | 'loads' | 'realitySignals'>,
) {
  return {
    timing: e.timing,
    splits: e.splits,
    finalStateHash: e.finalStateHash,
    loads: e.loads ?? [],
    realitySignals: e.realitySignals ?? [],
  };
}

export function finalProofOf(last: string, e: Parameters<typeof proofSummary>[0]): Promise<string> {
  return sha256Hex(last + canonicalJson(proofSummary(e)));
}

/** Seals a run into its envelope (the client's word: `trust` is always `local`). */
export async function sealEnvelope(o: {
  gameId: string;
  fingerprint: GameFingerprint;
  engineVersion: string;
  category: SpeedrunCategory;
  rulesVersion: number;
  seed?: string;
  links: readonly TapeLink[];
  finish: { logicalTime: string; activeTime: string; rtaMs: number | null; logicalSteps: string };
  splits: readonly RecordedSplit[];
  excluded?: readonly ExcludedInterval[];
  loads?: readonly RunLoad[];
  inputsUsed?: SpeedrunEnvelope['inputsUsed'];
  realitySignals?: readonly RecordedRealitySignal[];
  finalState: GameState;
}): Promise<SpeedrunEnvelope> {
  const h0 = await headHash({ ...o, category: o.category });
  const { chunks, last } = await chainChunks(h0, o.links);
  const body = {
    timing: {
      rtaMs: o.finish.rtaMs ?? 0,
      logicalSteps: o.finish.logicalSteps,
      logicalTime: o.finish.logicalTime,
      activeTime: o.finish.activeTime,
      excluded: [...(o.excluded ?? [])],
    },
    splits: [...o.splits],
    finalStateHash: await stateHash(o.finalState),
    ...(o.loads?.length ? { loads: [...o.loads] } : {}),
    ...(o.realitySignals?.length ? { realitySignals: [...o.realitySignals] } : {}),
  };
  return {
    format: 'web-scumm-speedrun',
    schema: 1,
    gameId: o.gameId,
    fingerprint: o.fingerprint,
    engineVersion: o.engineVersion,
    prngVersion: PRNG_VERSION,
    timingVersion: TIMING_VERSION,
    categoryId: o.category.id,
    rulesVersion: o.rulesVersion,
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    ...body,
    chunks,
    ...(o.inputsUsed?.length ? { inputsUsed: [...o.inputsUsed] } : {}),
    h0,
    finalProof: await finalProofOf(last, body),
    trust: 'local',
  };
}

/** The text of a `.wsrun` file (canonical JSON). */
export function exportEnvelope(e: SpeedrunEnvelope): string {
  return canonicalJson(e);
}

/** Every entry of an envelope, in order (its chunks concatenated). */
export function envelopeEntries(e: Pick<SpeedrunEnvelope, 'chunks'>): SessionEntry[] {
  return e.chunks.flatMap((c) => c.entries);
}
