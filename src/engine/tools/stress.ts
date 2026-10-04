// A generated game of any size, for the benchmark (tools/bench.ts) and the tests: a solvable chain of rooms where each
// room's item opens the next room's lock, playable characters that take over at chapter boundaries, patrolling
// characters with events, ambient scripts, topics, extra items and flags, artificial save migrations, chapter goals
// and invariants. No art: layouts are rectangles. Deterministic: the same options give the same game.
import type { Cond, GameDef, Id, Layout, Migration, RoomDef, ScriptDef } from '../core/types';
import { assignIds } from '../core/content-ids';

export interface StressOptions {
  rooms?: number; players?: number; items?: number; flags?: number; npcs?: number; scripts?: number; topics?: number;
  /** Number of chapters (checkpoints with goals); default: one per player. */
  chapters?: number;
  migrations?: number;
  /** Schema 3: every rule, topic, listener, block and script step gets a stable id (`assignIds`), as a real v3 game. */
  schemaVersion?: 2 | 3;
  /**
   * Each playable character confined to its own era (the 3.3 reference game): no door between two eras, the item
   * that opens the next era's first lock goes through a time chute (`{ transfer }` to the next character). Without
   * it, every character can walk the whole chain and pick up anyone's items: the worst case for the proof.
   */
  eras?: boolean;
  /** With `eras`: a trash can in the first room destroys item 0, a reachable softlock (the negative reference). */
  softlock?: boolean;
}

export function makeStressGame(o: StressOptions = {}): { game: GameDef; layouts: Record<string, Layout> } {
  const N = Math.max(3, o.rooms ?? 40);
  const P = Math.max(1, Math.min(o.players ?? 3, N - 1));
  const npcs = Math.max(0, Math.min(o.npcs ?? 5, Math.floor(N / 2)));
  const extras = Math.max(0, (o.items ?? 30) - (N - 1));
  const topics = o.topics ?? 40;
  const chapters = Math.max(1, Math.min(o.chapters ?? P, N - 1));
  const migrations = o.migrations ?? 10;
  const boundary = (k: number) => Math.floor((k * N) / P); // the room where player k starts and takes over
  const takerOf = (i: number) => { let k = 0; for (let j = 1; j < P; j++) if (boundary(j) === i) k = j; return k; };
  const eras = !!o.eras && P > 1;
  /** The room where an era starts (a wall before it), and the character who lives there. */
  const eraStart = new Map<number, number>([...Array(P).keys()].slice(1).map((k) => [boundary(k), k]));
  const eraOf = (i: number) => [...Array(P).keys()].filter((k) => boundary(k) <= i).pop() ?? 0;
  const rid = (i: number) => `r${i}`;
  const item = (i: number) => `item_${i}`;

  const characters: GameDef['characters'] = {};
  for (let k = 0; k < P; k++) characters[`p${k}`] = { name: `Player ${k}`, color: '#fff', sprites: { idle: [`p${k}/1`] } };
  for (let k = 0; k < npcs; k++) characters[`npc${k}`] = { name: `Walker ${k}`, color: '#0f0', room: rid(2 * k), sprites: { idle: [`n${k}/1`] } };

  const items: GameDef['items'] = {};
  for (let i = 0; i < N - 1; i++) items[item(i)] = { name: `item ${i}`, icon: `i/${i}`, look: `Item ${i}, from room ${i}.` };
  for (let j = 0; j < extras; j++) items[`extra_${j}`] = { name: `trinket ${j}`, icon: `e/${j}`, look: `Trinket ${j}.` };

  const rooms: RoomDef[] = [];
  const layouts: Record<string, Layout> = {};
  let topicCount = 0, flagCount = 0;
  const scripts: ScriptDef[] = [];
  for (let i = 0; i < N; i++) {
    const r: RoomDef = { id: rid(i), name: `Room ${i}`, decor: `d/${i}`, hotspots: {}, look: {}, on: [], exits: {}, hints: [] };
    const lay: Layout = { entries: { default: [320, 360], from_prev: [60, 360], from_next: [580, 360] }, walk: { area: [[20, 300], [620, 300], [620, 395], [20, 395]] }, hotspots: {}, actors: {} };
    let hx = 40;
    const spot = (id: Id, name: string) => { r.hotspots![id] = { name }; lay.hotspots![id] = { rect: [hx, 120, 60, 60] }; hx += 80; };
    // The thing of the room: its item, taken once (by the player who takes over here).
    if (i < N - 1) {
      spot('thing', `thing ${i}`);
      r.look!.thing = [`Thing ${i}.`, `Still thing ${i}.`];
      const taker = takerOf(i);
      const cond: Cond[] = [`!got_${i}`];
      if (taker > 0 && boundary(taker) === i) cond.push({ player: `p${taker}` });
      r.on!.push({ verb: 'take', a: 'thing', if: cond.length > 1 ? { all: cond } : cond[0], do: [{ gain: item(i) }, { set: `got_${i}` }, `Got item ${i}.`] });
      if (taker > 0 && boundary(taker) === i) r.on!.push({ verb: 'take', a: 'thing', if: `!got_${i}`, do: [`Only Player ${taker} can take this.`] });
      r.on!.push({ verb: 'look', a: 'thing', if: `!looked_${i}`, do: [{ set: `looked_${i}` }, `Noted thing ${i}.`] });
      flagCount += 2;
    }
    // The lock of the room: the previous room's item opens the way on (or ends the game in the last room).
    if (i >= 1) {
      spot('lock', `lock ${i}`);
      r.look!.lock = `Lock ${i}.`;
      r.on!.push({ verb: 'use', a: item(i - 1), b: 'lock', if: `!opened_${i}`, do: [{ lose: item(i - 1) }, { set: `opened_${i}` }, { sfx: 'click' }, ...(i === N - 1 ? [{ end: true } as const] : [`Lock ${i} opens.`])] });
      flagCount++;
      r.hints!.push({ until: `opened_${i}`, lines: [`Item ${i - 1} fits lock ${i}.`] });
    }
    // In eras mode, the last room of an era has a time chute to the next one instead of a door.
    if (eras && eraStart.has(i + 1)) {
      const k = eraStart.get(i + 1)!;
      spot('timechute', 'time chute');
      r.look!.timechute = 'A time chute.';
      r.on!.push({ verb: 'use', a: item(i), b: 'timechute', if: `!sent_${i}`, do: [{ transfer: [item(i), `p${k}`] }, { set: `sent_${i}` }, `Item ${i} goes through time to Player ${k}.`] });
      flagCount++;
    }
    if (eras && o.softlock && i === 0) {
      spot('trash', 'trash can');
      r.look!.trash = 'A trash can.';
      r.on!.push({ verb: 'use', a: item(0), b: 'trash', do: [{ lose: item(0) }, 'Oops. Item 0 is gone for good.'] });
    }
    if (i < N - 1 && !(eras && eraStart.has(i + 1))) { r.exits!.next = { name: `way to room ${i + 1}`, to: rid(i + 1), entry: 'from_prev', ...(i >= 1 ? { if: `opened_${i}`, locked: `Lock ${i} holds the door.` } : {}) }; lay.hotspots!.next = { rect: [560, 200, 60, 80] }; }
    if (i >= 1 && !(eras && eraStart.has(i))) { r.exits!.prev = { name: `way back to room ${i - 1}`, to: rid(i - 1), entry: 'from_next' }; lay.hotspots!.prev = { rect: [20, 200, 60, 80] }; }
    // A shortcut back every 7 rooms, one way (forward, it would skip the locks).
    if (i % 7 === 6 && i - 3 >= 0 && !(eras && eraOf(i - 3) !== eraOf(i))) { r.exits!.chute = { name: 'chute', to: rid(i - 3), oneWay: true }; lay.hotspots!.chute = { rect: [300, 200, 40, 40] }; }
    // Extra items: a trinket to take and a bin to drop it in, in rooms along the way.
    const ex = [...Array(extras).keys()].filter((j) => j % N === i);
    for (const j of ex) {
      spot(`trinket_${j}`, `trinket ${j}`); spot(`bin_${j}`, `bin ${j}`);
      r.look![`trinket_${j}`] = `A trinket.`; r.look![`bin_${j}`] = `A bin.`;
      r.on!.push({ verb: 'take', a: `trinket_${j}`, if: `!extra_taken_${j}`, do: [{ gain: `extra_${j}` }, { set: `extra_taken_${j}` }] });
      r.on!.push({ verb: 'use', a: `extra_${j}`, b: `bin_${j}`, do: [{ used: `extra_${j}` }, { inc: 'binned' }, 'Binned.'] });
      flagCount++;
    }
    // Walkers: npc k patrols rooms 2k and 2k+1.
    for (let k = 0; k < npcs; k++) if (i === 2 * k || i === 2 * k + 1) {
      r.actors = { ...r.actors, [`npc${k}`]: { char: `npc${k}` } };
      lay.actors![`npc${k}`] = { x: 200 + 40 * k, y: 330, h: 100 };
      r.look![`npc${k}`] = `Walker ${k}.`;
      if (i === 2 * k) {
        const ts: NonNullable<RoomDef['talk']>[string] = [];
        for (let t = 0; t < Math.ceil(topics / Math.max(1, npcs)) && topicCount < topics; t++, topicCount++) {
          ts.push({ topic: `Topic ${topicCount}?`, if: { all: [`!talked_${topicCount}`, ...(t > 0 ? [`talked_${topicCount - 1}`] : [])] }, do: [{ say: [`npc${k}`, `Answer ${topicCount}.`] }, { set: `talked_${topicCount}` }] });
          flagCount++;
        }
        r.talk = { [`npc${k}`]: ts };
      }
    }
    // Ambient scripts: a clock in every other room until the budget is spent.
    if (i % 2 === 1 && scripts.length < (o.scripts ?? 10) - npcs) r.scripts = [{ id: `clock_${i}`, loop: true, do: [{ wait: 5000 }, { inc: `ticks_${i}` }] }];
    if (r.scripts) scripts.push(...r.scripts);
    rooms.push(r);
    layouts[rid(i)] = lay;
  }
  // Filler flags set by the intro, read by hints, until the budget.
  const startFlags: Record<string, boolean> = {};
  for (let f = flagCount; f < (o.flags ?? 100); f++) { startFlags[`filler_${f}`] = true; rooms[f % N].hints!.push({ until: `!filler_${f}`, lines: [`Filler ${f}.`] }); }

  const gameScripts: ScriptDef[] = [];
  for (let k = 0; k < npcs; k++) gameScripts.push({ id: `patrol_${k}`, loop: true, do: [{ wait: 4000 }, { moveActor: [`npc${k}`, rid(2 * k + 1)] }, { emit: 'walker_moved' }, { wait: 4000 }, { moveActor: [`npc${k}`, rid(2 * k)] }, { emit: 'walker_moved' }] });

  const checkpoints: GameDef['checkpoints'] = {};
  // Chapter c ends when room b is reached and its lock opened; its checkpoint is "just arrived in room b, the previous
  // room's item in the bag of whoever carried it" (the player who took over last before b).
  for (let c = 1; c <= chapters; c++) {
    // Never on the last room: its lock is the ending, a chapter there would have nothing left to prove.
    const b = Math.max(1, Math.min(N - 2, Math.floor((c * (N - 1)) / chapters)));
    const carrier = [...Array(P).keys()].filter((k) => boundary(k) <= b - 1).pop() ?? 0;
    const active = `p${carrier}`;
    const flags: Record<string, boolean> = { ...startFlags };
    // The goal state of chapter c: locks 1..b opened (item b-1 was consumed by lock b), items 0..b-1 taken.
    for (let i = 0; i < b; i++) flags[`got_${i}`] = true;
    for (let i = 1; i <= b; i++) flags[`opened_${i}`] = true;
    // Eras: the items that crossed a time chute before room b.
    if (eras) for (const s of eraStart.keys()) if (s <= b) flags[`sent_${s - 1}`] = true;
    const players: Record<string, { room: Id }> = {};
    for (let k = 0; k < P; k++) if (k !== carrier) players[`p${k}`] = { room: rid(Math.min(boundary(k), b)) };
    checkpoints[`chapter_${c}`] = { room: rid(b), active, inventory: [], players, flags, goals: [{ room: rid(b) }, `opened_${b}`] };
  }
  const mig: Migration[] = [];
  for (let m = 1; m <= migrations; m++) mig.push({ from: m, renameFlag: { [`old_${m}`]: `got_${m % N}` }, dropFlag: [`tmp_${m}`] });

  const game: GameDef = {
    id: 'stress', title: `Stress ${N}`, saveVersion: migrations + 1, hero: 'p0', lang: 'en',
    players: P > 1 ? { ids: [...Array(P).keys()].map((k) => `p${k}`), start: Object.fromEntries([...Array(P).keys()].slice(1).map((k) => [`p${k}`, { room: rid(boundary(k)) }])) } : undefined,
    verbs: [{ id: 'look', label: 'Look', color: '#fff' }, { id: 'take', label: 'Take', color: '#fff' }, { id: 'use', label: 'Use', color: '#fff', join: 'with' }, { id: 'give', label: 'Give', color: '#fff', join: 'to' }, { id: 'talk', label: 'Talk', color: '#fff' }],
    characters, items, rooms,
    scripts: gameScripts,
    events: [{ on: 'walker_moved', do: [{ inc: 'sightings' }] }],
    rules: { fallbacks: { look: ['Nothing.'], take: ['No.'], use: ['No.'], give: ['No.'], talk: ['...'], use2: ['No.'] } },
    audio: { sfx: { click: 'click.mp3' } },
    start: { room: rid(0), flags: startFlags, intro: ['Go.'] },
    checkpoints, migrations: mig,
    // Never true: door 1 consumes item 0, and opening it needs item 0 taken first. The second one reads `{ player }`
    // on purpose (the canonical character stays explicit then). Before 3.3 it said "p0 lost item 0 before door 1",
    // which giving the item to another character makes true: the old status hid it behind `solved`.
    invariants: [{ all: [{ has: item(0) }, 'opened_1'] }, { all: [{ player: 'p0' }, 'opened_1', { not: 'got_0' }] }],
    saves: { slots: 3 },
    skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
    ui: {} as GameDef['ui'],
  };
  if (o.schemaVersion === 3) return { game: { ...assignIds(game).game, schemaVersion: 3 }, layouts };
  return { game, layouts };
}
