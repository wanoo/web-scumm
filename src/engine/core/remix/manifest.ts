// The variation manifest (4.1.15 "Remix", ADR 0018): what an author lets vary in a game, declared as data in
// `GameDef.remix`, each dimension with a finite domain and its story value. A seed picks one value per dimension of a
// mode (core/remix/compile.ts); the result, a `WorldVariant`, is applied to the game as plain data
// (core/remix/apply.ts) before the engine, the solver or a replay sees it. Never a rule reordered, never a text
// generated: the author writes every branch with the conditions the DSL already has, over the reserved flags
// `remix.<dimension>` this module names.
import * as z from 'zod/mini';
import type { Cond, Id } from '../types';

/** A text in the game's language, or one per language (`{ en, fr }`): what a coupled hint shows. @public */
export type RemixText = string | Readonly<Record<string, string>>;

/**
 * A tagged spot of a room where an item can be placed (`RoomDef.anchors`): the prop or hotspot it stands on (`at`),
 * when it shows, what it takes to reach it, how many items it holds, the story phase it belongs to.
 * @public
 */
export interface AnchorDef {
  /** The prop or hotspot of the room the item is found at. */
  at: Id;
  /** When the spot shows (default: always). */
  visible?: Cond;
  /** What it takes to reach it: never a condition that needs the item placed there (the validator refuses it). */
  reachableBy?: Cond;
  /** How many items it holds at once (default 1: two items never share a spot unless it says so). */
  capacity?: number;
  /** The story phase it belongs to (a label the Studio groups by; `verify:variants` counts it). */
  phase?: string;
}

/** An anchor named from anywhere: its room and its id in `RoomDef.anchors`. @public */
export interface AnchorRef {
  room: Id;
  anchor: Id;
}

/** One coupled pair: the hint the player reads and the answer the content accepts, chosen together or not at all. @public */
export interface CoupledPair {
  hint: RemixText;
  answer: string;
}

/**
 * A dimension: what varies and its finite domain. Logical dimensions are in the solver's space (each instance is
 * proved); `presentation` ones are not (D27: they draw from the `cosmetic` stream and never change a condition).
 * @public
 */
export type VariationDimension =
  | { id: string; kind: 'item-placement'; item: Id; anchors: readonly AnchorRef[]; story: AnchorRef; logical: true }
  | { id: string; kind: 'actor-start'; actor: Id; rooms: readonly Id[]; story: Id; logical: true }
  | { id: string; kind: 'actor-route'; actor: Id; routes: readonly Id[]; story: Id; logical: true }
  | { id: string; kind: 'coupled'; pairs: readonly CoupledPair[]; story: number; logical: true }
  | {
      id: string;
      kind: 'puzzle-order';
      groups: readonly Id[];
      /** `[a, b]`: group `a` comes before group `b` in every admitted order. */
      graph: readonly (readonly [Id, Id])[];
      story: readonly Id[];
      logical: true;
    }
  | { id: string; kind: 'presentation'; target: string; values: readonly unknown[]; story: number; logical: false };

/**
 * A constraint between dimensions: `exclusive` (no two of them take the same value), `requires` (`a` and `b` are
 * `<dimension>=<value>`: when `a` holds, `b` holds), `not-behind` (the item is never placed at an anchor reached only
 * through the rule `action`).
 * @public
 */
export type VariationConstraint =
  | { kind: 'exclusive'; dimensions: readonly string[] }
  | { kind: 'requires'; a: string; b: string }
  | { kind: 'not-behind'; item: Id; action: Id };

/**
 * A mode of play: which dimensions vary (the others keep their story value) and the strategy that backs it (D25):
 * `catalogue` (every instance enumerated and proved, each a release gate; at most 10 000) or `generator` (built by
 * construction, its invariants tested, a published sample proved). `mask` hides the seed's revealing details until
 * the end (a Mystery run).
 * @public
 */
export interface VariationMode {
  id: 'story' | 'remix' | 'daily' | string;
  strategy: 'catalogue' | 'generator';
  dimensions: readonly string[];
  mask?: boolean;
}

/**
 * What a game lets vary (`GameDef.remix`), schema 1, algorithm `web-scumm-remix-1`. `daily` names the Bridge key a
 * daily challenge is signed with (Ed25519, raw, base64url): a player verifies the day's seed offline.
 * @public
 */
export interface VariationManifest {
  schema: 1;
  algorithm: 'web-scumm-remix-1';
  modes: readonly VariationMode[];
  dimensions: readonly VariationDimension[];
  constraints: readonly VariationConstraint[];
  daily?: { kid: string; publicKey: string; mode: string };
}

// The algorithm's name and the generator's version live with the story world (core/remix/story.ts: the player's first
// chunk carries them without the compiler).
import { REMIX_ALGORITHM, REMIX_ALGORITHM_VERSION } from './story';
export { REMIX_ALGORITHM, REMIX_ALGORITHM_VERSION };

/** The reserved flag a logical dimension writes (`remix.<id>`; a puzzle order writes `remix.<id>.<group>`). @public */
export const variantFlag = (dimension: string, group?: string): string =>
  group === undefined ? `remix.${dimension}` : `remix.${dimension}.${group}`;

const id = z.string().check(z.minLength(1));
const text = z.union([z.string(), z.record(z.string(), z.string())]);
const anchorRef = z.strictObject({ room: id, anchor: id });
const dimension = z.union([
  z.strictObject({
    id,
    kind: z.literal('item-placement'),
    item: id,
    anchors: z.array(anchorRef).check(z.minLength(1)),
    story: anchorRef,
    logical: z.literal(true),
  }),
  z.strictObject({
    id,
    kind: z.literal('actor-start'),
    actor: id,
    rooms: z.array(id).check(z.minLength(1)),
    story: id,
    logical: z.literal(true),
  }),
  z.strictObject({
    id,
    kind: z.literal('actor-route'),
    actor: id,
    routes: z.array(id).check(z.minLength(1)),
    story: id,
    logical: z.literal(true),
  }),
  z.strictObject({
    id,
    kind: z.literal('coupled'),
    pairs: z.array(z.strictObject({ hint: text, answer: z.string().check(z.minLength(1)) })).check(z.minLength(1)),
    story: z.int().check(z.nonnegative()),
    logical: z.literal(true),
  }),
  z.strictObject({
    id,
    kind: z.literal('puzzle-order'),
    groups: z.array(id).check(z.minLength(1), z.maxLength(8)),
    graph: z.array(z.tuple([id, id])),
    story: z.array(id),
    logical: z.literal(true),
  }),
  z.strictObject({
    id,
    kind: z.literal('presentation'),
    target: id,
    values: z.array(z.unknown()).check(z.minLength(1)),
    story: z.int().check(z.nonnegative()),
    logical: z.literal(false),
  }),
]);
const constraint = z.union([
  z.strictObject({ kind: z.literal('exclusive'), dimensions: z.array(id).check(z.minLength(2)) }),
  z.strictObject({ kind: z.literal('requires'), a: id, b: id }),
  z.strictObject({ kind: z.literal('not-behind'), item: id, action: id }),
]);

/** The manifest's schema (zod/mini: the player compiles a variant at New Game). @public */
export const VariationManifestSchema = z.strictObject({
  schema: z.literal(1),
  algorithm: z.literal(REMIX_ALGORITHM),
  modes: z.array(
    z.strictObject({
      id,
      strategy: z.enum(['catalogue', 'generator']),
      dimensions: z.array(id),
      mask: z.optional(z.boolean()),
    }),
  ),
  dimensions: z.array(dimension),
  constraints: z.array(constraint),
  daily: z.optional(z.strictObject({ kid: id, publicKey: id, mode: id })),
});

/** A manifest checked against its schema (a malformed one is an error naming the path). @public */
export function parseManifest(input: unknown): VariationManifest {
  return VariationManifestSchema.parse(input) as VariationManifest;
}
