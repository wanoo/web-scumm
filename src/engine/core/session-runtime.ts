// The session: what each input recorded (entries, the answers given while it ran, digests), fed back by a replay.
// Part of the Engine (4.1.0 "Clarity"): its methods of the same name forward here, in the same order of effects.
import { stateDigest } from './diff';
import type { Id, Session, SessionEntry } from './types';
import type { Engine } from './engine';
import { SESSION_MAX } from './engine-shared';

/** Opens an entry of the session (and takes its recorded twin when replaying). */
export function begin(eng: Engine, entry: SessionEntry) {
  if (!eng.open.length && eng.session && eng.session.log.length >= SESSION_MAX) eng.newSession({ kind: 'load' });
  eng.session ??= eng.newSession({ kind: 'load' });
  if (eng.clock) entry.t = Math.round(eng.clock() - eng.sessionT0);
  eng.session.log.push(entry);
  eng.open.push({ entry, src: eng.feed?.shift(), pi: 0, mi: 0, ri: 0, steps: 0 });
}

/** A fresh session from the current state; the clock, when set, dates it and its entries. */
export function newSession(eng: Engine, start: Session['start']): Session {
  eng.sessionT0 = eng.clock?.() ?? 0;
  eng.session = {
    v: eng.game.saveVersion,
    start,
    base: structuredClone(eng.state),
    log: [],
    ...(eng.clock ? { at: Date.now() } : {}),
  };
  return eng.session;
}

export function end(eng: Engine) {
  const o = eng.open.pop();
  if (o && eng.digestOn) o.entry.digest = stateDigest(eng.state);
}

/** Records what answered (a rule, a topic, a listener, a script step: the puzzle graph's ids). */
export function ran(eng: Engine, id: string) {
  const o = eng.cur;
  if (o) (o.entry.ran ??= []).push(id);
}

/** Replays a session: the engine takes the recorded answers instead of asking the presenter. */
export function feedSession(eng: Engine, s: Session) {
  eng.feed = [...s.log];
}

/** A choice, recorded (and fed back when replaying). */
export async function choose(
  eng: Engine,
  options: { text: string; seen?: boolean; global?: boolean }[],
  who?: Id,
): Promise<number> {
  const o = eng.cur;
  const fed = o?.src?.picks?.[o.pi];
  const i = fed !== undefined ? (o!.pi++, fed) : await eng.ui.choose(options, who);
  if (o) (o.entry.picks ??= []).push(i);
  return i;
}

/** The map's answer, recorded. */
export async function pickPlace(eng: Engine): Promise<Id | null> {
  const o = eng.cur;
  const fed = o?.src?.maps?.[o.mi];
  const p = fed !== undefined ? (o!.mi++, fed) : await eng.ui.openMap(eng.state);
  if (o) (o.entry.maps ??= []).push(p);
  return p;
}

/** A random draw, recorded. */
export function rand(eng: Engine): number {
  const o = eng.cur;
  const fed = o?.src?.rnd?.[o.ri];
  const r = fed !== undefined ? (o!.ri++, fed) : eng.random();
  if (o) (o.entry.rnd ??= []).push(r);
  return r;
}
