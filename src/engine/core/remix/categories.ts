// Speedrun categories over Remix worlds (4.1.15, programme §11.8): Story (no logical variation), Fixed (a published
// seed, trainable), Random (a seed drawn at the start and shown at once), Mystery (a seed committed by the Bridge
// before the start, revealed after: D26), Daily (the Bridge's signed seed of the day, the same for everyone). Each
// has its own leaderboards: a time on one seed never meets a time on another unless the category says so (Random).
// 4.1.16 (D29, ADR 0019): a category says its world in `SpeedrunCategory.world` (`SpeedrunWorldPolicy`, the one type);
// `categoryWorld` reads a 4.1.15 category (`seed: 'mystery' | 'daily'`) as that world, and the verifier calls
// `worldVerdict` and `leaderboardKey` on every run.
import { canonicalJson } from '../canonical';
import type { SpeedrunCategory, SpeedrunWorldPolicy } from '../types/speedrun';
import type { WorldVariant } from './compile';
import { normalizeSeed, STORY_SEED } from './seed-code';
import { sha256HexSync } from './sha256';

/** How a category picks its world. @public */
export type SpeedrunSeedPolicy = SpeedrunWorldPolicy['policy'];

/**
 * What a speedrun category says of the world, as 4.1.15 wrote it (`seed` for the policy). Kept for the frozen surface
 * (D28); `SpeedrunWorldPolicy` (`policy`) is the canonical form since 4.1.16, and both are accepted below.
 * @public
 */
export interface RemixCategoryRules extends Omit<SpeedrunWorldPolicy, 'policy'> {
  seed: SpeedrunSeedPolicy;
}

const policyOf = (r: RemixCategoryRules | SpeedrunWorldPolicy): SpeedrunSeedPolicy =>
  'policy' in r ? r.policy : r.seed;

/**
 * The world of a category (4.1.16, D29): its `world`, else what a 4.1.15 `seed` meant (`daily`, `mystery`: that mode's
 * worlds), else the story world. `deprecated` says a 4.1.15 form was read. @public
 */
export function categoryWorld(cat: Pick<SpeedrunCategory, 'seed' | 'world'>): {
  world: SpeedrunWorldPolicy;
  deprecated: boolean;
} {
  if (cat.world) return { world: cat.world, deprecated: false };
  if (cat.seed === 'daily' || cat.seed === 'mystery')
    return { world: { policy: cat.seed, mode: cat.seed }, deprecated: true };
  return { world: { policy: 'story', mode: 'story' }, deprecated: false };
}

/** The run's generator (D29): `fixed` only when the category says so; anything else is a fresh seed per run. @public */
export const runSeedPolicy = (cat: Pick<SpeedrunCategory, 'seed'>): 'fixed' | 'random' =>
  cat.seed === 'fixed' ? 'fixed' : 'random';

/** The five categories a Remix game offers by default. @public */
export const REMIX_CATEGORIES: Readonly<Record<string, RemixCategoryRules>> = {
  story: { seed: 'story', mode: 'story' },
  fixed: { seed: 'fixed', mode: 'remix' },
  random: { seed: 'random', mode: 'remix' },
  mystery: { seed: 'mystery', mode: 'mystery' },
  daily: { seed: 'daily', mode: 'daily' },
};

/** The commitment to a Mystery seed (D26): SHA-256 of the seed and a nonce, published (signed) before the start. @public */
export function seedCommitment(seed: string, nonce: string): string {
  return sha256HexSync(canonicalJson({ seed: normalizeSeed(seed), nonce }));
}

/** What a run's world must match, given the category and what the Bridge published (the day's seed, a commitment). @public */
export interface WorldEvidence {
  /** Daily: the seed of the day, from a verified signed token. */
  dailySeed?: string;
  /** Mystery: the commitment published before the start, and the reveal (seed and nonce) after. */
  commitment?: string;
  reveal?: { seed: string; nonce: string };
  /** Mystery: when the Bridge first revealed the seed (epoch ms, its signed record) and when the run started. */
  revealedAt?: number;
  runStartedAt?: number;
}

/**
 * How long a Mystery run may start after its seed was first revealed (D26, after the second reading): the client must
 * build the world to play it, so the reveal comes first; a run that starts later had time to look at the world and
 * pick another commitment. Commits are rate-limited per client on the Bridge (`bridge/src/daily.ts`).
 * @public
 */
export const MYSTERY_START_WINDOW_MS = 60_000;

/**
 * Whether a run's world is the one its category allows: empty when it is, else the reasons (a verifier refuses the
 * run with them). The world itself is checked by `loadVariant` (its hash) before this.
 * @public
 */
export function worldVerdict(
  rules: RemixCategoryRules | SpeedrunWorldPolicy,
  v: WorldVariant,
  e: WorldEvidence = {},
): string[] {
  const out: string[] = [];
  const policy = policyOf(rules);
  if (policy === 'story') {
    if (v.mode !== 'story' || v.seed !== STORY_SEED) out.push('a Story run is played in the story world');
    return out;
  }
  if (v.mode !== rules.mode) out.push(`the world's mode is ${v.mode}, the category's ${rules.mode}`);
  if (policy === 'fixed' && (!rules.fixedSeed || normalizeSeed(rules.fixedSeed) !== v.seed))
    out.push(`a Fixed run is played on ${rules.fixedSeed ?? '(no seed published)'}, not ${v.seed}`);
  if (policy === 'daily' && (!e.dailySeed || normalizeSeed(e.dailySeed) !== v.seed))
    out.push('a Daily run is played on the seed the Bridge signed for that day');
  if (policy === 'mystery') {
    if (!e.commitment || !e.reveal) out.push('a Mystery run needs the commitment and its reveal');
    else if (seedCommitment(e.reveal.seed, e.reveal.nonce) !== e.commitment)
      out.push('the revealed seed does not match the commitment');
    else if (normalizeSeed(e.reveal.seed) !== v.seed) out.push('the run was not played on the revealed seed');
    if (e.revealedAt === undefined || e.runStartedAt === undefined)
      out.push('a Mystery run needs the time of the reveal and of its start');
    else if (e.runStartedAt < e.revealedAt || e.runStartedAt - e.revealedAt > MYSTERY_START_WINDOW_MS)
      out.push(
        `a Mystery run starts within ${MYSTERY_START_WINDOW_MS / 1000} s of its reveal, not after looking at the world`,
      );
  }
  return out;
}

/**
 * The leaderboard a run goes to: its category, and for a Fixed or a Daily its seed (a Daily's seed names its day). Random
 * and Mystery rank every seed together: the category says those times are comparable.
 * @public
 */
export function leaderboardKey(
  categoryId: string,
  rules: RemixCategoryRules | SpeedrunWorldPolicy,
  v: WorldVariant,
): string {
  const policy = policyOf(rules);
  if (policy === 'fixed' || policy === 'daily') return `${categoryId}:${v.seed}`;
  return categoryId;
}
