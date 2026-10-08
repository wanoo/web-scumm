// The validator's checks of Remix (4.1.15, ADR 0018): a manifest that cannot produce a world is a build error, never a
// player's. The manifest's schema and its compilation (domains, story values, constraints, anchors behind the action
// that needs their item); every anchor on a prop or hotspot of its room, in a room the start can reach; an actor's
// candidate rooms each with a place for it; routes that are scripts; `{code:<id>}` and `{hint:<id>}` naming coupled
// dimensions; presentation targets that exist; a catalogue mode within `CATALOGUE_MAX`; and, as a warning, a value of a
// logical dimension no condition reads (`remix.<id>` = value): the solver could not tell that world from the story's.
import { canonicalJson } from '../../core/canonical';
import { catalogue, RemixManifestError } from '../../core/remix/compile';
import { compileGameManifest, presentationTargetExists, variantFlags } from '../../core/remix/apply';
import { parseManifest, variantFlag } from '../../core/remix/manifest';
import type { GameDef } from '../../core/types';
import { worldGraph } from '../graph';
import { type CodeWheelParams, checkWheel, generateWheel, wheelProblems } from '../../core/remix/code-wheel';
import { sampleSeed } from '../remix';

interface Sink {
  err: (where: string, msg: string) => void;
  warn: (where: string, msg: string) => void;
  /** The validator's set flags: the reserved `remix.*` flags are set by the variant. */
  flagsSet: Map<string, string>;
  /** The validator's read flags (conditions), to register only the reserved flags something reads. */
  flagsRead: ReadonlyMap<string, string>;
}

/** Every `{ flag, eq }` condition of the game, as `flag → values read`. */
function flagReads(x: unknown, out = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (Array.isArray(x)) for (const y of x) flagReads(y, out);
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.flag === 'string' && 'eq' in o) {
      const s = out.get(o.flag) ?? new Set<string>();
      s.add(canonicalJson(o.eq));
      out.set(o.flag, s);
    }
    for (const v of Object.values(o)) flagReads(v, out);
  }
  return out;
}

/** Every `{code:<id>}` / `{hint:<id>}` placeholder written in the game's texts. */
function placeholders(x: unknown, out = new Set<string>()): Set<string> {
  if (typeof x === 'string') for (const m of x.matchAll(/\{(?:code|hint):([\w.-]+)\}/g)) out.add(m[1]!);
  else if (Array.isArray(x)) for (const y of x) placeholders(y, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) placeholders(v, out);
  return out;
}

/** Every code wheel of the game (`{ minigame: 'code-wheel' }`) with where it is written. */
function wheels(
  x: unknown,
  where: string,
  out: [Record<string, unknown>, string][] = [],
): [Record<string, unknown>, string][] {
  if (Array.isArray(x)) x.forEach((y, i) => wheels(y, `${where}[${i}]`, out));
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o.minigame === 'code-wheel') out.push([(o.params ?? {}) as Record<string, unknown>, where]);
    for (const [k, v] of Object.entries(o)) wheels(v, `${where}.${k}`, out);
  }
  return out;
}

/** A code wheel's parameters, and a solution for the story seed and 200 sampled seeds (§11.13: one per generated wheel). */
function wheelChecks(game: GameDef, err: Sink['err']): void {
  for (const [params, where] of wheels(game.rooms, 'rooms')) {
    const p = params as unknown as CodeWheelParams;
    const problems = wheelProblems(p);
    if (problems.length) {
      for (const x of problems) err(where, `code-wheel: ${x}`);
      continue;
    }
    for (const seed of ['story', ...Array.from({ length: 200 }, (_, i) => sampleSeed(i))]) {
      const bad = checkWheel(generateWheel(p, typeof p.seed === 'string' ? p.seed : seed));
      if (bad.length) {
        err(where, `code-wheel: the wheel of seed ${seed} has no single solution (${bad.join('; ')})`);
        break;
      }
    }
  }
}

/** Every flag a command sets (`set`, at any depth), with where. */
/** Every minigame the content plays (a `{ minigame }` command), with where. */
function minigamesPlayed(x: unknown, where: string, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(x)) x.forEach((y, i) => minigamesPlayed(y, `${where}[${i}]`, out));
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (typeof o.minigame === 'string' && !out.has(o.minigame)) out.set(o.minigame, where);
    for (const [k, v] of Object.entries(o)) minigamesPlayed(v, `${where}.${k}`, out);
  }
  return out;
}

function setFlags(x: unknown, where: string, out: [string, string][] = []): [string, string][] {
  if (Array.isArray(x)) x.forEach((y, i) => setFlags(y, `${where}[${i}]`, out));
  else if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const f =
      typeof o.set === 'string' ? o.set : Array.isArray(o.set) && typeof o.set[0] === 'string' ? o.set[0] : undefined;
    if (f) out.push([f, where]);
    for (const [k, v] of Object.entries(o)) if (k !== 'remix') setFlags(v, `${where}.${k}`, out);
  }
  return out;
}

export function remixChecks(game: GameDef, s: Sink): void {
  const { err, warn } = s;
  wheelChecks(game, err);
  // 4.1.16: a minigame the content plays writes its result in `minigame.<id>`: a read of it is a read of a set flag
  // (registered only when something reads it, so a minigame nobody asks about warns of nothing).
  const played = minigamesPlayed(
    { rooms: game.rooms, rules: game.rules, scripts: game.scripts, events: game.events, start: game.start.intro },
    'game',
  );
  for (const f of s.flagsRead.keys())
    if (f.startsWith('minigame.') && played.has(f.slice(9)) && !s.flagsSet.has(f))
      s.flagsSet.set(f, played.get(f.slice(9))!);
  // The reserved flags are the world's: a command never sets one (nor does a checkpoint pretend to).
  for (const [f, where] of setFlags(
    { rooms: game.rooms, rules: game.rules, scripts: game.scripts, events: game.events, start: game.start.intro },
    'game',
  ))
    if (f.startsWith('remix.'))
      err(where, `"${f}" is a reserved Remix flag: the world writes it, a command never does`);
    else if (f.startsWith('minigame.'))
      err(where, `"${f}" is a reserved minigame flag: the minigame writes its result, a command never does`);
  const anchorsDeclared = game.rooms.some((r) => r.anchors && Object.keys(r.anchors).length);
  const used = placeholders({ ...game, remix: undefined });
  if (!game.remix) {
    if (anchorsDeclared) warn('remix', 'rooms declare anchors but the game has no `remix` manifest');
    for (const id of used) err('remix', `{code:${id}} / {hint:${id}}: the game declares no coupled dimension "${id}"`);
    return;
  }
  try {
    parseManifest(game.remix);
  } catch (e) {
    err('remix', `the manifest does not match its schema: ${(e as Error).message.split('\n')[0]}`);
    return;
  }
  const unreachable = new Set(worldGraph(game).unreachable);
  for (const r of game.rooms)
    for (const [id, a] of Object.entries(r.anchors ?? {})) {
      const where = `${r.id}.anchors.${id}`;
      if (!r.props?.[a.at] && !r.hotspots?.[a.at] && !r.exits?.[a.at])
        err(where, `"${a.at}" is not a prop or hotspot of ${r.id}`);
      if (unreachable.has(r.id)) err(where, `the anchor is in ${r.id}, a room the start cannot reach`);
      if (a.capacity !== undefined && (!Number.isInteger(a.capacity) || a.capacity < 1))
        err(where, 'capacity is a whole number ≥ 1');
    }
  let c: ReturnType<typeof compileGameManifest>;
  try {
    c = compileGameManifest(game);
  } catch (e) {
    if (e instanceof RemixManifestError) for (const p of e.problems) err('remix', p);
    else err('remix', (e as Error).message);
    return;
  }
  const scripts = new Set([...(game.scripts ?? []), ...game.rooms.flatMap((r) => r.scripts ?? [])].map((x) => x.id));
  const rooms = new Map(game.rooms.map((r) => [r.id, r]));
  const reads = flagReads({ ...game, remix: undefined });
  for (const d of game.remix.dimensions) {
    const where = `remix.${d.id}`;
    if (d.kind === 'item-placement' && !game.items[d.item]) err(where, `unknown item "${d.item}"`);
    if (d.kind === 'actor-start') {
      if (!game.characters[d.actor]) err(where, `unknown character "${d.actor}"`);
      for (const room of d.rooms) {
        const r = rooms.get(room);
        if (!r) err(where, `unknown room "${room}"`);
        else if (!Object.values(r.actors ?? {}).some((a) => a.char === d.actor) && !r.actors?.[d.actor])
          err(where, `${room} has no actor for "${d.actor}": it could not stand there`);
      }
    }
    if (d.kind === 'actor-route')
      for (const id of d.routes) if (!scripts.has(id)) err(where, `route "${id}" is not a script`);
    if (d.kind === 'presentation' && !presentationTargetExists(game, d))
      err(
        where,
        `target "${d.target}" names nothing, or a minigame parameter that may decide a win (line:<id>, prop-img:<room>.<prop>, palette:<character>, minigame:<rule>:<param> for a text or a backdrop)`,
      );
    if (!d.logical) continue;
    // A value away from the story writes `remix.<id>`: some condition should read it, or the world is the story's.
    const flag = d.kind === 'puzzle-order' ? undefined : variantFlag(d.id);
    const domain = c.dims.get(d.id)!.domain;
    const story = canonicalJson(c.dims.get(d.id)!.story);
    if (flag && d.kind !== 'actor-start')
      for (const v of domain) {
        if (canonicalJson(v) === story) continue;
        const written = variantFlags(c, {
          seed: '',
          algorithm: '',
          algorithmVersion: 1,
          manifestHash: '',
          mode: '',
          assignments: { [d.id]: v },
          hash: '',
        })[flag];
        if (!reads.get(flag)?.has(canonicalJson(written)))
          warn(where, `no condition reads ${flag} = ${canonicalJson(written)}: that world plays like the story's`);
      }
    if (d.kind === 'puzzle-order' && !d.groups.some((g) => reads.has(variantFlag(d.id, g))))
      warn(where, `no condition reads ${variantFlag(d.id)}.<group>: every order plays like the story's`);
    // Set by the variant, not by a command: registered where some condition reads them (no "set but never read" noise).
    const own = [variantFlag(d.id), ...(d.kind === 'puzzle-order' ? d.groups.map((g) => variantFlag(d.id, g)) : [])];
    for (const f of own) if (s.flagsRead.has(f)) s.flagsSet.set(f, where);
  }
  for (const id of used)
    if (c.dims.get(id)?.dim.kind !== 'coupled') err('remix', `{code:${id}}: "${id}" is not a coupled dimension`);
  for (const d of game.remix.dimensions)
    if (d.kind === 'coupled' && !used.has(d.id))
      warn(`remix.${d.id}`, 'no text says {code:…} or {hint:…} of this pair: the player is never told');
  for (const m of game.remix.modes)
    if (m.strategy === 'catalogue')
      try {
        if (!catalogue(c, m.id).length) err(`remix.modes.${m.id}`, 'the catalogue has no instance');
      } catch (e) {
        err(`remix.modes.${m.id}`, e instanceof RemixManifestError ? e.problems.join('; ') : (e as Error).message);
      }
}
