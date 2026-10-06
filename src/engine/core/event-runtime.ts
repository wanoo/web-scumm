// Events: `emit` moves the scripts waiting for it, then runs the listeners of the room, then of the game.
// Part of the Engine (4.1.0 "Clarity"): its methods of the same name forward here, in the same order of effects.
import { listenerActionId } from './content-ids';
import type { EventRule, Id } from './types';

import { type Ctx } from './engine-shared';
import type { Engine } from './engine';
import { seenKey } from './keys';

/** Fires an event: moves the scripts waiting for it, then runs the listeners of the room, then of the game. */
export async function emit(eng: Engine, id: Id, ctx: Ctx) {
  const s = eng.state;
  eng.log('event', `emit ${id}`);
  for (const def of [...(eng.game.scripts ?? []), ...eng.game.rooms.flatMap((r) => r.scripts ?? [])]) {
    const st = eng.scriptState(def.id);
    eng.reads?.add(`script:${def.id}`);
    const cur = def.do[st.pc];
    if (!st.done && !st.off && cur && typeof cur === 'object' && 'waitEvent' in cur && cur.waitEvent === id) {
      st.pc++;
      eng.writes?.add(`script:${def.id}`);
    }
  }
  const scopes: [EventRule[], string][] = [
    [ctx.room.events ?? [], ctx.room.id],
    [eng.game.events ?? [], 'game'],
  ];
  for (const [list, scope] of scopes)
    for (const [i, ev] of list.entries()) {
      if (ev.on !== id || !eng.cond(ev.if, ctx.room.id)) continue;
      if (ev.once) {
        const k = seenKey.event(ev, scope, i);
        eng.reads?.add(`seen:${k}`);
        if (s.seen[k]) continue;
        s.seen[k] = 1;
        eng.writes?.add(`seen:${k}`);
      }
      eng.log('event', `${id} → ${scope}.events[${i}]${ev.once ? ' (once)' : ''}`);
      eng.ran(listenerActionId(scope, i, ev));
      await eng.exec(ev.do, ctx);
    }
}
