// The validator's checks of events (emitted, listened to, waited for) and of `reality` (4.1.1, docs/en/REALITY.md): a
// finite, declared alphabet of signals, each one an event the world emits; a required one names the action that stands
// in for it when the outside never answers. Called by validate() with the event maps it filled walking the content.
import type { GameDef, Id } from '../core/types';

const ids = (x: Id | Id[] | undefined) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

export function eventChecks(
  game: GameDef,
  {
    emitted,
    listened,
    waited,
  }: { emitted: Map<string, string>; listened: Map<string, string>; waited: Map<string, string> },
  err: (where: string, msg: string) => void,
  warn: (where: string, msg: string) => void,
): void {
  const SIGNAL_ID = /^[\w.:-]{1,128}$/;
  const signalIds = new Set<string>();
  (game.reality?.signals ?? []).forEach((sg, i) => {
    const w = `reality.signals[${i}]`;
    if (!SIGNAL_ID.test(sg.id ?? '')) err(w, `signal id "${sg.id}": letters, digits and . _ : - only, at most 128`);
    else if (signalIds.has(sg.id)) err(w, `signal "${sg.id}" is declared twice`);
    signalIds.add(sg.id);
    if (!sg.source) err(w, 'a signal names its `source` (mail, webhook…)');
    if (sg.availability !== 'optional' && sg.availability !== 'required')
      err(w, '`availability` is "optional" or "required"');
    if (sg.replay !== 'record') err(w, '`replay` is "record" (the only mode of 4.1.1)');
    if (sg.availability === 'required') {
      const f = sg.fallback;
      if (!f)
        err(w, `required signal "${sg.id}" has no \`fallback\`: what a player does when the outside never answers`);
      else if (
        !game.rooms.some((r) =>
          (r.on ?? []).some(
            (x) =>
              ids(x.verb as Id | Id[]).includes(f.verb) &&
              ids(x.a).includes(f.a) &&
              (f.b === undefined || ids(x.b as Id | Id[] | undefined).includes(f.b)),
          ),
        )
      )
        err(w, `the fallback of "${sg.id}" (${f.verb} ${f.a}${f.b ? ` ${f.b}` : ''}) matches no rule`);
    }
    if (!emitted.has(sg.id)) emitted.set(sg.id, w);
    if (!listened.has(sg.id) && !waited.has(sg.id)) warn(w, `signal "${sg.id}" is declared but nothing listens to it`);
  });
  const bridge = game.reality?.bridge;
  if (bridge !== undefined && !/^(https:\/\/[^\s/]+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)(\/[^\s]*)?$/.test(bridge))
    err('reality.bridge', `"${bridge}": an https:// URL (http:// only for 127.0.0.1 or localhost)`);
  for (const [ev, where] of emitted)
    if (!listened.has(ev) && !waited.has(ev) && !game.reality?.signals.some((x) => x.id === ev))
      warn(where, `event "${ev}" is emitted but nothing listens to it`);
  for (const [ev, where] of listened)
    if (!emitted.has(ev)) {
      // A game that takes signals from outside declares every one it listens to: an undeclared name is a typo or a
      // signal the Bridge would refuse.
      if (game.reality) err(where, `event "${ev}" is never emitted nor declared in reality.signals`);
      else warn(where, `event "${ev}" is listened to but never emitted`);
    }
  for (const [ev, where] of waited)
    if (!emitted.has(ev)) warn(where, `script waits for event "${ev}", which is never emitted`);
}
