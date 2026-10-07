// A run replayed (4.1.14 "Time Attack"): the entries of a run (or a route) on a silent engine with the run's tape
// attached, its loads restored where the run made them, its splits followed. The verifier, the Studio's preview and
// a route's timing all go through here, so a link is derived the same way everywhere (core/run-tape.ts).
import type { CustomCommands } from '../../core/custom';
import type { Engine } from '../../core/engine';
import { RunTape, type TapeLink } from '../../core/run-tape';
import type { GameDef, GameState, Id, Layout, SessionEntry, SpeedrunCategory } from '../../core/types';
import { replay, type ReplayResult } from '../replay';
import { SplitTracker } from './splits';

/** A load during a run: before entry `before`, the state was restored to what it was after entry `from`. */
export interface RunLoad {
  before: number;
  from: number;
  /** A run resumed after a crash: the state it restores is the one it had (no reload in the category's sense). */
  resume?: true;
}

export interface ReplayRunOptions {
  /** The run's seed: the draws are not fed, the engine draws them again (absent: the recorded draws are fed). */
  seed?: string;
  loads?: readonly RunLoad[];
  category?: SpeedrunCategory;
  commands?: CustomCommands;
  /** Stop the engine after this long (ms of wall time): the replay is then incomplete. */
  timeoutMs?: number;
}

export interface ReplayRunResult {
  replay: ReplayResult;
  links: TapeLink[];
  tracker: SplitTracker | null;
  /** The loads that could not be made: a `from` not reached before its `before`. */
  badLoads: RunLoad[];
}

/** Replays a run's entries (`entries[0]` is a new game's `{ start: 'new' }`) with its tape, loads and splits. */
export async function replayRun(
  game: GameDef,
  layouts: Record<Id, Layout>,
  entries: readonly SessionEntry[],
  o: ReplayRunOptions = {},
): Promise<ReplayRunResult> {
  const links: TapeLink[] = [];
  const snapshots = new Map<number, GameState>();
  const wanted = new Set((o.loads ?? []).map((l) => l.from));
  const byBefore = new Map((o.loads ?? []).map((l) => [l.before, l]));
  const badLoads: RunLoad[] = [];
  const tracker = o.category && game.speedrun ? new SplitTracker(game.speedrun, o.category) : null;
  let tape: RunTape | undefined;
  let eng: Engine | undefined;
  // The engine's entries are counted by the tape; a snapshot is the state when an entry it names has closed.
  const track = (e: Engine) => {
    eng = e;
    tape = new RunTape(e, (l) => {
      links.push(l);
      tracker?.feed(l);
    });
    let n = 0;
    const indexOf = new Map<SessionEntry, number>();
    e.sessions.listeners.add({
      begin: (en) => indexOf.set(en, n++),
      end: (en) => {
        const i = indexOf.get(en);
        if (i !== undefined && wanted.has(i)) snapshots.set(i, structuredClone(e.state));
      },
    });
  };
  const run = replay(
    game,
    layouts,
    { start: { kind: 'new' }, log: [...entries] },
    {
      commands: o.commands,
      seed: o.seed,
      attach: track,
      beforeEntry: async (i, e) => {
        const l = byBefore.get(i);
        if (!l) return;
        const s = snapshots.get(l.from);
        if (!s || l.from >= l.before) {
          badLoads.push(l);
          return;
        }
        // A resume loads the run's own state as the resumed page did, with the journal unheard (as it was there).
        if (l.resume) await tape!.mute(() => e.load(structuredClone(s)));
        else await e.load(structuredClone(s));
      },
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await (o.timeoutMs
    ? Promise.race([
        run,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            eng?.destroy();
            reject(new Error(`the replay did not finish within ${o.timeoutMs} ms`));
          }, o.timeoutMs);
        }),
      ])
    : run
  ).finally(() => clearTimeout(timer));
  tape!.seal();
  tape!.detach();
  return { replay: result, links, tracker, badLoads };
}
