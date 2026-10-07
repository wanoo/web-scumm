// Expansion: from a state, every action worth trying, run on the real engine, each one's transition and what it read and wrote (the no-op memo included).

import { Engine, type Source } from '../../core/engine';
import { FakePresenter, MemoryStore } from '../../core/ports';
import { check } from '../../core/cond';
import { cmdLists, eachCmd } from '../../core/cmds';
import { puzzleGraph } from '../puzzle';
import { atomDim, diffDims, independent, readDims, staticTransitions, type RW } from '../por';
import { condAtoms } from '../../core/cond';
import type { GameDef, GameState, Id, Layout, SessionEntry, VerbId } from '../../core/types';
import { compileGame } from '../../core/define';
import { ruleActionId } from '../../core/content-ids';
import { mobilityModel, viewOf } from '../mobility';
import { must } from '../../core/must';
import {
  type Dims,
  MobilityError,
  OwnershipError,
  atomValue,
  canonicalDims,
  poolableItems,
  regionDims,
  stateDims,
  stateKeys,
  valuation,
} from './abstractions';
import type { ExpandStats, Expansion, NodeInput, SolveOptions } from './model';
import { signalTries } from './scenarios';
import { symmetricItems, symmetryDims } from './search/dominance';
import { type SolveProfile, label } from './report';
import { drive } from './drive';

/**
 * Everything one expansion needs, derived from the game and the options alone: the state keys, the abstractions, the
 * memo, a fresh engine per try. Built the same way in the search and in each worker (solve-pool.ts), so an expansion
 * gives the same records wherever it runs; the memo is each one's own (exact: it changes counts, never results).
 */
export function makeExpander(gameIn: GameDef, layouts: Record<string, Layout>, opts: SolveOptions = {}) {
  const mode = opts.mode ?? 'witness';
  const game = compileGame(gameIn) as GameDef;
  const keys0 = new Engine(game, layouts, new FakePresenter(), new MemoryStore(), { commands: opts.commands }); // assigns the keys
  const keys = stateKeys(keys0.game, opts.commands, opts.goal, opts.reality);
  const playerIds = game.players?.ids ?? [game.hero];
  // A goal that reads `{ player }` makes the active character part of the question: no canonical character then.
  // Invariants are checked on every variant of a state instead (each one is a concrete state the player can reach).
  const readsPlayer = JSON.stringify(opts.goal ?? []).includes('"player"');
  const canonical = (opts.canonicalPlayers ?? mode === 'prove') && playerIds.length > 1 && !readsPlayer;
  const canonInfo: SolveProfile['canonical'] = {
    applied: canonical,
    folded: 0,
    explicit: 0,
    ...(playerIds.length > 1 && (opts.canonicalPlayers ?? mode === 'prove') && readsPlayer
      ? { reason: 'the goal reads { player }' }
      : {}),
  };
  const shared = !!game.players?.sharedInventory;
  const model0 = (opts.mobility ?? mode === 'prove') ? mobilityModel(game, keys.visitedRead, opts.goal) : null;
  // A game where no move can ever be silent (every room has an onEnter, or is named by a condition): no regions.
  const model = model0 && !model0.trivial ? model0 : null;
  const mobInfo: SolveProfile['mobility'] = {
    applied: !!model,
    moves: 0,
    largest: model ? 0 : 1,
    ...(model0?.trivial ? { reason: 'no move of this game can be silent' } : {}),
  };
  // The canonical owner: needs the canonical character (the pool replaces who holds what) and the regions (meeting).
  const poolable = (opts.ownership ?? mode === 'prove') && canonical && model ? poolableItems(game, opts.goal) : null;
  const pool = poolable?.items.size ? poolable.items : null;
  const ownInfo: NonNullable<SolveProfile['ownership']> = {
    applied: !!pool,
    items: [...(pool ?? [])].sort(),
    handovers: 0,
    ...(pool
      ? {}
      : {
          reason:
            opts.ownership === false
              ? 'turned off'
              : !canonical
                ? 'no canonical character'
                : !model
                  ? 'no mobility regions'
                  : (poolable?.reason ?? 'off for a witness'),
        }),
  };
  /**
   * Every two playable characters can meet without changing anything (their regions share a room): whoever holds a
   * pooled item can bring it to whoever needs it. Read from the regions only, never the exact rooms, so a silent move
   * inside a region does not change it (mobility checks that). A state where two cannot meet keeps who holds what.
   */
  const meeting = (st: GameState, p: Id, q: Id): Id | undefined => {
    const a = model!.region(viewOf(st, p, game.hero, shared)).rooms,
      b = new Set(model!.region(viewOf(st, q, game.hero, shared)).rooms);
    return a.find((r) => b.has(r));
  };
  /**
   * The pooling groups (3.6): the characters split by who can meet whom, a group kept only when every two of its
   * members can (then any of them can hand a pooled item to any other). 3.5 pooled only when all of them could.
   */
  const groupsOf = (st: GameState): Id[][] => {
    if (!pool || !model) return [];
    const left = [...playerIds],
      out: Id[][] = [];
    while (left.length) {
      const g = [left.shift()!];
      for (let i = 0; i < g.length; i++) {
        const gi = must(g[i], 'group member');
        for (let j = left.length - 1; j >= 0; j--)
          if (meeting(st, gi, must(left[j], 'ungrouped player')) !== undefined) g.push(...left.splice(j, 1));
      }
      if (g.length > 1 && g.every((p, i) => g.every((q, j) => j <= i || meeting(st, p, q) !== undefined)))
        out.push(g.sort());
    }
    return out.sort((a, b) => (must(a[0], 'group head') < must(b[0], 'group head') ? -1 : 1));
  };
  const baseDims = (st: GameState): Dims =>
    canonical
      ? canonicalDims(stateDims(st, keys), st, keys, game.hero, shared, pool, groupsOf(st))
      : stateDims(st, keys);
  // Symmetric items (4.1.13, search/dominance.ts): asked for only; a state and its swapped twin get the same dims.
  // Read on the game as written: compiling gives each rule an id from its place, which would tell twins apart.
  const symClasses = opts.symmetry ? symmetricItems(gameIn, opts.goal) : [];
  const symInfo: NonNullable<SolveProfile['symmetry']> = {
    applied: symClasses.length > 0,
    classes: symClasses,
    ...(opts.symmetry
      ? symClasses.length
        ? {}
        : { reason: 'no two items the game treats alike' }
      : { reason: 'not asked for (--symmetry)' }),
  };
  const regionOf = (st: GameState): Dims =>
    model ? regionDims(baseDims(st), st, model, game.hero, shared) : baseDims(st);
  const dimsOf = (st: GameState): Dims => (symClasses.length ? symmetryDims(regionOf(st), symClasses) : regionOf(st));
  const stats: ExpandStats = {
    itemsInRules: new Set(),
    itemsSeen: new Set(),
    flags: new Set(),
    gained: new Set(),
    roomsReached: new Set(),
    attempted: new Map(),
    perAction: new Map(),
    fallbackByRoom: new Map(),
    n: { memoHits: 0, memoStored: 0, memoVerified: 0, memoRefused: 0, tries: 0, skipped: 0, slept: 0, noops: 0 },
    timing: { tries: 0, engine: 0, clone: 0, run: 0, hash: 0, queue: 0, other: 0, classify: 0 },
    canon: { folded: 0, explicit: 0 },
    mob: { moves: 0, largest: model ? 0 : 1 },
    own: { handovers: 0 },
  };
  const {
    timing,
    n: cnt,
    attempted,
    perAction,
    fallbackByRoom,
    itemsInRules,
    flags,
    gained,
    roomsReached,
    itemsSeen,
  } = stats;
  const now = () => performance.now();
  const timed = <T>(k: keyof SolveProfile['timing'], f: () => T): T => {
    const t = now();
    try {
      return f();
    } finally {
      timing[k] += now() - t;
    }
  };
  const randomBranchValues = [
    ...new Set(
      cmdLists(game).flatMap(({ list }) => {
        const sizes: number[] = [];
        eachCmd(list, (c) => {
          if (typeof c !== 'string' && 'random' in c && c.random.length) sizes.push(c.random.length);
        });
        return sizes.flatMap((n) => Array.from({ length: n }, (_, i) => (i + 0.5) / n));
      }),
    ),
  ].sort((a, b) => a - b);
  const makeEngine = (rnd: number[] = []) => {
    const t = now();
    const ui = new FakePresenter();
    const e = new Engine(game, layouts, ui, new MemoryStore(), { commands: opts.commands });
    timing.engine += now() - t;
    const draws = [...rnd];
    e.random = () => draws.shift() ?? 0;
    return { e, ui };
  };
  // A goal can read the active character's bag or room (`{ has }`, `{ room }`). With the canonical character, a state
  // reaches the goal when any character, seen as active, meets it: switching to that one is silent.
  const goalHolds = (s: GameState) =>
    !!opts.goal &&
    (opts.goal.every((c) => check(c, s)) ||
      (canonical &&
        playerIds.some(
          (p) => p !== (s.active ?? game.hero) && opts.goal!.every((c) => check(c, viewOf(s, p, game.hero, shared))),
        )));
  const reached = (ui: FakePresenter, s: GameState) => (opts.goal ? goalHolds(s) : s.done || ui.log.includes('ENDING'));
  // A reduction must not remove a losing branch from a proof. Keep proof mode deliberately conservative until the
  // reductions themselves have a model-equivalence proof.
  const por = mode === 'prove' && !opts.unsafeReduction ? false : (opts.por ?? false);
  const memoOn = !por && opts.memo !== false;
  const memoEvery = Math.max(1, opts.memoVerify ?? 16);
  type Memo = {
    vals: [string, string][];
    ran: string[];
    src: Source | null | void;
    asked: FakePresenter['asked'];
    drawn: number[];
  };
  const memo = new Map<string, Memo[]>();
  // A write the state's dimensions never show (a flag nobody else reads, a counter of a line list): whatever its
  // value, the hash is the same.
  const hidden = (writes: Set<string>) => {
    for (const w of writes) {
      const i = w.indexOf(':');
      const kind = w.slice(0, i),
        id = w.slice(i + 1);
      if (
        kind === 'flag'
          ? keys.live.flags.has(id)
          : kind === 'seen'
            ? keys.seenRead.has(id) || id.startsWith('event.')
            : kind === 'once'
              ? keys.once.has(id)
              : kind === 'nth'
                ? keys.nth.has(id)
                : kind === 'random'
                  ? keys.random.has(id)
                  : kind === 'script'
                    ? keys.live.actions.has(id)
                    : true
      )
        return false;
    }
    return true;
  };
  const stx = por === 'stubborn' ? staticTransitions(puzzleGraph(game, { commands: opts.commands })) : null;

  /** Every try from one node, run on the real engine. Reads nothing of the search (no `seen`, no frontier). */
  async function expandNode(input: NodeInput): Promise<Expansion> {
    const s = input.state;
    const tTries = now(),
      engineBefore = timing.engine,
      cloneBefore = timing.clone,
      runBefore = timing.run;
    const exp: Expansion = {
      records: [],
      txs: [],
      progressed: false,
      tries: 0,
      effective: 0,
      byVerb: {},
      broken: [],
      errors: [],
    };
    // List of actions to try
    // `picks`: the answers given to the choices met on the way (a topic index first, then nested `choice` prompts);
    // whatever is not given defaults to the last option. After a run, every other option of a prompt is a new try.
    type Try = {
      label: string;
      run: (e: Engine) => Promise<Source | null | void>;
      items: string[];
      picks: number[];
      rnd: number[];
      pair?: true /** The content actions that could answer (puzzle graph ids). */;
      candidates: string[];
      /** Another character's view or another room of the region: the state the try starts from, and the session entries that led there (played once). */
      base?: GameState;
      pre?: SessionEntry[] /** The variant's label prefix (`Switch to X › `): the memo keys the action without it. */;
      prefix?: string;
    };
    const keyOf = (t: Try) => `${t.label}|p=${t.picks.join(',')}|r=${t.rnd.join(',')}`;
    const tries: Try[] = [];
    const tryKeys = new Set<string>();
    const addTry = (t: Try) => {
      const k = keyOf(t);
      if (!tryKeys.has(k)) {
        tryKeys.add(k);
        tries.push(t);
      }
    };
    const brokenHere = (st: GameState, suffix: string[]) =>
      (game.invariants ?? []).forEach((c, i) => {
        if (check(c, st)) exp.broken.push({ invariant: i, suffix });
      });
    // The canonical character: the same state seen from each other character it can switch to without changing
    // anything the solver reads (`canonicalPlayers`); their actions are tried from here, prefixed by the switch.
    const h0 = JSON.stringify(input.dims);
    const variants: { st: GameState; via?: Id; pre?: SessionEntry[]; prefix?: string }[] = [{ st: s }];
    const explicitSwitch: Id[] = [];
    if (canonical)
      for (const pid of playerIds) {
        if (pid === (s.active ?? game.hero)) continue;
        const { e } = makeEngine();
        e.state = timed('clone', () => structuredClone(s));
        try {
          await drive(e, e.switchTo(pid), () => {});
        } catch {
          explicitSwitch.push(pid);
          continue;
        }
        if (JSON.stringify(dimsOf(e.state)) === h0) {
          variants.push({ st: e.state, via: pid, pre: e.session?.log ?? [], prefix: `Switch to ${pid} › ` });
          stats.canon.folded++;
          brokenHere(e.state, [`Switch to ${pid}`]);
        } else {
          explicitSwitch.push(pid);
          stats.canon.explicit++;
        }
      }
    // Mobility regions: each character's view, in every room of its region. The route there is played once, each
    // hop checked (arrives, changes nothing the solver reads); the tries of that room start from where it ends.
    const placed: { st: GameState; via?: Id; pre?: SessionEntry[]; prefix?: string; region?: Id[] }[] = [];
    for (const v of variants) {
      // What a character's view reaches is reached (the explicit search would switch to it, or walk there): the room
      // reports and the lint's `room-never-reached` must not depend on the abstractions (tests/audit.test.ts).
      v.st.inventory.forEach((i) => itemsSeen.add(i));
      if (!model) {
        placed.push(v);
        roomsReached.add(v.st.room);
        continue;
      }
      const R = model.region(v.st);
      stats.mob.largest = Math.max(stats.mob.largest, R.rooms.length);
      for (const r of R.rooms) {
        roomsReached.add(r);
        if (r === v.st.room) {
          placed.push({ ...v, region: R.rooms });
          continue;
        }
        const { e } = makeEngine();
        e.state = timed('clone', () => structuredClone(v.st));
        const tRun = now();
        try {
          for (const h of R.route(r)) {
            await drive(e, h.kind === 'exit' ? e.act({ verb: h.verb, a: h.a }) : e.travel(h.place), () => {});
            if (e.state.room !== h.to)
              throw new MobilityError(`a silent move from ${h.from} to ${h.to} did not arrive (in ${e.state.room})`);
            if (JSON.stringify(dimsOf(e.state)) !== h0)
              throw new MobilityError(`moving from ${h.from} to ${h.to} changed something the solver reads`);
          }
        } finally {
          timing.run += now() - tRun;
        }
        placed.push({
          st: e.state,
          via: v.via,
          pre: [...(v.pre ?? []), ...(e.session?.log ?? [])],
          prefix: `${v.prefix ?? ''}Go to ${r} › `,
          region: R.rooms,
        });
        stats.mob.moves++;
      }
    }
    // The canonical owner: the character whose actions are tried gets the pool first. For each other holder: where they
    // meet (here when the holder can walk here, else a room both regions share, the character going there and coming
    // back), the holder switches in, walks there, hands its pooled items over, and the controls come back. Every step is
    // played on the engine and must leave the state as the search sees it.
    if (pool)
      for (let vi = 0; vi < placed.length; vi++) {
        const v = must(placed[vi], 'placed start');
        const me = v.st.active ?? game.hero;
        const mine = groupsOf(v.st).find((g) => g.includes(me));
        if (!mine) continue;
        const holders = mine.filter(
          (q) => q !== me && viewOf(v.st, q, game.hero, shared).inventory.some((i) => pool.has(i)),
        );
        if (!holders.length) continue;
        const { e } = makeEngine();
        e.state = timed('clone', () => structuredClone(v.st));
        const same = (what: string) => {
          if (JSON.stringify(dimsOf(e.state)) !== h0)
            throw new OwnershipError(`${what} changed something the solver reads`);
        };
        const walk = async (who: Id, to: Id) => {
          for (const h of model!.region(e.state).route(to)) {
            await drive(e, h.kind === 'exit' ? e.act({ verb: h.verb, a: h.a }) : e.travel(h.place), () => {});
            if (e.state.room !== h.to)
              throw new OwnershipError(`${who} walking to ${to} did not arrive (in ${e.state.room})`);
            same(`${who} walking from ${h.from} to ${h.to}`);
          }
        };
        const tRun = now();
        try {
          for (const q of holders) {
            const here = model!.region(viewOf(e.state, q, game.hero, shared)).rooms.includes(v.st.room);
            const at = here ? v.st.room : meeting(e.state, me, q)!;
            if (at !== e.state.room) await walk(me, at);
            await drive(e, e.switchTo(q), () => {});
            if ((e.state.active ?? game.hero) !== q) throw new OwnershipError(`switching to ${q} did not happen`);
            same(`switching to ${q}`);
            await walk(q, at);
            for (const it of e.state.inventory.filter((i) => pool.has(i))) {
              const before = viewOf(e.state, me, game.hero, shared).inventory.filter((i) => i === it).length;
              await drive(e, e.act({ verb: 'give', a: it, b: me }), () => {});
              if (viewOf(e.state, me, game.hero, shared).inventory.filter((i) => i === it).length !== before + 1)
                throw new OwnershipError(`${q} giving ${it} to ${me} did not hand it over`);
              same(`${q} giving ${it} to ${me}`);
            }
            await drive(e, e.switchTo(me), () => {});
            same(`switching back to ${me}`);
            if (e.state.room !== v.st.room) await walk(me, v.st.room);
          }
        } finally {
          timing.run += now() - tRun;
        }
        if (e.state.room !== v.st.room || (e.state.active ?? game.hero) !== me)
          throw new OwnershipError(`the hand-overs did not leave ${me} where it was`);
        placed[vi] = {
          ...v,
          st: e.state,
          pre: [...(v.pre ?? []), ...(e.session?.log ?? [])],
          prefix: `${v.prefix ?? ''}Pool to ${me} › `,
        };
        stats.own.handovers++;
      }
    for (const variant of placed) {
      const s = variant.st;
      const add = (t: Try) =>
        addTry(
          variant.prefix
            ? { ...t, label: `${variant.prefix}${t.label}`, base: variant.st, pre: variant.pre, prefix: variant.prefix }
            : t,
        );
      // Inside a region, its silent exits and map trips are the macro moves above, not tries of their own.
      const silentExits = new Set(
        model && variant.region
          ? model
              .hops(s, s.room)
              .filter((h) => h.kind === 'exit' && variant.region!.includes(h.to))
              .map((h) => (h as { a: Id }).a)
          : [],
      );
      const regionRooms = new Set(variant.region ?? []);
      const probe = makeEngine().e;
      probe.state = timed('clone', () => structuredClone(s));
      const room = probe.room();
      const targets = probe.targets(room);
      const inv = s.inventory;
      const verbs = game.verbs.map((v) => v.id) as VerbId[];
      // An action no written rule can answer (whatever the conditions) falls to a look line, a kind reaction or the
      // fallback line: nothing changes, so the engine is not even run. The exceptions that do change something without
      // a rule: talking to the hint item, giving to another playable character (the topics are tries of their own).
      const rules = [
        ...(room.on ?? []).map((r, i) => ({ r, id: ruleActionId(room.id, i, r) })),
        ...(game.rules.on ?? []).map((r, i) => ({ r, id: ruleActionId('game', i, r) })),
      ];
      const hasId = (x: Id | Id[] | undefined, v: Id | undefined) =>
        x === undefined ? v === undefined : v !== undefined && (Array.isArray(x) ? x.includes(v) : x === v);
      const answers = (v: VerbId, a: Id, b?: Id) =>
        rules
          .filter(
            ({ r }) =>
              (Array.isArray(r.verb) ? r.verb.includes(v) : r.verb === v) &&
              ((hasId(r.a, a) && hasId(r.b, b)) ||
                (!!b && inv.includes(a) && inv.includes(b) && hasId(r.a, b) && hasId(r.b, a))),
          )
          .map((x) => x.id);
      const answered = (v: VerbId, a: Id, b?: Id) => answers(v, a, b).length > 0;
      const fb = fallbackByRoom.get(s.room) ?? { candidates: 0, rules: 0, fallback: 0 };
      fallbackByRoom.set(s.room, fb);
      for (const t of [...targets, ...inv])
        for (const v of verbs) {
          if (v === 'talk' && room.talk?.[t]) continue; // handled by topics
          if (silentExits.has(t)) continue;
          if (!answered(v, t) && !(v === 'talk' && t === game.hintItem && inv.includes(t))) {
            cnt.skipped++;
            continue;
          }
          add({
            label: label(game, { verb: v, a: t }),
            run: (e) => e.act({ verb: v, a: t }),
            items: inv.includes(t) ? [t] : [],
            picks: [],
            rnd: [],
            candidates: answers(v, t),
          });
        }
      for (const it of inv)
        for (const t of [...targets, ...inv.filter((x) => x !== it)])
          for (const v of ['use', 'give'] as VerbId[]) {
            if (v === 'give' && inv.includes(t)) continue;
            fb.candidates++;
            if (!answered(v, it, t) && !(v === 'give' && probe.isPlayer(t) && t !== probe.heroId())) {
              fb.fallback++;
              cnt.skipped++;
              continue;
            }
            add({
              label: label(game, { verb: v, a: it, b: t }),
              run: (e) => e.act({ verb: v, a: it, b: t }),
              items: inv.includes(t) ? [it, t] : [it],
              picks: [],
              rnd: [],
              pair: true,
              candidates: answers(v, it, t),
            });
          }
      for (const [actor, topics] of Object.entries(room.talk ?? {})) {
        if (!targets.includes(actor)) continue;
        // the engine numbers visible topics: the label must follow the same list (otherwise the printed path would lie)
        topics
          .map((tp, orig) => ({ tp, orig }))
          .filter(({ tp }) => check(tp.if, s, room.id))
          .forEach(({ tp, orig }, i) =>
            add({
              label: `Talk ${actor}: "${tp.topic}"`,
              run: (e) => e.act({ verb: 'talk', a: actor }),
              items: [],
              picks: [i],
              rnd: [],
              candidates: [`topic:${tp.id ?? `${room.id}/${actor}[${orig}]`}`],
            }),
          );
      }
      for (const [pid, p] of Object.entries(game.map?.places ?? {})) {
        if (
          !s.unlocked.includes(pid) ||
          p.room === s.room ||
          !game.rooms.some((r) => r.id === p.room) ||
          regionRooms.has(p.room)
        )
          continue;
        add({ label: `Map → ${p.name}`, run: (e) => e.travel(pid), items: [], picks: [], rnd: [], candidates: [] });
      }
      // Several playable characters: taking control of another one.
      for (const pid of probe.playerIds())
        if (pid !== probe.heroId() && (!canonical || explicitSwitch.includes(pid)))
          add({
            label: `Switch to ${pid}`,
            run: (e) => e.switchTo(pid).then(() => undefined),
            items: [],
            picks: [],
            rnd: [],
            candidates: [],
          });
      // The world's scripts: letting one run until its next wait (or its end) is something the player can do by waiting.
      for (const sc of probe.scriptsHere()) {
        const st = s.scripts?.[sc.id];
        if (st?.done || st?.off || !keys.live.actions.has(sc.id)) continue;
        add({
          label: `Script ${sc.id}`,
          run: (e) => e.runScript(sc.id, true).then(() => undefined),
          items: [],
          picks: [],
          rnd: [],
          candidates: [`script:${sc.id}`],
        });
      }
      // Signals from the world outside (4.1.1): what can arrive now, under the search's policy (solve/scenarios.ts).
      for (const t of signalTries(game, opts.reality, s)) add({ ...t, items: [], picks: [], rnd: [] });
    }

    timing.tries +=
      now() - tTries - (timing.engine - engineBefore) - (timing.clone - cloneBefore) - (timing.run - runBefore);
    const only = input.only;
    // The effective actions tried here so far, with what they read and wrote: the later ones sleep them in their children.
    const done: { key: string; rw: RW }[] = [];
    // What a run leaves besides its state: other answers to its prompts and draws (new tries), what answered it.
    const expand = (t: Try, asked: FakePresenter['asked'], drawn: number[]) => {
      // Other answers to every nested `choice` prompt. There is deliberately no hidden variant ceiling: maxStates is
      // the one explicit search budget, and reaching it returns `truncated`.
      for (let j = t.picks.length; j < asked.length; j++) {
        const q = must(asked[j], 'asked prompt');
        if (q.topic || q.n < 2) continue;
        const prefix = [...t.picks, ...asked.slice(t.picks.length, j).map((a) => a.n - 1)];
        for (let o = 0; o < q.n - 1; o++) {
          const base = t.label.replace(/ › ".*$/, '');
          const chosen = [...prefix.slice(t.picks.length), o].map(
            (pick, k) => must(asked[t.picks.length + k], 'asked prompt').texts[pick],
          );
          addTry({ ...t, label: `${base} › ${chosen.map((x) => `"${x}"`).join(' › ')}`, picks: [...prefix, o] });
        }
      }
      // The engine records every random draw in the session. Expand every newly observed draw with representative
      // values for every random block arity in the game; state hashing removes duplicates. This explores nested
      // random blocks just like nested dialogue choices, instead of forcing branch zero.
      for (let j = t.rnd.length; j < drawn.length; j++) {
        const prefix = [...t.rnd, ...drawn.slice(t.rnd.length, j)];
        for (const value of randomBranchValues) if (value !== drawn[j]) addTry({ ...t, rnd: [...prefix, value] });
      }
    };
    const countAnswer = (t: Try, src: Source | null | void, room: Id) => {
      if (src === 'rule' || src === 'hint') t.items.forEach((i) => itemsInRules.add(i));
      if (t.pair) {
        const fb = fallbackByRoom.get(room);
        if (fb) {
          if (src === 'rule') fb.rules++;
          else if (src === 'fallback') fb.fallback++;
        }
      }
    };
    // A memo hit: the try is a no-op here, as it was where it was kept. Its prompts, draws and answers count the same.
    const replayNoop = (t: Try, m: Memo, room: Id) => {
      expand(t, m.asked, m.drawn);
      countAnswer(t, m.src, room);
      for (const id of m.ran) attempted.set(id, (attempted.get(id) ?? 0) + 1);
    };
    for (let ti = 0; ti < tries.length; ti++) {
      const t = must(tries[ti], 'try');
      const key = keyOf(t);
      if (por === 'sleep' && input.sleep.has(key)) {
        cnt.slept++;
        exp.progressed = true;
        continue;
      }
      if (only && !only.has(key)) continue;
      const mk =
        t.prefix && t.label.startsWith(t.prefix) ? keyOf({ ...t, label: t.label.slice(t.prefix.length) }) : key;
      const from = t.base ?? s;
      const hit = memoOn ? memo.get(mk)?.find((m) => m.vals.every(([k, v]) => atomValue(from, k) === v)) : undefined;
      let verify: Memo | undefined;
      if (hit) {
        cnt.memoHits++;
        if (cnt.memoHits % memoEvery) {
          replayNoop(t, hit, s.room);
          cnt.noops++;
          continue;
        }
        verify = hit;
      }
      cnt.tries++;
      const { e, ui } = makeEngine(t.rnd);
      e.state = timed('clone', () => structuredClone(from));
      if (por || memoOn) e.reads = new Set();
      if (memoOn) e.writes = new Set();
      ui.picks = [...t.picks];
      const path: string[] = []; // this step's tutorial moves, then its label
      let src: Source | null | void = null;
      const tRun = now();
      try {
        await drive(
          e,
          t.run(e).then((r) => {
            src = r;
          }),
          (a) => path.push(`(tutorial) ${label(game, a)}`),
        );
      } catch (err) {
        if (err instanceof MobilityError) throw err;
        exp.errors.push(`${t.label} (${s.room}): ${(err as Error).message}`);
        continue;
      } finally {
        timing.run += now() - tRun;
      }
      const drawn = (e.session?.log ?? []).flatMap((entry) => entry.rnd ?? []);
      expand(t, ui.asked, drawn);
      countAnswer(t, src, s.room);
      // Reported even when the state is not worth exploring (a flag nobody reads, a trinket no gate needs): it did happen.
      Object.entries(e.state.flags).forEach(([k, v]) => v && flags.add(k));
      e.state.inventory.forEach((i) => gained.add(i));
      // What answered this try, even when nothing changed: a topic that only talks is reachable all the same.
      for (const en of e.session?.log ?? [])
        for (const id of en.ran ?? []) attempted.set(id, (attempted.get(id) ?? 0) + 1);
      const tHash = now();
      const dims = dimsOf(e.state);
      const h = JSON.stringify(dims);
      timing.hash += now() - tHash;
      const hitGoal = reached(ui, e.state);
      const rw: RW | null = por ? { reads: readDims(e.reads!), writes: diffDims(input.dims, dims) } : null;
      if (verify) {
        cnt.memoVerified++;
        if (h !== h0 || !hidden(e.writes!))
          exp.errors.push(
            `${t.label} (${s.room}): the no-op memo skipped a try that ${h !== h0 ? 'changes the state' : 'writes what the solver hashes'} here (the engine's read trace is incomplete)`,
          );
      }
      if (h === h0 && memoOn && !verify) {
        const vals = hidden(e.writes!) ? valuation(from, e.reads!) : null;
        if (vals) {
          const list = memo.get(mk) ?? (memo.set(mk, []), memo.get(mk)!);
          if (list.length < 64) {
            list.push({ vals, ran: (e.session?.log ?? []).flatMap((en) => en.ran ?? []), src, asked: ui.asked, drawn });
            cnt.memoStored++;
          }
        } else cnt.memoRefused++;
      }
      if (h === h0) {
        cnt.noops++;
        if (hitGoal) exp.records.push({ key, label: t.label, h, hitGoal, noop: true });
        if (stx && rw) {
          // A transition a condition holds back: what it would change, and the gates that hold it, from the content.
          const cands = t.candidates.map((c) => stx.byId.get(c)).filter((x) => !!x);
          cands.forEach((c) => c.writes.forEach((w) => rw.writes.add(w)));
          if (rw.writes.size)
            exp.txs.push({
              key,
              enabled: false,
              rw,
              candidates: t.candidates,
              gates: cands.map((c) => c.gates),
              visible: false,
            });
        }
        continue;
      }
      exp.progressed = true;
      exp.effective++;
      const verb = must(t.label.split(' ')[0], 'verb');
      exp.byVerb[verb] = (exp.byVerb[verb] ?? 0) + 1;
      for (const en of e.session?.log ?? [])
        for (const id of en.ran ?? []) perAction.set(id, (perAction.get(id) ?? 0) + 1);
      const sleep = new Map<string, RW>();
      if (por === 'sleep' && rw) {
        for (const [k, r] of input.sleep) if (independent(r, rw)) sleep.set(k, r);
        for (const d of done) if (independent(d.rw, rw)) sleep.set(d.key, d.rw);
        done.push({ key, rw });
      }
      if (stx && rw)
        exp.txs.push({
          key,
          enabled: true,
          rw,
          candidates: t.candidates,
          gates: [],
          visible: [...rw.writes].some((w) => goalDims.has(w)),
        });
      const state = timed('clone', () => structuredClone(e.state));
      exp.records.push({
        key,
        label: t.label,
        h,
        hitGoal,
        noop: false,
        dims,
        state,
        path: [...path, t.label],
        tailSteps: [...(t.pre ?? []), ...(e.session?.log ?? [])],
        rw,
        sleep,
      });
      // A witness ends at its first goal (one never seen before: a seen goal would have ended the search already).
      if (hitGoal && mode === 'witness') break;
    }
    exp.tries = tries.length;
    return exp;
  }

  // What the search looks for: an action that changes it is never postponed by the reduction.
  const goalDims = new Set<string>(['done', ...(opts.goal ?? []).flatMap((c) => condAtoms(c).map(atomDim))]);
  return {
    game,
    mode,
    keys,
    playerIds,
    canonical,
    canonInfo,
    model,
    mobInfo,
    ownInfo,
    symInfo,
    dimsOf,
    makeEngine,
    reached,
    goalHolds,
    por,
    memoOn,
    stx,
    stats,
    timed,
    now,
    expandNode,
  };
}
