// The cutscene timeline: how long a command list takes and what overlaps, read from the DSL as written (no second
// representation to maintain). Lines last as the presenter shows them, walks as far as the layout says, animations
// their frames; `parallel` branches get their own lanes; a choice, a conversation, a minigame or a wait on the world
// is open-ended (it waits for the player) and marked as such. The Studio's Rooms tab draws it next to a cutscene.
import { ANIM_MS, CAMERA_MS, FPS, WALK_SPEED, sayMs } from '../core/timing';
import type { Cmd, Id, Layout, Point, RoomDef } from '../core/types';
import { describeCmd } from '../core/engine';
import { condText } from './condtext';

export interface TimelineItem {
  start: number;
  end: number;
  label: string;
  /** The content path of the command (`on[2].do[1]`), for the editor. */
  path: string;
  kind: 'say' | 'wait' | 'walk' | 'anim' | 'play' | 'camera' | 'show' | 'open' | 'branch' | 'cmd';
  /** Waits for the player: the end is not known. */
  open?: boolean;
  /** The length is a guess (a walk from an unknown position). */
  estimated?: boolean;
  lane: number;
  who?: string;
}
export interface Timeline {
  items: TimelineItem[];
  lanes: number;
  total: number;
  openEnded: boolean;
}

export interface TimelineOptions {
  /** The characters' fps is all the timeline needs from the game. */
  game: { characters: Record<string, { fps?: number }> };
  room?: RoomDef;
  layout?: Layout;
  /** The path of the list (`on[2].do`). */
  path?: string;
  textSpeed?: number;
}

/** Where the hero would stand to act on a thing, from the layout (a rough version of `Engine.approach`). */
function pointOf(target: Id | Point, L: Layout | undefined): Point | null {
  if (Array.isArray(target)) return target;
  const h = L?.hotspots?.[target];
  if (h?.approach) return h.approach;
  if (h?.rect) return [h.rect[0] + h.rect[2] / 2, h.rect[1] + h.rect[3] + 12];
  const p = L?.props?.[target];
  if (p) return p.approach ?? [p.x, p.y + 12];
  const a = L?.actors?.[target];
  if (a) return a.approach ?? [a.x + 44, a.y];
  return null;
}

export function timeline(cmds: Cmd[] | undefined, o: TimelineOptions): Timeline {
  const items: TimelineItem[] = [];
  let lanes = 1;
  let openEnded = false;
  const speed = o.textSpeed ?? 1;
  const positions = new Map<string, Point | null>([['hero', o.layout?.entries?.default ?? [320, 360]]]);
  const push = (x: TimelineItem) => {
    items.push(x);
    lanes = Math.max(lanes, x.lane + 1);
    return x.end;
  };
  /** Lays a list on a lane from `t0`; returns when it ends. */
  const lay = (list: Cmd[] | undefined, path: string, lane: number, t0: number): number => {
    let t = t0;
    (list ?? []).forEach((c, i) => {
      const p = `${path}[${i}]`;
      if (typeof c === 'string') {
        t = push({
          start: t,
          end: t + sayMs(c, speed),
          label: `"${c.length > 40 ? c.slice(0, 40) + '…' : c}"`,
          path: p,
          kind: 'say',
          lane,
          who: 'hero',
        });
        return;
      }
      if ('say' in c) {
        t = push({
          start: t,
          end: t + sayMs(c.say[1], speed),
          label: `${c.say[0]}: "${c.say[1].length > 40 ? c.say[1].slice(0, 40) + '…' : c.say[1]}"`,
          path: `${p}.say[1]`,
          kind: 'say',
          lane,
          who: c.say[0],
        });
        return;
      }
      if ('wait' in c) {
        t = push({ start: t, end: t + c.wait, label: `wait ${c.wait} ms`, path: p, kind: 'wait', lane });
        return;
      }
      if ('walk' in c) {
        const who = c.who ?? 'hero';
        const from =
          positions.get(who) ??
          (who !== 'hero'
            ? o.layout?.actors?.[who]
              ? ([o.layout.actors[who].x, o.layout.actors[who].y] as Point)
              : null
            : null);
        const to = pointOf(c.walk, o.layout);
        const d = from && to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : null;
        const ms = d === null ? 1000 : (d / WALK_SPEED) * 1000;
        if (to) positions.set(who, to);
        t = push({
          start: t,
          end: t + ms,
          label: `${who} walks to ${Array.isArray(c.walk) ? c.walk.join(',') : c.walk}`,
          path: p,
          kind: 'walk',
          lane,
          who,
          estimated: d === null,
        });
        return;
      }
      if ('launch' in c || 'spring' in c || 'path' in c || 'follow' in c) {
        const [name, m, d] =
          'launch' in c
            ? (['launch', c.launch, 900] as const)
            : 'spring' in c
              ? (['spring', c.spring, 1200] as const)
              : 'path' in c
                ? (['path', c.path, 1500] as const)
                : (['follow', c.follow, c.follow.ms] as const);
        t = push({
          start: t,
          end: t + (m.ms ?? d),
          label: `${m.target} ${name}`,
          path: p,
          kind: 'anim',
          lane,
          who: m.target,
        });
        return;
      }
      if ('anim' in c) {
        const ms = c.ms ?? ANIM_MS;
        const end = push({
          start: t,
          end: t + ms,
          label: `${c.anim[0]} ${c.anim[1]}`,
          path: p,
          kind: 'anim',
          lane,
          who: c.anim[0],
        });
        const fps = o.game.characters[c.anim[0]]?.fps ?? FPS;
        for (const [k, sub] of Object.entries(c.at ?? {}))
          lay(sub, `${p}.at[${k}]`, lane + 1, t + (Number(k) * 1000) / fps);
        t = end;
        return;
      }
      if ('play' in c) {
        const def = o.room?.props?.[c.play[0]]?.anims?.[c.play[1]];
        const ms = def && !def.loop ? (def.frames.length * 1000) / (def.fps ?? FPS) : 0;
        t = push({
          start: t,
          end: t + ms,
          label: `play ${c.play[0]} ${c.play[1]}${def?.loop ? ' (loop)' : ''}`,
          path: p,
          kind: 'play',
          lane,
        });
        return;
      }
      if ('camera' in c) {
        const ms = typeof c.camera === 'string' ? 0 : (c.camera.ms ?? CAMERA_MS);
        t = push({
          start: t,
          end: t + ms,
          label: `camera ${typeof c.camera === 'string' ? c.camera : 'pan' in c.camera ? `pan ${c.camera.pan}` : `to ${c.camera.to}`}`,
          path: p,
          kind: 'camera',
          lane,
        });
        return;
      }
      if ('show' in c || 'hide' in c) {
        const ms = c.fade ?? 0;
        t = push({ start: t, end: t + ms, label: describeCmd(c), path: p, kind: 'show', lane });
        return;
      }
      if ('parallel' in c) {
        let end = t;
        c.parallel.forEach((b, j) => {
          end = Math.max(end, lay(b, `${p}.parallel[${j}]`, lane + j, t));
        });
        t = end;
        return;
      }
      if ('cutscene' in c) {
        t = lay(c.cutscene, `${p}.cutscene`, lane, t);
        return;
      }
      if ('if' in c) {
        push({ start: t, end: t, label: `if ${condText(c.if)}`, path: p, kind: 'branch', lane });
        const e1 = lay(c.then, `${p}.then`, lane, t);
        const e2 = c.else?.length ? lay(c.else, `${p}.else`, lane + 1, t) : t;
        t = Math.max(e1, e2);
        return;
      }
      if ('once' in c) {
        t = lay(c.once, `${p}.once`, lane, t);
        return;
      }
      for (const k of ['nth', 'cycle', 'random'] as const)
        if (k in c) {
          const branches = (c as unknown as Record<string, Cmd[][]>)[k];
          let end = t;
          branches.forEach((b, j) => {
            push({
              start: t,
              end: t,
              label: `${k} #${j + 1}`,
              path: `${p}.${k}[${j}]`,
              kind: 'branch',
              lane: lane + j,
            });
            end = Math.max(end, lay(b, `${p}.${k}[${j}]`, lane + j, t));
          });
          t = end;
          return;
        }
      if (
        'choice' in c ||
        'talk' in c ||
        'minigame' in c ||
        'waitUntil' in c ||
        'waitEvent' in c ||
        'map' in c ||
        'guide' in c ||
        'phone' in c ||
        'ending' in c ||
        'reveal' in c
      ) {
        openEnded = true;
        push({ start: t, end: t, label: `${describeCmd(c)} (the player)`, path: p, kind: 'open', lane, open: true });
        if ('choice' in c) c.choice.forEach((opt, j) => lay(opt.do, `${p}.choice[${j}].do`, lane + 1 + j, t));
        if ('minigame' in c) t = lay(c.then, `${p}.then`, lane, t);
        if ('phone' in c) t = lay(c.do, `${p}.do`, lane, t);
        if (('ending' in c || 'reveal' in c) && c.after) t = lay(c.after, `${p}.after`, lane, t);
        return;
      }
      if ('goto' in c) {
        t = push({ start: t, end: t, label: `goto ${c.goto}`, path: p, kind: 'cmd', lane });
        return;
      }
      push({ start: t, end: t, label: describeCmd(c), path: p, kind: 'cmd', lane });
    });
    return t;
  };
  const total = lay(cmds, o.path ?? '', 0, 0);
  return { items, lanes, total: Math.max(total, ...items.map((x) => x.end)), openEnded };
}

/** The timeline as text (one line per item, `start → end` in seconds). */
export function timelineText(t: Timeline): string {
  const s = (ms: number) => (ms / 1000).toFixed(1);
  return (
    [...t.items]
      .sort((a, b) => a.start - b.start || a.lane - b.lane)
      .map(
        (x) =>
          `${s(x.start).padStart(6)} → ${x.open ? '  ?   ' : s(x.end).padStart(6)}  ${'  '.repeat(x.lane)}${x.label}${x.estimated ? ' (~)' : ''}`,
      )
      .join('\n') + `\n${t.openEnded ? `at least ${s(t.total)} s, then the player` : `${s(t.total)} s`}`
  );
}
