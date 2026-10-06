// Scripts: their state, one step at a time, looping scripts and the scheduler.
// Part of the Engine (4.1.0 "Clarity"): its methods of the same name forward here, in the same order of effects.
import { must } from './must';
import type { Cmd, Id, ScriptDef } from './types';

import { describeCmd } from './engine-shared';
import type { Engine } from './engine';

// ------------------------------------------------------------------ the world's scripts and events
/** A script by id, wherever it is declared (ids are unique in the game). */
export function scriptDef(eng: Engine, id: Id): ScriptDef | undefined {
  return (
    eng.game.scripts?.find((x) => x.id === id) ??
    eng.game.rooms.flatMap((r) => r.scripts ?? []).find((x) => x.id === id)
  );
}

/** The scripts in scope right now: the current room's, then the game's. */
export function scriptsHere(eng: Engine): ScriptDef[] {
  return [...(eng.room().scripts ?? []), ...(eng.game.scripts ?? [])];
}

/** State of a script: next command (`pc`), finished, stopped. */
export function scriptState(eng: Engine, id: Id) {
  const def = eng.scriptDef(id);
  if (!eng.state.scripts?.[id]) eng.writes?.add(`script:${id}`);
  const st = ((eng.state.scripts ??= {})[id] ??= { pc: 0 });
  // A v3 save follows the named step after authoring steps are reordered. `pc` remains for v2 saves and debugging.
  if (st.step && def?.stepIds) {
    const pc = def.stepIds.indexOf(st.step);
    if (pc >= 0 && st.pc !== pc) {
      st.pc = pc;
      eng.writes?.add(`script:${id}`);
    }
  }
  if (def?.stepIds) st.step = def.stepIds[st.pc];
  return st;
}

/**
 * One step of a script. 'ran': a command ran, or a wait was satisfied. 'blocked': the engine is busy (player action,
 * cutscene, conversation, minigame), the `while` condition is false, a `waitUntil` is false or a `waitEvent` pending.
 * 'wrapped': a loop starts again. 'done', 'off': finished, stopped.
 */
export async function advance(eng: Engine, id: Id): Promise<'ran' | 'blocked' | 'wrapped' | 'done' | 'off'> {
  const def = eng.scriptDef(id);
  if (!def) throw new Error(`unknown script: ${id}`);
  const s = eng.state;
  const st = eng.scriptState(id);
  eng.reads?.add(`script:${id}`);
  if (st.off) return 'off';
  if (st.done) return 'done';
  if (eng.busyCount > 0 || s.done) return 'blocked';
  const room = eng.room();
  if (def.while && !eng.cond(def.while, room.id)) {
    if (st.pc) {
      eng.writes?.add(`script:${id}`);
      eng.begin({ step: id });
      st.pc = 0;
      eng.end();
    }
    return 'blocked';
  }
  if (st.pc >= def.do.length) {
    eng.writes?.add(`script:${id}`);
    if (!def.loop) {
      st.done = true;
      eng.save();
      return 'done';
    }
    eng.begin({ step: id });
    st.pc = 0;
    eng.end();
    return 'wrapped';
  }
  const c = must(def.do[st.pc], `script ${id} step ${st.pc}`); // st.pc < def.do.length, checked above
  if (typeof c === 'object') {
    if ('waitUntil' in c) {
      if (!eng.cond(c.waitUntil, room.id)) return 'blocked';
      eng.writes?.add(`script:${id}`);
      eng.begin({ step: id });
      st.pc++;
      eng.end();
      return 'ran';
    }
    if ('waitEvent' in c) return 'blocked'; // emit() moves the script past it
  }
  eng.begin({ step: id });
  eng.ran(`script:${id}`);
  try {
    await eng.step(c, { room, fast: false });
  } finally {
    eng.writes?.add(`script:${id}`);
    st.pc++;
    if (def.stepIds) st.step = def.stepIds[st.pc];
    eng.end();
  }
  eng.log('script', `${id} ran ${describeCmd(c)} → ${st.pc >= def.do.length ? (def.loop ? 'loops' : 'done') : st.pc}`);
  if (eng.busyCount === 0) eng.save();
  eng.onChange();
  return 'ran';
}

/**
 * Runs a script until it blocks, finishes or completes one iteration of its loop (tests, solver). True if anything ran.
 * `turn`: stop before the next `wait` instead, once something ran: for the solver, letting time pass is one choice at a
 * time (a patrol that walks in, then out, must be seen in between).
 */
export async function runScript(eng: Engine, id: Id, turn = false): Promise<boolean> {
  let ran = false;
  for (let guard = 0; guard < 1000; guard++) {
    if (turn && ran) {
      const c = eng.scriptDef(id)?.do[eng.scriptState(id).pc];
      if (typeof c === 'object' && 'wait' in c) return ran;
    }
    const r = await eng.advance(id);
    if (r !== 'ran') return ran;
    ran = true;
  }
  return ran;
}

// ------------------------------------------------------------------ scripts
/** Runs a script in the current room (usable by the UI or tests). */
export async function script(eng: Engine, cmds: Cmd[]) {
  eng.begin({ script: cmds });
  try {
    await eng.run(() => eng.exec(cmds, { room: eng.room(), fast: false }));
  } finally {
    eng.end();
  }
}
