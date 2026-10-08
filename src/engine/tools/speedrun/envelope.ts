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
import type { WorldVariant } from '../../core/remix/story';
import type { GameState, SessionEntry, SpeedrunCategory, SpeedrunWorldPolicy } from '../../core/types';
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

/**
 * What a Daily or a Mystery world rests on (4.1.16, ADR 0019): the Bridge's signed tokens, as received. A Daily run
 * carries the day's token; a Mystery run the commitment signed before its start, the reveal signed after, and when the
 * client says it started (epoch ms: the client's word, which is why a Mystery run without a witness is not ranked).
 * @public
 */
export type SpeedrunWorldEvidence =
  | { kind: 'daily'; token: string }
  | { kind: 'mystery'; commitmentToken: string; revealToken: string; startedAt: number };

/** What every schema of a `.wsrun` file holds. */
interface SpeedrunEnvelopeBody {
  format: 'web-scumm-speedrun';
  gameId: string;
  fingerprint: GameFingerprint;
  engineVersion: string;
  prngVersion: number;
  timingVersion: number;
  categoryId: string;
  rulesVersion: number;
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

/** A `.wsrun` file of 4.1.14 and 4.1.15 (schema 1): its seed is the run's, its world the story world. @public */
export interface SpeedrunEnvelopeV1 extends SpeedrunEnvelopeBody {
  schema: 1;
  seed?: string;
}

/**
 * A `.wsrun` file since 4.1.16 (schema 2, ADR 0019): the run's generator seed and the exact world it was played in,
 * with what that world rests on, all sealed into `h0`. @public
 */
export interface SpeedrunEnvelopeV2 extends SpeedrunEnvelopeBody {
  schema: 2;
  /** The run's generator seed, never the world's. */
  runSeed: string;
  /** The world played, assignments included: never regenerated from a seed. */
  variant: WorldVariant;
  worldEvidence?: SpeedrunWorldEvidence;
}

/** A `.wsrun` file: the proof of one speedrun (schema 1 read, schema 2 written). @public */
export type SpeedrunEnvelope = SpeedrunEnvelopeV1 | SpeedrunEnvelopeV2;

/** What `h0` seals of a run's world (schema 2). */
export interface HeadWorld {
  variant: WorldVariant;
  policy: SpeedrunWorldPolicy;
  evidence?: SpeedrunWorldEvidence;
}

/**
 * The chain's first hash: the rules the run was played under. With `world` (schema 2) it also seals the world's hash,
 * the category's world policy, the evidence's canonical hash and the Remix algorithm's version; without, the text of
 * 4.1.14, so a schema 1 run keeps its head.
 */
export async function headHash(o: {
  fingerprint: GameFingerprint;
  category: Pick<SpeedrunCategory, 'id' | 'fingerprint'>;
  rulesVersion: number;
  seed?: string;
  prngVersion?: number;
  timingVersion?: number;
  world?: HeadWorld;
}): Promise<string> {
  const fp: Record<string, string> = {};
  for (const k of o.category.fingerprint) fp[k] = o.fingerprint[k];
  const head = {
    fingerprint: fp,
    categoryId: o.category.id,
    rulesVersion: o.rulesVersion,
    seed: o.seed ?? null,
    prngVersion: o.prngVersion ?? PRNG_VERSION,
    timingVersion: o.timingVersion ?? TIMING_VERSION,
  };
  if (!o.world) return sha256Hex(canonicalJson(head));
  const evidence = o.world.evidence ? await sha256Hex(canonicalJson(o.world.evidence)) : null;
  return sha256Hex(
    canonicalJson({
      ...head,
      schema: 2,
      world: { hash: o.world.variant.hash, policy: o.world.policy, evidence },
      remixAlgorithmVersion: o.world.variant.algorithmVersion,
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

/** Seals a run into its envelope, schema 2 (the client's word: `trust` is always `local`). */
export async function sealEnvelope(o: {
  gameId: string;
  fingerprint: GameFingerprint;
  engineVersion: string;
  category: SpeedrunCategory;
  rulesVersion: number;
  seed: string;
  world: HeadWorld;
  links: readonly TapeLink[];
  finish: { logicalTime: string; activeTime: string; rtaMs: number | null; logicalSteps: string };
  splits: readonly RecordedSplit[];
  excluded?: readonly ExcludedInterval[];
  loads?: readonly RunLoad[];
  inputsUsed?: SpeedrunEnvelope['inputsUsed'];
  realitySignals?: readonly RecordedRealitySignal[];
  finalState: GameState;
}): Promise<SpeedrunEnvelopeV2> {
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
    schema: 2,
    gameId: o.gameId,
    fingerprint: o.fingerprint,
    engineVersion: o.engineVersion,
    prngVersion: PRNG_VERSION,
    timingVersion: TIMING_VERSION,
    categoryId: o.category.id,
    rulesVersion: o.rulesVersion,
    runSeed: o.seed,
    variant: o.world.variant,
    ...(o.world.evidence ? { worldEvidence: o.world.evidence } : {}),
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
