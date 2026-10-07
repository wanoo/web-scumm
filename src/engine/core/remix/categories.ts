// Speedrun categories over Remix worlds (4.1.15, programme §11.8): Story (no logical variation), Fixed (a published
// seed, trainable), Random (a seed drawn at the start and shown at once), Mystery (a seed committed by the Bridge
// before the start, revealed after: D26), Daily (the Bridge's signed seed of the day, the same for everyone). Each
// has its own leaderboards: a time on one seed never meets a time on another unless the category says so (Random).
// Written against 4.1.14's `SpeedrunCategory` (docs/dev/plans/4.1.14-time-attack.md §3), whose `seed` field gains
// 'mystery' | 'daily' here; the Time Attack branch merges these fields into its manifest.
import { canonicalJson } from '../canonical';
import type { WorldVariant } from './compile';
import { normalizeSeed, STORY_SEED } from './seed-code';
import { sha256HexSync } from './sha256';

/** How a category picks its world. @public */
export type SpeedrunSeedPolicy = 'story' | 'fixed' | 'random' | 'mystery' | 'daily';

/** What a speedrun category says of the world (merged into 4.1.14's `SpeedrunCategory`). @public */
export interface RemixCategoryRules {
  seed: SpeedrunSeedPolicy;
  /** The Remix mode its worlds come from (`story` for Story). */
  mode: string;
  /** Fixed: the published seed. */
  fixedSeed?: string;
  /** The code wheel (§11.13): played, skippable, or off; physical or on-screen. */
  codeWheel?: { enabled: boolean; skip: boolean; medium: 'digital' | 'physical' | 'either' };
}

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
}

/**
 * Whether a run's world is the one its category allows: empty when it is, else the reasons (a verifier refuses the
 * run with them). The world itself is checked by `loadVariant` (its hash) before this.
 * @public
 */
export function worldVerdict(rules: RemixCategoryRules, v: WorldVariant, e: WorldEvidence = {}): string[] {
  const out: string[] = [];
  if (rules.seed === 'story') {
    if (v.mode !== 'story' || v.seed !== STORY_SEED) out.push('a Story run is played in the story world');
    return out;
  }
  if (v.mode !== rules.mode) out.push(`the world's mode is ${v.mode}, the category's ${rules.mode}`);
  if (rules.seed === 'fixed' && (!rules.fixedSeed || normalizeSeed(rules.fixedSeed) !== v.seed))
    out.push(`a Fixed run is played on ${rules.fixedSeed ?? '(no seed published)'}, not ${v.seed}`);
  if (rules.seed === 'daily' && (!e.dailySeed || normalizeSeed(e.dailySeed) !== v.seed))
    out.push('a Daily run is played on the seed the Bridge signed for that day');
  if (rules.seed === 'mystery') {
    if (!e.commitment || !e.reveal) out.push('a Mystery run needs the commitment and its reveal');
    else if (seedCommitment(e.reveal.seed, e.reveal.nonce) !== e.commitment)
      out.push('the revealed seed does not match the commitment');
    else if (normalizeSeed(e.reveal.seed) !== v.seed) out.push('the run was not played on the revealed seed');
  }
  return out;
}

/**
 * The leaderboard a run goes to: its category, and for a Fixed or a Daily its seed (a Daily's seed names its day). Random
 * and Mystery rank every seed together: the category says those times are comparable.
 * @public
 */
export function leaderboardKey(categoryId: string, rules: RemixCategoryRules, v: WorldVariant): string {
  if (rules.seed === 'fixed' || rules.seed === 'daily') return `${categoryId}:${v.seed}`;
  return categoryId;
}
