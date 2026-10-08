// The speedrun verifier (4.1.14 "Time Attack", ADR 0017): reads a `.wsrun` envelope, reloads the exact rules of its
// category from the approved game, replays its entries with its seed (the draws are drawn again, never fed), recomputes
// the clock, the splits, the final state and the chain, checks the category's rules, and says one verdict with a code
// and a reason. The checks run in a fixed order; the first that fails names the verdict. `inconclusive` (a budget, a
// crash, no keyring) is never valid. `npm run speedrun:verify`, the CLI, the MCP tool and the Bridge's worker call it.
// 4.1.16 (ADR 0019): a schema 2 run carries its world; the verifier checks it against the approved game (`loadVariant`),
// checks it is a world its category ranks (`worldVerdict`, with the Bridge's signed tokens for Daily and Mystery),
// seals it into the head, replays the run on the game that world makes, and names its leaderboard (`leaderboardKey`).
// A schema 1 run is a Story run, replayed as 4.1.14 did; offered to a Remix category it is refused, never requalified.
import { CHUNK_SIZE } from '../../core/journal-chunks';
import type { CustomCommands } from '../../core/custom';
import { canonicalJson } from '../../core/canonical';
import { type GameFingerprint, sha256Hex } from '../../core/fingerprint';
import { PRNG_VERSION } from '../../core/prng';
import type { TapeLink } from '../../core/run-tape';
import { TIMING_VERSION } from '../../core/timing';
import { applyVariant, compileGameManifest, remixWorld } from '../../core/remix/apply';
import {
  categoryWorld,
  leaderboardKey,
  runSeedPolicy,
  type WorldEvidence,
  worldVerdict,
} from '../../core/remix/categories';
import { compileVariant, loadVariant, storyVariant } from '../../core/remix/compile';
import { RemixSeedError } from '../../core/remix/seed-code';
import { storyWorld, type WorldVariant } from '../../core/remix/story';
import type { GameDef, Id, Layout, SessionEntry, SpeedrunCategory, SpeedrunWorldPolicy } from '../../core/types';
import type { Keyring, SignalExpectation } from '../../reality/protocol';
import {
  chainChunks,
  envelopeEntries,
  finalProofOf,
  type HeadWorld,
  headHash,
  type SpeedrunEnvelope,
  type SpeedrunEnvelopeV1,
  type SpeedrunEnvelopeV2,
  type SpeedrunWorldEvidence,
  stateHash,
} from './envelope';
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
  /** The world the run was played in and the leaderboard it goes to (4.1.16, once the world was checked). */
  world?: {
    hash: string;
    mode: string;
    seed: string;
    leaderboardKey: string;
    /** A Daily world: when its day ends (epoch ms). A run submitted later is practice, not that day's board's. */
    validUntil?: number;
  };
  /** What the replay recomputed (when it got that far). */
  recomputed?: {
    logicalSteps: string;
    logicalTime: string;
    activeTime: string;
    finalStateHash: string;
    finalProof: string;
  };
}

/** The approved game a run is checked against: its content, layouts, fingerprint, engine, the Bridge's keys. @public */
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
  // Either schema's fields, all optional: what the checks below narrow (a file is data, not the client's word).
  const e = j as Partial<Omit<SpeedrunEnvelopeV1, 'schema'> & Omit<SpeedrunEnvelopeV2, 'schema'>> & {
    schema?: unknown;
  };
  if (!e || typeof e !== 'object' || e.format !== 'web-scumm-speedrun')
    stop('invalid-replay', 'envelope-shape', 'not a web-scumm speedrun envelope');
  if (e.schema !== 1 && e.schema !== 2)
    stop('unsupported-version', 'schema', `envelope schema ${String(e.schema)}: this verifier reads 1 and 2`);
  const extra = Object.keys(e).filter((k) => !(e.schema === 1 ? V1_KEYS : V2_KEYS).has(k));
  if (extra.length) stop('invalid-replay', 'envelope-shape', `unknown field(s) in the envelope: ${extra.join(', ')}`);
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
    (e.schema === 1 ? e.seed === undefined || isStr(e.seed) : isStr(e.runSeed)) &&
    (e.loads === undefined || Array.isArray(e.loads));
  if (!ok) stop('invalid-replay', 'envelope-shape', 'a field of the envelope is missing or of the wrong type');
  if (e.schema === 2) {
    if (e.variant === undefined)
      stop('invalid-replay', 'world-missing', 'a schema 2 run names the world it was played in');
    if (e.worldEvidence !== undefined && !isEvidence(e.worldEvidence))
      stop('invalid-replay', 'world-shape', 'the world evidence is not a Daily or a Mystery proof');
  }
  return e as unknown as SpeedrunEnvelope;
}

const BODY_KEYS = [
  'format',
  'schema',
  'gameId',
  'fingerprint',
  'engineVersion',
  'prngVersion',
  'timingVersion',
  'categoryId',
  'rulesVersion',
  'timing',
  'splits',
  'chunks',
  'loads',
  'inputsUsed',
  'realitySignals',
  'h0',
  'finalStateHash',
  'finalProof',
  'trust',
];
const V1_KEYS = new Set([...BODY_KEYS, 'seed']);
const V2_KEYS = new Set([...BODY_KEYS, 'runSeed', 'variant', 'worldEvidence']);
const TOKEN_MAX = 4096;
const isToken = (x: unknown): x is string => isStr(x) && x.length <= TOKEN_MAX;
function isEvidence(x: unknown): x is SpeedrunWorldEvidence {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  if (o.kind === 'daily') return keys === 'kind,token' && isToken(o.token);
  if (o.kind === 'mystery')
    return (
      keys === 'commitmentToken,kind,revealToken,startedAt' &&
      isToken(o.commitmentToken) &&
      isToken(o.revealToken) &&
      Number.isSafeInteger(o.startedAt)
    );
  return false;
}

/** Verifies a run (`.wsrun` text or object) against the approved game: never throws, every failure is a verdict. @public */
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
  // 3. The world (4.1.16): the approved game's, of a kind the category ranks, before anything is replayed.
  const world = await runWorld(env, category, ctx);
  const runSeed = env.schema === 2 ? env.runSeed : env.seed;
  const fixed = `fixed:${category.id}`;
  const fixedRun = runSeedPolicy(category) === 'fixed';
  if (fixedRun ? runSeed !== fixed : runSeed === undefined)
    stop(
      'invalid-category-rule',
      'seed-policy',
      fixedRun ? `a fixed-seed run draws from "${fixed}"` : 'a run names its seed',
    );
  // 4. The chunks: contiguous, linked, full but the last, from the rules' own head (its world sealed in schema 2).
  const h0 = await headHash({
    fingerprint: env.fingerprint,
    category,
    rulesVersion: env.rulesVersion,
    seed: runSeed,
    ...(world.head ? { world: world.head } : {}),
  });
  if (env.h0 !== h0) stop('invalid-replay', 'chain', "the chain's head is not the hash of these rules");
  let prev = h0;
  env.chunks.forEach((c, i) => {
    if (!c.entries.length) stop('invalid-replay', 'chunk-order', `chunk ${i} is empty`);
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
    if (category.reload !== 'allowed')
      stop(
        'invalid-category-rule',
        'reload-forbidden',
        `a load before entry ${l.before} in a category where a load disqualifies`,
      );
  }
  // 5. The replay, with the run's seed: the draws drawn again.
  const r = await replayRun(world.game, ctx.layouts, entries, {
    seed: runSeed,
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
  // 11. The category's rules on what the run did and declared. The code wheel (4.1.16): its results are the reserved
  // flag the replay wrote (`minigame.code-wheel`); a category that does not let the wheel be skipped wants it won, and
  // one that switches it off wants it not played. Its `medium` (on screen, printed) is the player's word: not checked.
  const wheel = world.policy.codeWheel;
  if (wheel) {
    // Each minigame an entry ran (`ran`, in order) paired with the result it recorded (`mg`, in the same order): a
    // wheel played without a result (a client that dropped it) counts as none. A result is the client's word, like
    // `medium`: the replay checks it was recorded and replays it, not that it was earned.
    const results: (string | undefined)[] = [];
    for (const l of links) {
      const ids = (l.entry.ran ?? []).filter((r) => r.startsWith('minigame:')).map((r) => r.slice(9));
      ids.forEach((id, k) => {
        if (id === 'code-wheel') results.push(l.entry.mg?.[k]);
      });
    }
    const breaks = (r: string | undefined) =>
      !wheel.enabled ? r !== 'skipped' && r !== 'disabled' : !wheel.skip ? r !== 'won' : false;
    const at = results.findIndex(breaks);
    if (at >= 0) {
      const said = results[at] ?? 'no result';
      stop(
        'invalid-category-rule',
        'code-wheel-rule',
        !wheel.enabled
          ? `the code wheel is off in this category, and it was played (${said})`
          : `this category wants the code wheel won, not ${said}`,
      );
    }
  }
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
  const w = world.variant;
  const placed = {
    hash: w.hash,
    mode: w.mode,
    seed: w.seed,
    leaderboardKey: leaderboardKey(category.id, world.policy, w),
    ...(world.validUntil !== undefined ? { validUntil: world.validUntil } : {}),
  };
  if (category.timing === 'rta')
    return {
      verdict: 'valid-unranked',
      code: 'rta-unverifiable',
      reason: 'the run replays as recorded, but its RTA is the client’s word (a witness would rank it)',
      trust: 'replay-valid',
      world: placed,
      recomputed,
    };
  if (world.policy.policy === 'mystery')
    return {
      verdict: 'valid-unranked',
      code: 'mystery-unwitnessed',
      reason:
        'the run replays on the revealed seed, but when it started is the client’s word (a server witness would rank it)',
      trust: 'replay-valid',
      world: placed,
      recomputed,
    };
  return {
    verdict: 'valid',
    code: 'ok',
    reason: 'the run replays as recorded and keeps its category’s rules',
    trust: 'replay-valid',
    world: placed,
    recomputed,
  };
}

/** A run's world, checked: the game to replay, what the head seals (schema 2), and the category's policy. */
interface RunWorld {
  game: GameDef;
  variant: WorldVariant;
  policy: SpeedrunWorldPolicy;
  head?: HeadWorld;
  validUntil?: number;
}

async function runWorld(env: SpeedrunEnvelope, category: SpeedrunCategory, ctx: VerifyContext): Promise<RunWorld> {
  const { world: policy } = categoryWorld(category);
  if (env.schema === 1) {
    // 4.1.14's runs: the story world, the game replayed as it was then. Never a Remix run, whatever its seed.
    if (policy.policy !== 'story')
      stop(
        'invalid-category-rule',
        'legacy-world-missing',
        `a schema 1 run names no world: it is not a run of a ${policy.policy} category`,
      );
    return { game: ctx.game, variant: storyWorld(ctx.game.remix), policy };
  }
  let variant: WorldVariant;
  const compiled = compileGameManifest(ctx.game);
  try {
    const loaded = loadVariant(compiled, env.variant);
    if (loaded.stale) stop('invalid-replay', 'world-stale', 'the world was made from another version of the game');
    variant = loaded.variant;
  } catch (err) {
    if (err instanceof RemixSeedError)
      stop('invalid-replay', err.code === 'seed' ? 'world-shape' : err.code, err.message);
    throw err;
  }
  // Integrity is not authenticity (ADR 0019, after the second reading): a world's hash only says it was not altered
  // after it was hashed, and anyone can hash a world. The world a seed names is regenerated here and must be this one,
  // assignment for assignment: a world relabelled with another seed, or a combination no seed makes, is refused.
  variant = authenticWorld(ctx.game, compiled, variant);
  const evidence = await checkEvidence(env, policy, variant, ctx);
  const validUntil = evidence.validUntil;
  const reasons = worldVerdict(policy, variant, evidence);
  if (reasons.length)
    stop(
      'invalid-category-rule',
      reasons.some((r) => /starts within/.test(r)) ? 'mystery-start-window' : 'world-policy',
      reasons.join('; '),
    );
  return {
    game: applyVariant(ctx.game, variant),
    variant,
    policy,
    head: { variant, policy, ...(env.worldEvidence ? { evidence: env.worldEvidence } : {}) },
    ...(validUntil !== undefined ? { validUntil } : {}),
  };
}

/** The world `variant` names, made again from its seed, mode and algorithm version: it, or a refusal. */
function authenticWorld(
  game: GameDef,
  compiled: ReturnType<typeof compileGameManifest>,
  variant: WorldVariant,
): WorldVariant {
  if (variant.mode === 'story') {
    const story = storyVariant(game.remix, remixWorld(game));
    if (variant.hash !== story.hash) stop('invalid-replay', 'world-forged', 'this is not the story world of the game');
    return variant;
  }
  let made: WorldVariant | undefined;
  try {
    made = compileVariant(compiled, game.remix!, variant.seed, variant.algorithmVersion, variant.mode);
  } catch (err) {
    if (err instanceof RemixSeedError)
      stop('invalid-replay', /algorithm version/.test(err.message) ? 'world-algorithm' : 'world-forged', err.message);
    throw err;
  }
  if (made?.hash !== variant.hash)
    stop(
      'invalid-replay',
      'world-forged',
      `the seed ${variant.seed} does not make this world (its assignments differ)`,
    );
  return variant;
}

/** A Daily or Mystery run's tokens, verified with the game's daily key (`remix.daily`): what `worldVerdict` reads. */
async function checkEvidence(
  env: SpeedrunEnvelopeV2,
  policy: SpeedrunWorldPolicy,
  variant: WorldVariant,
  ctx: VerifyContext,
): Promise<WorldEvidence & { validUntil?: number }> {
  if (policy.policy !== 'daily' && policy.policy !== 'mystery') {
    if (env.worldEvidence) stop('invalid-replay', 'world-shape', `a ${policy.policy} run carries no Bridge token`);
    return {};
  }
  const e = env.worldEvidence;
  const missing = policy.policy === 'daily' ? 'daily-proof-missing' : 'mystery-commitment';
  if (!e || e.kind !== policy.policy)
    stop('invalid-category-rule', missing, `a ${policy.policy} run carries the Bridge's signed tokens`);
  const d = ctx.game.remix?.daily;
  if (!d) stop('invalid-category-rule', missing, 'this game names no Bridge key for its Daily and Mystery worlds');
  const [{ importBridgeKey }, daily] = await Promise.all([
    import('../../reality/protocol'),
    import('../../reality/daily'),
  ]);
  const key = await importBridgeKey(d!.kid, d!.publicKey);
  if (e!.kind === 'daily') {
    const t = await daily.verifyDayToken(e!.token, key, ctx.game.id, null);
    if (!t.ok) stop('invalid-category-rule', 'daily-proof-invalid', `the day's token: ${t.reason}`);
    const tok = (t as { token: import('../../reality/daily').DayToken }).token;
    if (tok.mode !== variant.mode || tok.mode !== policy.mode)
      stop('invalid-category-rule', 'world-policy', `the day's mode is ${tok.mode}`);
    if (tok.rules.algorithmVersion !== variant.algorithmVersion)
      stop(
        'invalid-category-rule',
        'daily-proof-invalid',
        `the day's rules name algorithm ${tok.rules.algorithmVersion}`,
      );
    return { dailySeed: tok.seed, validUntil: tok.notAfter };
  }
  const c = await daily.verifyCommitment(e!.commitmentToken, key, ctx.game.id);
  if (!c.ok) stop('invalid-category-rule', 'mystery-commitment', `the commitment: ${c.reason}`);
  const commit = (c as { token: import('../../reality/daily').CommitToken }).token;
  if (commit.mode !== policy.mode)
    stop(
      'invalid-category-rule',
      'mystery-commitment',
      `the commitment is for mode ${commit.mode}, not ${policy.mode}`,
    );
  const r = await daily.verifyReveal(e!.revealToken, key, commit);
  if (!r.ok) stop('invalid-category-rule', 'mystery-reveal', `the reveal: ${r.reason}`);
  const rev = (r as { token: import('../../reality/daily').RevealToken }).token;
  return {
    commitment: commit.commitment,
    reveal: { seed: rev.seed, nonce: rev.nonce },
    revealedAt: rev.revealedAt,
    runStartedAt: e!.startedAt,
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
