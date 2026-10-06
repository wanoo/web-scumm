// Commands: `exec` runs a list of `Cmd`, `step` runs one; where a command points in the room.
// Part of the Engine (4.1.0 "Clarity"): its methods of the same name forward here, in the same order of effects.
import { motionEnd, type MotionSpec } from './motion';
import { CHANGES, cmdKey } from './cmds';
import { must } from './must';
import { stateDiff } from './diff';
import { ANIM_MS, CAMERA_MS, FPS } from './timing';
import type { Cmd, Id, Point, RoomDef, Value } from './types';

import { HERO, type Ctx } from './engine-shared';
import type { Engine } from './engine';

export async function say(eng: Engine, who: Id, text: string, ctx: Ctx, shout = false, voice?: Id) {
  await eng.ui.say(eng.who(who), text, { shout, fast: ctx.fast, voice });
}

export function point(eng: Engine, t: Id | Point, room: RoomDef): Point {
  if (Array.isArray(t)) return t;
  const ap = eng.approach(t, room);
  if (!ap) throw new Error(`no point for "${t}" in ${room.id} (missing layout?)`);
  return ap;
}

export function actorKey(_eng: Engine, who: Id, room: RoomDef) {
  return `${room.id}.${who}`;
}

/** Where a thing stands, for a motion's ends: a prop's or an actor's feet, a hotspot's centre, else its approach point. */
export function spot(eng: Engine, t: Id | Point, room: RoomDef): Point {
  if (Array.isArray(t)) return t;
  const L = eng.layout(room.id);
  const p = L.props?.[t];
  if (p) return [p.x, p.y];
  const a = eng.state.actors[eng.actorKey(t, room)],
    al = L.actors?.[t];
  if (a?.x !== undefined && a.y !== undefined) return [a.x, a.y];
  if (al) return [al.x, al.y];
  const h = L.hotspots?.[t];
  if (h?.rect) return [h.rect[0] + h.rect[2] / 2, h.rect[1] + h.rect[3] / 2];
  return eng.point(t, room);
}

export async function exec(eng: Engine, cmds: Cmd[] | undefined, ctx: Ctx): Promise<void> {
  if (!cmds) return;
  for (const c of cmds) {
    // A destroyed engine runs nothing more (4.1.4): what was waiting ends, what followed never starts.
    if (eng.destroyed) return;
    if (eng.skipping && !ctx.fast) ctx = { ...ctx, fast: true };
    await eng.step(c, ctx);
    if (eng.state.done) return;
  }
}

export async function step(eng: Engine, c: Cmd, ctx: Ctx): Promise<void> {
  const s = eng.state;
  const room = ctx.room;
  const o = eng.cur;
  if (o) {
    if (o.src?.skipAt === o.steps) eng.skipping = true;
    o.steps++;
  }
  if (typeof c === 'string') return eng.say(HERO, c, ctx);
  if (eng.writes) {
    const k = cmdKey(c);
    if (k && CHANGES.has(k))
      eng.writes.add(
        'set' in c
          ? `flag:${Array.isArray(c.set) ? c.set[0] : c.set}`
          : 'unset' in c
            ? `flag:${c.unset}`
            : 'inc' in c
              ? `flag:${c.inc}`
              : '*',
      );
  }
  if ('say' in c)
    return eng.say(
      c.say[0],
      c.say[1],
      ctx,
      !!c.shout,
      c.voice ?? (c.id && eng.game.audio?.voices?.[c.id] ? c.id : undefined),
    );
  if ('walk' in c) {
    const who = eng.who(c.who ?? HERO);
    const end = await eng.ui.walk(who, eng.point(c.walk, room), ctx.fast);
    if (end) {
      if (who === eng.heroId()) s.hero[room.id] = end;
      else s.actors[eng.actorKey(who, room)] = { ...s.actors[eng.actorKey(who, room)], x: end[0], y: end[1] };
    }
    return;
  }
  // Stage physics (core/motion.ts): presentation only; a character keeps where its motion ends, like `place`.
  if ('launch' in c || 'spring' in c || 'path' in c || 'follow' in c) {
    const L = 'launch' in c ? c.launch : 'spring' in c ? c.spring : 'path' in c ? c.path : c.follow;
    const who = eng.who(L.target);
    const m: MotionSpec =
      'launch' in c
        ? {
            kind: 'launch',
            to: eng.spot(c.launch.to, room),
            ...(c.launch.from !== undefined ? { from: eng.spot(c.launch.from, room) } : {}),
            ...(c.launch.height !== undefined ? { height: c.launch.height } : {}),
            ms: c.launch.ms ?? 900,
            rotate: c.launch.rotate ?? 0,
          }
        : 'spring' in c
          ? {
              kind: 'spring',
              axis: c.spring.axis ?? 'rot',
              amplitude: c.spring.amplitude ?? 10,
              frequency: c.spring.frequency ?? 3,
              damping: c.spring.damping ?? 0.25,
              ms: c.spring.ms ?? 1200,
            }
          : 'path' in c
            ? { kind: 'path', points: c.path.points, ms: c.path.ms ?? 1500, orient: !!c.path.orient }
            : { kind: 'follow', offset: c.follow.offset ?? [0, -40], ms: c.follow.ms };
    await eng.ui.motion(who, m, ctx.fast, 'follow' in c ? eng.who(c.follow.leader) : undefined);
    const end = motionEnd(m);
    if (end && who === eng.heroId()) s.hero[room.id] = end;
    else if (end && (room.actors?.[who] || Object.values(room.actors ?? {}).some((a) => a.char === who)))
      s.actors[eng.actorKey(who, room)] = { ...s.actors[eng.actorKey(who, room)], x: end[0], y: end[1] };
    return;
  }
  if ('place' in c) {
    const who = eng.who(c.place[0]);
    eng.ui.place(who, c.place[1], c.face);
    if (who === eng.heroId()) s.hero[room.id] = c.place[1];
    else
      s.actors[eng.actorKey(who, room)] = {
        ...s.actors[eng.actorKey(who, room)],
        x: c.place[1][0],
        y: c.place[1][1],
        ...(c.face ? { facing: c.face } : {}),
      };
    return;
  }
  if ('face' in c) {
    const who = eng.who(c.who ?? HERO);
    let dir = c.face as 'left' | 'right';
    if (c.face !== 'left' && c.face !== 'right') {
      const x = eng.centerX(c.face, room);
      const me = who === eng.heroId() ? s.hero[room.id]?.[0] : eng.centerX(who, room);
      dir = x !== null && me !== undefined && me !== null && x < me ? 'left' : 'right';
    }
    eng.ui.face(who, dir);
    if (who !== eng.heroId()) s.actors[eng.actorKey(who, room)] = { ...s.actors[eng.actorKey(who, room)], facing: dir };
    return;
  }
  if ('pose' in c) {
    const who = eng.who(c.pose[0]);
    eng.ui.pose(who, c.pose[1]);
    if (who !== eng.heroId())
      s.actors[eng.actorKey(who, room)] = { ...s.actors[eng.actorKey(who, room)], pose: c.pose[1] };
    return;
  }
  if ('anim' in c) {
    const who = eng.who(c.anim[0]);
    if (!c.at) return eng.ui.anim(who, c.anim[1], c.ms ?? ANIM_MS, ctx.fast);
    // Frame events: the commands of `at` run when the pose reaches that frame (at the character's fps).
    const fps = eng.character(who)?.fps ?? FPS;
    const p = eng.ui.anim(who, c.anim[1], c.ms ?? ANIM_MS, ctx.fast);
    let t = 0;
    for (const i of Object.keys(c.at)
      .map(Number)
      .sort((a, b) => a - b)) {
      const at = (i * 1000) / fps;
      if (at > t) {
        await eng.ui.wait(at - t, ctx.fast);
        t = at;
      }
      await eng.exec(c.at[i], ctx);
    }
    await p;
    return;
  }
  if ('play' in c) {
    const [pid, name] = c.play;
    const def = room.props?.[pid]?.anims?.[name];
    if (!def) throw new Error(`no animation "${name}" on prop "${pid}" in ${room.id}`);
    const fps = def.fps ?? FPS;
    if (def.loop) {
      // A loop never ends: its frame events only play sounds and shakes (the validator refuses anything else).
      const at = def.at;
      eng.ui.propLoop(
        pid,
        def.frames,
        fps,
        at && Object.keys(at).length
          ? (i) => {
              for (const x of at[i] ?? [])
                if (typeof x === 'object' && ('sfx' in x || 'shake' in x)) void eng.step(x, ctx);
            }
          : undefined,
      );
      return;
    }
    for (let i = 0; i < def.frames.length; i++) {
      eng.ui.propFrame(pid, must(def.frames[i], `frame ${i}`));
      if (def.at?.[i]) await eng.exec(def.at[i], ctx);
      await eng.ui.wait(1000 / fps, ctx.fast);
    }
    eng.ui.propFrame(pid, null);
    return;
  }
  if ('stopAnim' in c) {
    eng.ui.propLoop(c.stopAnim, [], 0);
    return;
  }
  if ('camera' in c) {
    const W = eng.layout(room.id).width ?? 640;
    const clamp = (x: number) => Math.max(0, Math.min(W - 640, x));
    if (c.camera === 'follow' || c.camera === 'reset') {
      s.camera = { x: 0, follow: true };
      await eng.ui.camera(null, true, 0, ctx.fast);
      return;
    }
    const x = clamp('pan' in c.camera ? c.camera.pan : (eng.centerX(c.camera.to, room) ?? 320) - 320);
    s.camera = { x, follow: false };
    await eng.ui.camera(x, false, c.camera.ms ?? CAMERA_MS, ctx.fast);
    return;
  }
  if ('wait' in c) return eng.ui.wait(c.wait, ctx.fast);
  if ('parallel' in c) {
    await Promise.all(c.parallel.map((b) => eng.exec(b, ctx)));
    return;
  }
  if ('prop' in c) {
    const [id, st] = c.prop;
    const key = id.includes('.') ? id : `${room.id}.${id}`;
    s.props[key] = st;
    if (key.startsWith(`${s.room}.`)) eng.ui.prop(key.slice(s.room.length + 1), st);
    return;
  }
  if ('show' in c || 'hide' in c) {
    const id = 'show' in c ? c.show : (c as { hide: Id }).hide;
    const vis = 'show' in c;
    s.actors[eng.actorKey(id, room)] = { ...s.actors[eng.actorKey(id, room)], visible: vis };
    return eng.ui.show(id, vis, c.fade ?? 0, ctx.fast);
  }
  if ('gain' in c) {
    if (!s.inventory.includes(c.gain)) s.inventory.push(c.gain);
    if (s.used?.includes(c.gain)) s.used = s.used.filter((x) => x !== c.gain);
    eng.ui.inventory(s.inventory, s.used);
    eng.onChange();
    return;
  }
  if ('lose' in c) {
    s.inventory = s.inventory.filter((x) => x !== c.lose);
    eng.ui.inventory(s.inventory, s.used);
    eng.onChange();
    return;
  }
  if ('used' in c) {
    const u = (s.used ??= []);
    for (const id of Array.isArray(c.used) ? c.used : [c.used]) if (!u.includes(id)) u.push(id);
    eng.ui.inventory(s.inventory, u);
    eng.onChange();
    return;
  }
  if ('set' in c) {
    const [k, v]: [Id, Value] = Array.isArray(c.set) ? c.set : [c.set, true];
    s.flags[k] = v;
    return;
  }
  if ('unset' in c) {
    delete s.flags[c.unset];
    return;
  }
  if ('inc' in c) {
    s.flags[c.inc] = (typeof s.flags[c.inc] === 'number' ? (s.flags[c.inc] as number) : 0) + (c.by ?? 1);
    return;
  }
  if ('unlock' in c) {
    if (!s.unlocked.includes(c.unlock)) s.unlocked.push(c.unlock);
    return;
  }
  if ('goto' in c) {
    await eng.enter(c.goto, c.at, true);
    return;
  }
  if ('map' in c) {
    const pick = await eng.pickPlace();
    if (pick) {
      const p = eng.game.map?.places[pick];
      if (p) await eng.enter(p.room, undefined, true);
    }
    return;
  }
  if ('moveActor' in c) {
    const [char, to] = c.moveActor;
    eng.log('actor', `${char} → ${to}`);
    const dest = eng.room(to);
    const from = s.where?.[char];
    (s.where ??= {})[char] = to;
    const inst = eng.instanceOf(char, dest);
    let at: Point | undefined;
    if (inst) {
      const key = `${to}.${inst}`;
      const L = eng.layout(to);
      at = c.at ? (Array.isArray(c.at) ? c.at : L.entries?.[c.at]) : undefined;
      const o = { ...s.actors[key] };
      delete o.x;
      delete o.y;
      delete o.visible;
      s.actors[key] = at ? { ...o, x: at[0], y: at[1] } : o;
    }
    // The view: the character leaves the room on screen, or arrives in it.
    if (from === s.room && to !== s.room) {
      const i = eng.instanceOf(char, room);
      if (i) await eng.ui.show(i, false, 0, true);
    }
    if (to === s.room && inst) {
      const pos =
        at ??
        (() => {
          const a = eng.layout(to).actors?.[inst];
          return a ? ([a.x, a.y] as Point) : undefined;
        })();
      if (pos) eng.ui.place(inst, pos);
      await eng.ui.show(inst, true, 0, true);
    }
    eng.onChange();
    return;
  }
  if ('emit' in c) return eng.emit(c.emit, ctx);
  if ('waitUntil' in c) {
    // Woken by the next state change (4.1.4), with the presenter's wait as a bound: a condition met is seen at once,
    // never a quarter of a second later; the guard keeps a condition nothing can meet from waiting for ever.
    for (let guard = 0; guard < 100000 && !eng.cond(c.waitUntil, room.id) && !eng.destroyed; guard++) {
      let woken = () => {};
      const change = new Promise<void>((ok) => {
        woken = ok;
        eng.waiters.add(ok);
      });
      await Promise.race([eng.ui.wait(250, ctx.fast), change]);
      eng.waiters.delete(woken);
    }
    return;
  }
  if ('waitEvent' in c) return; // only meaningful at the top level of a script (advance); elsewhere it is a no-op
  if ('startScript' in c) {
    if (!eng.scriptDef(c.startScript)) throw new Error(`unknown script: ${c.startScript}`);
    (s.scripts ??= {})[c.startScript] = { pc: 0 };
    if (eng.autoScripts && !eng.loops.has(c.startScript)) {
      const global = !!eng.game.scripts?.some((x) => x.id === c.startScript);
      if (global || eng.room().scripts?.some((x) => x.id === c.startScript))
        void eng.loop(c.startScript, global, global ? eng.sessionGen : eng.roomGen);
    }
    return;
  }
  if ('stopScript' in c) {
    eng.scriptState(c.stopScript).off = true;
    return;
  }
  if ('switchPlayer' in c) {
    if (!eng.isPlayer(c.switchPlayer)) throw new Error(`not a playable character: ${c.switchPlayer}`);
    if (c.switchPlayer === eng.heroId()) return;
    await eng.swap(c.switchPlayer);
    await eng.enter(s.room, undefined, false);
    eng.startScripts(true);
    return;
  }
  if ('transfer' in c) {
    eng.transfer(c.transfer[0], c.transfer[1]);
    return;
  }
  if ('custom' in c) {
    const cmd = eng.opts.commands?.[c.custom];
    if (!cmd) throw new Error(`unknown custom command: ${c.custom} (export it from games/<id>/index.ts "commands")`);
    await eng.exec(cmd.effects, ctx);
    if (cmd.run && eng.opts.runCustom && !ctx.fast) {
      // `run` is display only: in dev (journal on), a state change outside the declared `effects` is reported.
      const before = eng.traceOn ? structuredClone(s) : null;
      await cmd.run({
        game: eng.game,
        state: s,
        room,
        args: c.args,
        ui: eng.ui,
        scene: eng.opts.scene?.(),
        fast: ctx.fast,
      });
      if (before) {
        const diff = stateDiff(before, s);
        if (diff.length) {
          const msg = `custom "${c.custom}" changed ${diff.join(', ')} outside its declared effects`;
          eng.log('action', msg);
          eng.onError(new Error(msg), `custom ${c.custom}`);
        }
      }
    }
    return;
  }
  if ('sfx' in c) {
    if (!ctx.fast) eng.ui.sfx(c.sfx, c.caption);
    return;
  }
  if ('music' in c) {
    eng.ui.music(typeof c.music === 'string' ? { play: c.music } : c.music);
    return;
  }
  if ('toast' in c) {
    eng.ui.toast(c.toast);
    return;
  }
  if ('shake' in c) {
    if (!ctx.fast) eng.ui.shake(c.shake);
    return;
  }
  if ('if' in c) return eng.exec(eng.cond(c.if, room.id) ? c.then : c.else, ctx);
  if ('once' in c) {
    const k = c.key!;
    eng.reads?.add(`once:${k}`);
    if (s.counters[k]) return;
    s.counters[k] = 1;
    eng.writes?.add(`once:${k}`);
    return eng.exec(c.once, ctx);
  }
  if ('nth' in c || 'cycle' in c) {
    const list = 'nth' in c ? c.nth : c.cycle;
    const k = c.key!;
    eng.reads?.add(`nth:${k}`);
    const n = s.counters[k] ?? 0;
    s.counters[k] = n + 1;
    eng.writes?.add(`nth:${k}`);
    const i = 'nth' in c ? Math.min(n, list.length - 1) : n % list.length;
    return eng.exec(list[i], ctx);
  }
  if ('random' in c) {
    const k = c.key!;
    eng.reads?.add(`random:${k}`);
    let i = Math.floor(eng.rand() * c.random.length);
    if (c.random.length > 1 && i === s.counters[k]) i = (i + 1) % c.random.length;
    s.counters[k] = i;
    eng.writes?.add(`random:${k}`);
    return eng.exec(c.random[i], ctx);
  }
  if ('cutscene' in c) {
    eng.ui.cutscene(true);
    eng.skipping = false;
    try {
      await eng.exec(c.cutscene, ctx);
    } finally {
      eng.skipping = false;
      eng.ui.cutscene(false);
    }
    return;
  }
  if ('choice' in c) {
    const choiceKey = (o: (typeof c.choice)[number]) => `choice.${o.id ?? `${room.id}.${o.text}`}`;
    const opts = c.choice
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => {
        const k = choiceKey(o);
        if (o.once) eng.reads?.add(`seen:${k}`);
        return eng.cond(o.if, room.id) && !(o.once && s.seen[k]);
      });
    if (!opts.length) return;
    const pick = await eng.choose(opts.map(({ o }) => ({ text: o.text })));
    const { o } = must(opts[Math.max(0, Math.min(pick, opts.length - 1))], 'choice option');
    if (o.once) {
      s.seen[choiceKey(o)] = 1;
      eng.writes?.add(`seen:${choiceKey(o)}`);
    }
    await eng.say(HERO, o.text, ctx);
    return eng.exec(o.do, ctx);
  }
  if ('minigame' in c) {
    eng.ran(`minigame:${c.minigame}`);
    await eng.ui.minigame(c.minigame, c.params ?? {});
    return eng.exec(c.then, ctx);
  }
  if ('phone' in c) {
    const who = Array.isArray(c.phone) ? c.phone.map((w) => eng.who(w)) : eng.who(c.phone);
    await eng.ui.phone(who, true);
    await eng.exec(c.do, ctx);
    await eng.ui.phone(who, false);
    return;
  }
  if ('guide' in c) {
    const g = c.guide;
    if (ctx.fast) return;
    await eng.say(HERO, g.say, ctx);
    await new Promise<void>((resolve) => {
      eng.guideWait = { ...g, resolve };
      eng.ui.guide({ verb: g.verb, target: g.target });
      eng.onChange();
    });
    return;
  }
  if ('talk' in c) return eng.talkLoop(c.talk, ctx);
  if ('hint' in c) return eng.hint(ctx);
  if ('ending' in c || 'reveal' in c) {
    await eng.ui.ending('open');
    await eng.exec(c.after, { ...ctx, fast: false });
    // The sealed ending ends the game as `end` does: `state.done` is the one truth an e2e or a replay reads, the
    // card is only how it is shown.
    s.done = true;
    eng.save();
    return eng.ui.ending('card');
  }
  if ('end' in c) {
    s.done = true;
    eng.save();
    eng.ui.end();
    return;
  }
  throw new Error('unknown command: ' + JSON.stringify(c));
}
