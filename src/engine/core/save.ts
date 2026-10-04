import { z } from 'zod';
import type { GameDef, GameState, Id } from './types';
import { migrate } from './migrate';

const id = z.string().min(1);
const value = z.union([z.boolean(), z.number().finite(), z.string()]);
const point = z.tuple([z.number().finite(), z.number().finite()]);

/** Runtime schema for every persisted GameState field. Unknown fields are retained for forward-compatible imports. */
export const GameStateSchema = z.looseObject({
  v: z.number().int().nonnegative(), room: id, inventory: z.array(id), flags: z.record(id, value),
  props: z.record(id, z.string()),
  actors: z.record(id, z.looseObject({ x: z.number().finite().optional(), y: z.number().finite().optional(), pose: id.optional(), facing: z.enum(['left', 'right']).optional(), visible: z.boolean().optional() })),
  hero: z.record(id, point), unlocked: z.array(id), visited: z.record(id, z.number().int().nonnegative()),
  counters: z.record(id, z.number().int().nonnegative()), seen: z.record(id, z.literal(1)), used: z.array(id).optional(),
  where: z.record(id, id).optional(),
  scripts: z.record(id, z.looseObject({ pc: z.number().int().nonnegative(), step: id.optional(), done: z.boolean().optional(), off: z.boolean().optional() })).optional(),
  camera: z.looseObject({ x: z.number().finite(), follow: z.boolean() }).optional(), active: id.optional(),
  players: z.record(id, z.looseObject({ room: id, inventory: z.array(id), hero: z.record(id, point), used: z.array(id).optional() })).optional(),
  started: z.number().finite(), done: z.boolean().optional(),
});

export const SaveEnvelopeV3Schema = z.strictObject({
  format: z.literal('web-scumm-save'), schema: z.literal(3), gameId: id,
  gameSaveVersion: z.number().int().nonnegative(), savedAt: z.number().finite(), state: GameStateSchema,
});

export interface SaveEnvelopeV3 {
  format: 'web-scumm-save'; schema: 3; gameId: string; gameSaveVersion: number; savedAt: number; state: GameState;
}

export function saveEnvelope(game: GameDef, state: GameState): SaveEnvelopeV3 {
  return { format: 'web-scumm-save', schema: 3, gameId: game.id, gameSaveVersion: game.saveVersion, savedAt: Date.now(), state: structuredClone(state) };
}

/** Parses an envelope (or a legacy raw state), then rejects references that do not exist in this game. */
export function parseSave(game: GameDef, input: unknown): GameState {
  let raw: unknown = input;
  if (input && typeof input === 'object' && 'format' in input) {
    const env = SaveEnvelopeV3Schema.parse(input);
    if (env.gameId !== game.id) throw new Error(`save belongs to game "${env.gameId}", not "${game.id}"`);
    if (env.gameSaveVersion !== env.state.v) throw new Error('save envelope and state versions disagree');
    raw = env.state;
  }
  const parsed = GameStateSchema.parse(raw) as GameState;
  const state = migrate(game, parsed);
  if (!state) throw new Error(`save version ${parsed.v} cannot be migrated to ${game.saveVersion}`);
  const rooms = new Map(game.rooms.map((r) => [r.id, r]));
  const players = new Set(game.players?.ids ?? [game.hero]);
  const item = (x: Id, where: string) => { if (!game.items[x]) throw new Error(`${where}: unknown item "${x}"`); };
  const room = (x: Id, where: string) => { if (!rooms.has(x)) throw new Error(`${where}: unknown room "${x}"`); };
  room(state.room, 'state.room');
  state.inventory.forEach((x) => item(x, 'state.inventory'));
  state.used?.forEach((x) => item(x, 'state.used'));
  state.unlocked.forEach((x) => { if (!game.map?.places[x]) throw new Error(`state.unlocked: unknown place "${x}"`); });
  for (const x of Object.keys(state.hero)) room(x, 'state.hero');
  for (const x of Object.keys(state.visited)) room(x, 'state.visited');
  for (const [actor, at] of Object.entries(state.where ?? {})) {
    if (!game.characters[actor]) throw new Error(`state.where: unknown character "${actor}"`);
    room(at, 'state.where');
  }
  if (state.active && !players.has(state.active)) throw new Error(`state.active: unknown player "${state.active}"`);
  for (const [pid, p] of Object.entries(state.players ?? {})) {
    if (!players.has(pid)) throw new Error(`state.players: unknown player "${pid}"`);
    room(p.room, `state.players.${pid}.room`); p.inventory.forEach((x) => item(x, `state.players.${pid}.inventory`));
    p.used?.forEach((x) => item(x, `state.players.${pid}.used`));
  }
  for (const [key, propState] of Object.entries(state.props)) {
    const cut = key.indexOf('.');
    const r = cut > 0 ? rooms.get(key.slice(0, cut)) : undefined;
    const p = cut > 0 ? r?.props?.[key.slice(cut + 1)] : undefined;
    if (!p) throw new Error(`state.props: unknown prop "${key}"`);
    if (p.states && !p.states[propState]) throw new Error(`state.props: unknown state "${propState}" for "${key}"`);
  }
  for (const key of Object.keys(state.actors)) {
    const cut = key.indexOf('.');
    const r = cut > 0 ? rooms.get(key.slice(0, cut)) : undefined;
    if (!r?.actors?.[key.slice(cut + 1)] && !r?.props?.[key.slice(cut + 1)]) throw new Error(`state.actors: unknown actor or prop "${key}"`);
  }
  const scripts = new Map([...(game.scripts ?? []), ...game.rooms.flatMap((r) => r.scripts ?? [])].map((s) => [s.id, s]));
  for (const [sid, st] of Object.entries(state.scripts ?? {})) {
    const def = scripts.get(sid);
    if (!def) throw new Error(`state.scripts: unknown script "${sid}"`);
    if (st.step && def.stepIds && !def.stepIds.includes(st.step)) throw new Error(`state.scripts.${sid}: unknown step "${st.step}"`);
    if (!st.step && st.pc > def.do.length) throw new Error(`state.scripts.${sid}: instruction ${st.pc} is out of range`);
  }
  return state;
}
