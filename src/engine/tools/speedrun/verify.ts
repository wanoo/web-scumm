// The speedrun verifier (4.1.14 "Time Attack", ADR 0017): reads a `.wsrun` envelope, reloads the exact rules of its
// category from the approved game, replays its entries with its seed (the draws are drawn again, never fed), recomputes
// the clock, the splits, the final state and the chain, checks the category's rules, and says one verdict with a code
// and a reason. The checks run in a fixed order; the first that fails names the verdict. `inconclusive` (a budget, a
// crash, no keyring) is never valid. `npm run speedrun:verify`, the CLI, the MCP tool and the Bridge's worker call it.
import { CHUNK_SIZE } from '../../core/journal-chunks';
import type { CustomCommands } from '../../core/custom';
import { canonicalJson } from '../../core/canonical';
import { type GameFingerprint, sha256Hex } from '../../core/fingerprint';
import { PRNG_VERSION } from '../../core/prng';
import type { TapeLink } from '../../core/run-tape';
import { TIMING_VERSION } from '../../core/timing';
import type { GameDef, Id, Layout, SessionEntry, SpeedrunCategory } from '../../core/types';
import type { Keyring, SignalExpectation } from '../../reality/protocol';
import { chainChunks, envelopeEntries, finalProofOf, headHash, type SpeedrunEnvelope, stateHash } from './envelope';
import type { TrustLevel } from './records';
import { replayRun } from './replay-run';

/** A verifier's verdict (ADR 0017). Only `valid` ranks; `inconclusive` is never valid. @public */
export type SpeedrunVerdict =
  | 'valid'
  | 'valid-unranked'
  | 'invalid-category-rule'
  | 'invalid-replay'
  | 'modified-game'
  | 'missing-reality-proof'
  | 'unsupported-version'
  | 'inconclusive';

/** What a verifier answers: the verdict, a stable code, one sentence, and the trust it grants. @public */
export interface SpeedrunVerifyResult {
  verdict: SpeedrunVerdict;
  code: string;
  reason: string;
  /** `replay-valid` for a valid run, else `local` (a verifier never grants more). */
  trust: TrustLevel;
  /** What the replay recomputed (when it got that far). */
  recomputed?: {
    logicalSteps: string;
    logicalTime: string;
    activeTime: string;
    finalStateHash: string;
    finalProof: string;
  };
}

/** The approved game a run is checked against. */
export interface VerifyContext {
  game: GameDef;
  layouts: Record<Id, Layout>;
  commands?: CustomCommands;
  /** The approved package's fingerprint (the components a category requires are compared). */
  fingerprint: GameFingerprint;
  /** This verifier's engine version: another one is replayed by its pinned archive (the Bridge's worker), not here. */
  engineVersion: string;
  /** The Bridge's public keys, for a `recorded` or `live` category's signals. */
  keyring?: Keyring;
  /** What the signals must match besides their signature (the game, the player). */
  signals?: Omit<SignalExpectation, 'now'>;
  /** Wall-time budget of the replay (default 60 s). */
  timeoutMs?: number;
  /** Verifies a signal's JWS (protocol.verifySignal; injected so the core of this file stays synchronous to read). */
  verifySignal?: (jws: string, keyring: Keyring, expect: SignalExpectation) => Promise<{ ok: boolean; code?: string }>;
}

/** Whether a verdict may be ranked on a leaderboard. @public */
export const isRankable = (v: SpeedrunVerdict): boolean => v === 'valid';

class Stop extends Error {
  constructor(
    readonly verdict: SpeedrunVerdict,
    readonly code: string,
    reason: string,
  ) {
    super(reason);
  }
}
const stop = (verdict: SpeedrunVerdict, code: string, reason: string): never => {
  throw new Stop(verdict, code, reason);
};
const isStr = (x: unknown): x is string => typeof x === 'string';
const isDec = (x: unknown): x is string => isStr(x) && /^-?\d+$/.test(x);

/** Reads an envelope's shape (a file is data, not the client's word). */
export function parseEnvelope(input: unknown): SpeedrunEnvelope {
  let j: unknown = input;
  if (isStr(input)) {
    try {
      j = JSON.parse(input);
    } catch {
      stop('invalid-replay', 'envelope-shape', 'the file is not JSON');
    }
  }
  const e = j as Partial<SpeedrunEnvelope>;
  if (!e || typeof e !== 'object' || e.format !== 'web-scumm-speedrun')
    stop('invalid-replay', 'envelope-shape', 'not a web-scumm speedrun envelope');
  if (e.schema !== 1)
    stop('unsupported-version', 'schema', `envelope schema ${String(e.schema)}: this verifier reads 1`);
  const t = e.timing;
  const ok =
    isStr(e.gameId) &&
    isStr(e.categoryId) &&
    isStr(e.engineVersion) &&
    isStr(e.h0) &&
    isStr(e.finalStateHash) &&
    isStr(e.finalProof) &&
    Number.isInteger(e.rulesVersion) &&
    Number.isInteger(e.prngVersion) &&
    Number.isInteger(e.timingVersion) &&
    !!e.fingerprint &&
    typeof e.fingerprint === 'object' &&
    !!t &&
    isDec(t.logicalSteps) &&
    isDec(t.logicalTime) &&
    isDec(t.activeTime) &&
    typeof t.rtaMs === 'number' &&
    Array.isArray(t.excluded) &&
    Array.isArray(e.splits) &&
    Array.isArray(e.chunks) &&
    e.chunks.every(
      (c) => c && Number.isInteger(c.index) && isStr(c.prevHash) && isStr(c.hash) && Array.isArray(c.entries),
    ) &&
    (e.seed === undefined || isStr(e.seed)) &&
    (e.loads === undefined || Array.isArray(e.loads));
  if (!ok) stop('invalid-replay', 'envelope-shape', 'a field of the envelope is missing or of the wrong type');
  return e as SpeedrunEnvelope;
}

/** Verifies a run. Never throws: every failure is a verdict. */
export async function verifyRun(input: unknown, ctx: VerifyContext): Promise<SpeedrunVerifyResult> {
  try {
    return await check(input, ctx);
  } catch (err) {
    if (err instanceof Stop) return { verdict: err.verdict, code: err.code, reason: err.message, trust: 'local' };
    return {
      verdict: 'inconclusive',
      code: /did not finish within/.test(String((err as Error)?.message)) ? 'timeout' : 'crash',
      reason: `the verifier could not finish: ${(err as Error)?.message ?? String(err)}`,
      trust: 'local',
    };
  }
}

const entriesOf = (env: SpeedrunEnvelope) => envelopeEntries(env);
const hasHint = (en: SessionEntry) => (en.ran ?? []).some((r) => r.startsWith('hint:') && !r.endsWith('/none'));

async function check(input: unknown, ctx: VerifyContext): Promise<SpeedrunVerifyResult> {
  const env = parseEnvelope(input);
  // 1. Versions: this verifier replays its own engine, generator and durations only.
  if (env.prngVersion !== PRNG_VERSION)
    stop(
      'unsupported-version',
      'prng-version',
      `generator version ${env.prngVersion}, this engine has ${PRNG_VERSION}`,
    );
  if (env.timingVersion !== TIMING_VERSION)
    stop(
      'unsupported-version',
      'timing-version',
      `durations version ${env.timingVersion}, this engine has ${TIMING_VERSION}`,
    );
  if (env.engineVersion !== ctx.engineVersion)
    stop(
      'unsupported-version',
      'engine-version',
      `recorded on engine ${env.engineVersion}, this verifier is ${ctx.engineVersion}: replay it with that version's archive`,
    );
  // 2. The category and the game.
  const manifest = ctx.game.speedrun;
  const cat = manifest?.categories.find((c) => c.id === env.categoryId);
  if (env.gameId !== ctx.game.id)
    stop('modified-game', 'fingerprint', `a run of "${env.gameId}", not "${ctx.game.id}"`);
  if (!manifest || !cat)
    stop('invalid-category-rule', 'unknown-category', `no category "${env.categoryId}" in this game`);
  const category = cat as SpeedrunCategory;
  if (env.rulesVersion !== manifest!.rulesVersion)
    stop(
      'unsupported-version',
      'rules-version',
      `played under rules ${env.rulesVersion}, the game's are ${manifest!.rulesVersion}: never requalified silently`,
    );
  for (const k of category.fingerprint)
    if (env.fingerprint[k] !== ctx.fingerprint[k])
      stop('modified-game', 'fingerprint', `the game's ${k} differs from the approved package`);
  const fixed = `fixed:${category.id}`;
  if (category.seed === 'fixed' ? env.seed !== fixed : env.seed === undefined)
    stop(
      'invalid-category-rule',
      'seed-policy',
      category.seed === 'fixed' ? `a fixed-seed run draws from "${fixed}"` : 'a run names its seed',
    );
  // 3. The chunks: contiguous, linked, full but the last, from the rules' own head.
  const h0 = await headHash({ fingerprint: env.fingerprint, category, rulesVersion: env.rulesVersion, seed: env.seed });
  if (env.h0 !== h0) stop('invalid-replay', 'chain', "the chain's head is not the hash of these rules");
  let prev = h0;
  env.chunks.forEach((c, i) => {
    if (c.index !== i || c.prevHash !== prev)
      stop('invalid-replay', 'chunk-order', `chunk ${i} is missing, moved or unlinked`);
    if (i < env.chunks.length - 1 && c.entries.length !== CHUNK_SIZE)
      stop('invalid-replay', 'chunk-order', `chunk ${i} holds ${c.entries.length} entries, not ${CHUNK_SIZE}`);
    prev = c.hash;
  });
  const entries = entriesOf(env);
  if (!entries.length || !('start' in entries[0]!))
    stop('invalid-replay', 'envelope-shape', 'a run starts with a new game');
  // 4. Rules the replay depends on: signals from outside, loads.
  const externals = entries.filter((en) => 'external' in en);
  if (externals.length && category.realityPolicy === 'forbidden')
    stop('invalid-category-rule', 'reality-forbidden', 'a signal from outside in a category that forbids them');
  if (category.realityPolicy !== 'forbidden') await checkSignals(env, externals, ctx);
  for (const l of env.loads ?? []) {
    if (l.resume) {
      if (l.from !== l.before - 1)
        stop('invalid-replay', 'replay-diverged', 'a resumed run restores its own last state');
      continue;
    }
    if (l.from < 0)
      stop('invalid-category-rule', 'foreign-load', `a save from outside the run was loaded before entry ${l.before}`);
    if (category.reload === 'invalidates')
      stop(
        'invalid-category-rule',
        'reload-forbidden',
        `a load before entry ${l.before} in a category where a load disqualifies`,
      );
  }
  // 5. The replay, with the run's seed: the draws drawn again.
  const r = await replayRun(ctx.game, ctx.layouts, entries, {
    seed: env.seed,
    loads: env.loads,
    category,
    commands: ctx.commands,
    timeoutMs: ctx.timeoutMs ?? 60_000,
  });
  if (r.replay.errors.length) stop('inconclusive', 'crash', `the engine threw while replaying: ${r.replay.errors[0]}`);
  if (r.badLoads.length) stop('invalid-replay', 'replay-diverged', `a load restores a state the run had not reached`);
  if (r.replay.divergedAt !== undefined)
    stop('invalid-replay', 'replay-diverged', `entry ${r.replay.divergedAt}: ${r.replay.divergence ?? 'diverges'}`);
  const links = r.links;
  if (links.length !== entries.length)
    stop('invalid-replay', 'replay-diverged', `${entries.length} entries recorded, ${links.length} replayed`);
  // 6. The draws: the seeded generator must give exactly the recorded trace.
  for (let i = 0; i < links.length; i++) {
    const mine = links[i]!.entry.rnd ?? [];
    const theirs = entries[i]!.rnd ?? [];
    if (mine.length !== theirs.length || mine.some((x, k) => x !== theirs[k]))
      stop('invalid-replay', 'rnd-mismatch', `entry ${i}: the draws are not the seed's`);
  }
  const t = r.tracker!;
  if (t.startEntry === null) stop('invalid-category-rule', 'start-trigger', 'the category’s start never fired');
  if (!t.finish) stop('invalid-replay', 'not-finished', 'the replay never reaches the category’s finish');
  const fin = t.finish!;
  if (fin.entry !== links.length - 1) stop('invalid-replay', 'replay-diverged', 'entries recorded after the finish');
  // 7. The clock.
  const finLink = links[fin.entry]!;
  if (
    fin.logicalTime !== env.timing.logicalTime ||
    fin.activeTime !== env.timing.activeTime ||
    finLink.logicalSteps !== env.timing.logicalSteps
  )
    stop(
      'invalid-replay',
      'time-mismatch',
      `the replay times it ${fin.logicalTime} µt (${fin.activeTime} active, ${finLink.logicalSteps} steps), the run says ${env.timing.logicalTime}`,
    );
  // 8. The splits (their logical times; RTA is the client's word).
  const mineSplits = t.splits.map(({ rtaMs: _, ...s }) => s);
  const theirSplits = env.splits.map(({ rtaMs: _, ...s }) => s);
  if (canonicalJson(mineSplits) !== canonicalJson(theirSplits))
    stop('invalid-replay', 'splits-mismatch', 'the splits differ from the replay’s');
  // 9. The final state.
  const finalStateHash = await stateHash(r.replay.state);
  if (finalStateHash !== env.finalStateHash)
    stop('invalid-replay', 'final-state', 'the final state differs from the replay’s');
  // 10. The chain: the recorded entries with what the replay says happened in them.
  const claimed: TapeLink[] = links.map((l, i) => ({ ...l, entry: entries[i]! }));
  const chain = await chainChunks(h0, claimed);
  chain.chunks.forEach((c, i) => {
    if (c.hash !== env.chunks[i]!.hash)
      stop('invalid-replay', 'chunk-hash', `chunk ${i} was altered after it was sealed`);
  });
  const finalProof = await finalProofOf(chain.last, env);
  if (finalProof !== env.finalProof) stop('invalid-replay', 'chain', 'the final proof does not seal this run');
  // 11. The category's rules on what the run did and declared.
  if (!category.allowHints && links.some((l) => hasHint(l.entry)))
    stop('invalid-category-rule', 'hints-forbidden', 'a hint was asked for in a category without hints');
  const ex = env.timing.excluded;
  if (!category.allowSaves && ex.some((x) => x.kind === 'save'))
    stop('invalid-category-rule', 'saves-forbidden', 'a manual save in a category without saves');
  if (!category.allowPauses && ex.some((x) => x.kind === 'pause' || x.kind === 'menu'))
    stop('invalid-category-rule', 'pauses-forbidden', 'the pause menu was opened in a category without pauses');
  for (const i of env.inputsUsed ?? [])
    if (!category.inputs[i])
      stop('invalid-category-rule', 'input-forbidden', `the ${i} is not an input of this category`);
  const recomputed = {
    logicalSteps: finLink.logicalSteps,
    logicalTime: fin.logicalTime,
    activeTime: fin.activeTime,
    finalStateHash,
    finalProof,
  };
  if (category.timing === 'rta')
    return {
      verdict: 'valid-unranked',
      code: 'rta-unverifiable',
      reason: 'the run replays as recorded, but its RTA is the client’s word (a witness would rank it)',
      trust: 'replay-valid',
      recomputed,
    };
  return {
    verdict: 'valid',
    code: 'ok',
    reason: 'the run replays as recorded and keeps its category’s rules',
    trust: 'replay-valid',
    recomputed,
  };
}

/** A `recorded` or `live` category: every signal entry has its signed JWS, its hash, and a signature that verifies. */
async function checkSignals(env: SpeedrunEnvelope, externals: SessionEntry[], ctx: VerifyContext): Promise<void> {
  const sigs = env.realitySignals ?? [];
  if (externals.length && !sigs.length)
    stop('missing-reality-proof', 'signal-missing', 'signals were applied but none is recorded');
  if (externals.length && (!ctx.keyring || !ctx.verifySignal || !ctx.signals))
    stop('inconclusive', 'no-keyring', "the Bridge's keys are needed to check this run's signals");
  for (const en of externals) {
    const x = (en as { external: { id: string; sequence: number; signal: string } }).external;
    const s = sigs.find((g) => g.id === x.id && g.sequence === x.sequence);
    if (!s) stop('missing-reality-proof', 'signal-missing', `signal #${x.sequence} has no recorded proof`);
    if (s!.signal !== x.signal)
      stop('missing-reality-proof', 'signal-mismatch', `signal #${x.sequence} is not the one applied`);
    if ((await sha256Hex(s!.jws)) !== s!.hash)
      stop('missing-reality-proof', 'signal-signature', `signal #${x.sequence}: its hash does not match its JWS`);
    const v = await ctx.verifySignal!(s!.jws, ctx.keyring!, { ...ctx.signals!, now: s!.receivedAt });
    if (!v.ok)
      stop(
        'missing-reality-proof',
        'signal-signature',
        `signal #${x.sequence}: ${v.code ?? 'the signature does not verify'}`,
      );
  }
}
