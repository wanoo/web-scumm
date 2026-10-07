// Applying a world (4.1.15 "Remix", ADR 0018): a `WorldVariant` becomes plain data in a copy of the game, before the
// engine, the solver, a replay or a verifier reads it, so that none of them needs to know Remix. A logical dimension
// whose value is not its story value writes its reserved flag in `start.flags` (`remix.<dimension>`; a puzzle order
// one per group, `remix.<dimension>.<group>` = position); an actor's start moves its character's `room`; a coupled
// pair fills `{code:<dimension>}` and `{hint:<dimension>}` in every text at once (after the translation, so every
// language says the same code); a presentation value replaces a line, an image, a palette or a minigame parameter
// (D27: never a flag, never a condition). The rules' order is never touched. The story world writes no flag: a game
// played without Remix is its story world, as before 4.1.15.
import type { Cmd, GameDef, Id, Value } from '../types';
import {
  type CompiledManifest,
  compileManifest,
  EMPTY_MANIFEST,
  loadVariant,
  type RemixWorld,
  storyVariant,
  type WorldVariant,
} from './compile';
import { canonicalJson } from '../canonical';
import { type RemixText, type VariationDimension, variantFlag } from './manifest';

/** What the compiler reads of a game definition: its rooms' anchors and every rule with an id. @public */
export function remixWorld(game: GameDef): RemixWorld {
  const rules: { id: string; kind: string; do?: Cmd[] }[] = [];
  for (const r of game.rooms) {
    for (const x of r.on ?? []) if (x.id) rules.push({ id: x.id, kind: 'rule', do: x.do });
    for (const e of r.events ?? []) if (e.id) rules.push({ id: e.id, kind: 'listener', do: e.do });
  }
  for (const x of game.rules.on ?? []) if (x.id) rules.push({ id: x.id, kind: 'rule', do: x.do });
  for (const e of game.events ?? []) if (e.id) rules.push({ id: e.id, kind: 'listener', do: e.do });
  return { rooms: game.rooms, rules };
}

/** The game's manifest compiled (an empty one for a game without `remix`). Throws `RemixManifestError`. @public */
export function compileGameManifest(game: GameDef): CompiledManifest {
  return compileManifest(game.remix ?? EMPTY_MANIFEST, remixWorld(game));
}

/** A text in a language: the language's own, else the game's, else the first one written. */
export function textIn(t: RemixText, lang: string | undefined, fallback = 'en'): string {
  if (typeof t === 'string') return t;
  return t[lang ?? fallback] ?? t[fallback] ?? Object.values(t)[0] ?? '';
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/**
 * The reserved flags a variant writes: one per logical dimension away from its story value (`remix.<id>`), and a
 * puzzle order's position per group. The story world writes none.
 *
 */
export function variantFlags(c: CompiledManifest, v: WorldVariant): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const id of c.order) {
    const d = c.dims.get(id)!;
    const value = v.assignments[id];
    if (!d.dim.logical || value === undefined || same(value, d.story)) continue;
    const dim = d.dim;
    if (dim.kind === 'coupled') out[variantFlag(id)] = dim.pairs[value as number]!.answer;
    else if (dim.kind === 'puzzle-order') {
      const order = value as Id[];
      out[variantFlag(id)] = order.join('>');
      order.forEach((g, i) => {
        out[variantFlag(id, g)] = i;
      });
    } else out[variantFlag(id)] = value as string;
  }
  return out;
}

/**
 * The minigame parameters a presentation dimension may vary (D27, after the second reading of 4.1.15): the built-in
 * minigames' texts and backdrops, which never decide a win. Anything else (answers, options, counts, a game's own
 * minigame) is refused: the validator says so.
 */
const COSMETIC_MINIGAME_PARAMS: Readonly<Record<string, readonly string[]>> = {
  pipes: ['intro', 'win'],
  stroke: ['intro', 'win', 'tooFast'],
  pick: ['background', 'decoyLine', 'wrongLine', 'win'],
  hide: ['intro', 'win'],
  runner: ['intro', 'win', 'stumble'],
  scratch: ['intro'],
  cables: ['intro', 'win', 'windowsText'],
  'code-wheel': ['question', 'wrong', 'pass', 'win', 'list', 'turnLeft', 'turnRight'],
};

/** Every string of a value, rewritten by `f` (plain objects and arrays, in place). */
function rewriteStrings(x: unknown, f: (s: string) => string): unknown {
  if (typeof x === 'string') return f(x);
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) x[i] = rewriteStrings(x[i], f);
    return x;
  }
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = rewriteStrings(o[k], f);
  }
  return x;
}

/** The placeholders of the coupled dimensions, filled: `{code:<id>}` the answer, `{hint:<id>}` the hint. */
function fillCodes(text: string, c: CompiledManifest, v: WorldVariant, lang?: string): string {
  return text.replace(/\{(code|hint):([\w.-]+)\}/g, (m, what: string, id: string) => {
    const d = c.dims.get(id)?.dim;
    if (!d || d.kind !== 'coupled') return m;
    const pair = d.pairs[(v.assignments[id] as number | undefined) ?? d.story]!;
    return what === 'code' ? pair.answer : textIn(pair.hint, lang);
  });
}

/** Sets the text of every line whose `id` is `lineId` (a `say`, a list line, a toast, a choice); how many it found. */
function setLine(x: unknown, lineId: string, text: string): number {
  let n = 0;
  if (Array.isArray(x)) for (const y of x) n += setLine(y, lineId, text);
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o.id === lineId) {
      if (typeof o.text === 'string') {
        o.text = text;
        n++;
      }
      if (Array.isArray(o.say)) {
        o.say = [o.say[0], text];
        n++;
      }
      if (typeof o.toast === 'string') {
        o.toast = text;
        n++;
      }
    }
    for (const k of Object.keys(o)) n += setLine(o[k], lineId, text);
  }
  return n;
}

/** Applies one presentation value; returns false when the target names nothing. */
function applyPresentation(
  g: GameDef,
  dim: Extract<VariationDimension, { kind: 'presentation' }>,
  value: unknown,
  lang?: string,
): boolean {
  const [kind, rest = ''] = [
    dim.target.slice(0, dim.target.indexOf(':')),
    dim.target.slice(dim.target.indexOf(':') + 1),
  ];
  if (kind === 'line') return setLine(g, rest, textIn(value as RemixText, lang, g.lang ?? 'en')) > 0;
  if (kind === 'prop-img') {
    const [room, prop] = rest.split('.');
    const p = g.rooms.find((r) => r.id === room)?.props?.[prop ?? ''];
    if (!p) return false;
    p.img = value as string;
    return true;
  }
  if (kind === 'palette') {
    const ch = g.characters[rest];
    if (!ch) return false;
    ch.palette = value as Record<string, string>;
    return true;
  }
  if (kind === 'minigame') {
    const [ruleId, param] = rest.split(':');
    const rule = [...g.rooms.flatMap((r) => r.on ?? []), ...(g.rules.on ?? [])].find((r) => r.id === ruleId);
    const mg = JSON.stringify(rule?.do ?? []).includes('"minigame"') ? findMinigame(rule!.do) : undefined;
    // Only a parameter that cannot change who wins (D27): a text, a backdrop. A difficulty, a list of answers or of
    // options would change the game while its proof is keyed by the logical world only.
    if (!mg || !param || !COSMETIC_MINIGAME_PARAMS[mg.minigame]?.includes(param)) return false;
    mg.params = { ...(mg.params ?? {}), [param]: value };
    return true;
  }
  return false;
}

function findMinigame(list: Cmd[]): { minigame: string; params?: Record<string, unknown> } | undefined {
  for (const c of list) {
    if (c && typeof c === 'object' && 'minigame' in c)
      return c as { minigame: string; params?: Record<string, unknown> };
    if (c && typeof c === 'object')
      for (const v of Object.values(c))
        if (Array.isArray(v)) {
          const hit = findMinigame(v.filter((x) => x && typeof x === 'object') as Cmd[]);
          if (hit) return hit;
        }
  }
  return undefined;
}

/** Options of `applyVariant`: the language the texts are in. @public */
export interface ApplyOptions {
  /** The language the game's texts are in (after `applyLocale`): which text of a hint or an alternative line. */
  lang?: string;
}

/**
 * The game as the world `variant` makes it: a copy, the reserved flags in `start.flags`, actors' starting rooms, codes
 * and hints in every text, presentation values, and `variant` recorded. The variant is checked first (its hash, and
 * against a changed manifest each value still exists): a stored variant is never regenerated (ADR 0018).
 * @public
 */
export function applyVariant(game: GameDef, variant: WorldVariant, o: ApplyOptions = {}): GameDef {
  const c = compileGameManifest(game);
  loadVariant(c, variant);
  const g = structuredClone(game);
  delete g.variant;
  const lang = o.lang ?? game.lang;
  const flags = variantFlags(c, variant);
  if (Object.keys(flags).length) g.start = { ...g.start, flags: { ...(g.start.flags ?? {}), ...flags } };
  for (const id of c.order) {
    const dim = c.dims.get(id)!.dim;
    const value = variant.assignments[id];
    if (dim.kind === 'actor-start' && typeof value === 'string' && g.characters[dim.actor])
      g.characters[dim.actor] = { ...g.characters[dim.actor]!, room: value };
    if (dim.kind === 'presentation' && value !== undefined && value !== dim.story)
      applyPresentation(g, dim, dim.values[value as number], lang);
  }
  rewriteStrings(g, (s) => (s.includes('{code:') || s.includes('{hint:') ? fillCodes(s, c, variant, lang) : s));
  seedWheels(g, variant.seed);
  g.variant = variant;
  return g;
}

/** Every code wheel of the game (`{ minigame: 'code-wheel' }`) takes the world's seed, unless its author fixed one. */
function seedWheels(x: unknown, seed: string): void {
  if (Array.isArray(x)) for (const y of x) seedWheels(y, seed);
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o.minigame === 'code-wheel') {
      const params = (o.params ?? {}) as Record<string, unknown>;
      if (params.seed === undefined) o.params = { ...params, seed };
    }
    for (const v of Object.values(o)) seedWheels(v, seed);
  }
}

/** The game's story world applied (codes and hints at their story values): what a game without a chosen seed plays. @public */
export function applyStory(game: GameDef, o: ApplyOptions = {}): GameDef {
  return applyVariant(game, storyVariant(game.remix, remixWorld(game)), o);
}

/** Whether a presentation dimension's target names something of the game (the validator's check). */
export function presentationTargetExists(
  game: GameDef,
  dim: Extract<VariationDimension, { kind: 'presentation' }>,
): boolean {
  const g = structuredClone(game);
  return dim.values.every((v) => applyPresentation(g, dim, v, game.lang));
}
