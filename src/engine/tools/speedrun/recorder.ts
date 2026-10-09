// A speedrun attempt being played (4.1.14 "Time Attack"): the recorder attaches the run's tape to the player's engine,
// writes its links into chunks (core/journal-chunks.ts) as they come, follows the category's splits, notes the
// client's declarations (pauses, menus, the background, loads and saves, the inputs used) and seals the `.wsrun`
// envelope at the finish. It never writes the game's state (D24): the run's own loads are the player's, and a resume
// after a crash restores what the last stored chunk recorded. The browser gives it the IndexedDB store; Node a memory one.
// 4.1.16 (ADR 0019): it records the world the run is played in (the engine's, or the one it is given), refuses to start
// a run its category could not rank, and a resume in another world.
import { stateDigest } from '../../core/diff';
import type { Engine } from '../../core/engine';
import type { GameFingerprint } from '../../core/fingerprint';
import type { ClockSnapshot } from '../../core/run-clock';
import { ChunkedJournal, type ChunkStore, readRun } from '../../core/journal-chunks';
import { canonicalJson } from '../../core/canonical';
import { newSeed } from '../../core/prng';
import { categoryWorld, runSeedPolicy, worldVerdict } from '../../core/remix/categories';
import { storyWorld, type WorldVariant } from '../../core/remix/story';
import { RunTape, type TapeLink } from '../../core/run-tape';
import type { ExternalEntry, GameState, SpeedrunCategory, SpeedrunManifest } from '../../core/types';
import {
  type ExcludedInterval,
  type HeadWorld,
  headHash,
  type RecordedRealitySignal,
  sealEnvelope,
  type SpeedrunEnvelopeV2,
  type SpeedrunWorldEvidence,
} from './envelope';
import { sha256Hex } from '../../core/fingerprint';
import type { RunLoad } from './replay-run';
import { type SplitSignal, SplitTracker } from './splits';
import { matches } from './triggers';

/** What a stored chunk's head keeps to resume the run at its end. */
export interface ResumePoint {
  state: GameState;
  clock: ClockSnapshot;
  draws: { seed: string; state: [number, number, number, number] } | null;
  next: number;
  rtaMs: number;
  excluded: ExcludedInterval[];
  loads: RunLoad[];
  inputs: string[];
  /** The digest after each entry the run reached (the loads it may make). */
  digests: [string, number][];
  /** The signals from outside recorded so far (their JWS: the Reality proof). */
  signals: RecordedRealitySignal[];
  /** The run's world and what it rests on (4.1.16): a resume rebuilds it, never another. */
  world?: HeadWorld;
  /** The run's generator seed (4.1.16): the head seals it, so a resume seals with it whatever the draws say. */
  runSeed?: string;
}

export interface RecorderOptions {
  engine: Engine;
  gameId: string;
  manifest: SpeedrunManifest;
  category: SpeedrunCategory;
  store: ChunkStore;
  fingerprint: GameFingerprint;
  engineVersion: string;
  /** The run's id in the store (default: a fresh one). */
  runId?: string;
  /** A monotonic clock in milliseconds (default: the engine's run clock source). */
  now?: () => number;
  /** The world the run is played in (default: the engine's game's, else its story world). */
  variant?: WorldVariant;
  /** A Daily or Mystery world's tokens from the Bridge, verified before the start. */
  worldEvidence?: SpeedrunWorldEvidence;
}

/** Why a run may not start (its world is not the one its category ranks): said before the clock runs. @public */
export class RunStartRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(`this run cannot be ranked in its category: ${reasons.join('; ')}`);
    this.name = 'RunStartRefused';
  }
}

/** What a recorder records the run in: the world given, else the engine's game's, else that game's story world. */
function worldOf(o: RecorderOptions): WorldVariant {
  if (o.variant) return o.variant;
  const game = (o.engine as Engine | null)?.game;
  if (!game) throw new Error('a recorder without an engine is given the world of its run (`variant`)');
  return game.variant ?? storyWorld(game.remix);
}

/**
 * Whether a run in `variant` can be ranked in its category, before it starts: the world's policy (a Fixed run on its
 * seed, a Story run in the story world, a Remix run in its mode), and the evidence a Daily or Mystery world needs
 * (verified by the client before, by the verifier after: here, only that it is there).
 */
function startable(world: HeadWorld): string[] {
  const { policy, variant, evidence } = world;
  if (policy.policy === 'daily' || policy.policy === 'mystery') {
    const out =
      variant.mode === policy.mode ? [] : [`the world's mode is ${variant.mode}, the category's ${policy.mode}`];
    if (evidence?.kind !== policy.policy) out.push(`a ${policy.policy} run starts with the Bridge's signed tokens`);
    return out;
  }
  return worldVerdict(policy, variant);
}

/** One attempt: `start()`, play, then `finish` fires and `envelope` is sealed (or `abandon()`). */
export class SpeedrunRecorder {
  readonly runId: string;
  seed: string;
  private tape: RunTape | null = null;
  private journal: ChunkedJournal<ResumePoint> | null = null;
  readonly tracker: SplitTracker;
  private h0 = '';
  private t0: number | null = null;
  private excluded: ExcludedInterval[] = [];
  private loads: RunLoad[] = [];
  private inputs = new Set<string>();
  private digests = new Map<string, number>();
  private openIntervals = new Map<ExcludedInterval['kind'], number>();
  private offJournal: (() => void) | null = null;
  private last: TapeLink | null = null;
  private resuming = false;
  /** The world the run is played in, sealed into its head. */
  world: HeadWorld | null = null;
  /** The sealed envelope once the finish fired. */
  envelope: SpeedrunEnvelopeV2 | null = null;
  /** Hears every split signal and the sealed envelope (the HUD, the overlay bridge, LiveSplit). */
  readonly listeners = new Set<(s: SplitSignal | { kind: 'sealed'; envelope: SpeedrunEnvelopeV2 }) => void>();
  private sealing: Promise<SpeedrunEnvelopeV2> | null = null;
  private pendingSignals: Promise<RecordedRealitySignal>[] = [];
  private signals: RecordedRealitySignal[] = [];
  /** Why sealing failed (a store that refused the last chunk), if it did. */
  failure: Error | null = null;
  /** The finish trigger fired: the tape is sealed as soon as no entry is open. */
  private finishing = false;
  private seenStart = false;

  constructor(private o: RecorderOptions) {
    this.runId = o.runId ?? `run-${newSeed().slice(0, 16)}`;
    this.seed = runSeedPolicy(o.category) === 'fixed' ? `fixed:${o.category.id}` : newSeed();
    this.tracker = new SplitTracker(o.manifest, o.category);
  }

  private now(): number {
    return this.o.now ? this.o.now() : this.o.engine.runClock.monotonicNow();
  }
  /** Milliseconds since the run's start (0 before it). */
  rtaMs(): number {
    return this.t0 === null ? 0 : Math.round(this.now() - this.t0);
  }

  private attach(first = 0) {
    const eng = this.o.engine;
    eng.digestOn = true;
    this.tape = new RunTape(eng, (l) => this.onLink(l), first);
    // A load the player makes: from a state this run reached (its digest), or from outside the run.
    const finishWatch = {
      end: () => {
        if (this.finishing && !eng.sessions.open.length) {
          this.finishing = false;
          this.tape?.seal();
        }
      },
    };
    eng.sessions.listeners.add(finishWatch);
    const offEvents = eng.journal.subscribe((ev) => {
      if (!this.resuming && matches(this.o.category.start, ev)) this.seenStart = true;
      if ((this.seenStart || this.tracker.started) && !this.tracker.finished && matches(this.o.category.finish, ev))
        this.finishing = true;
      if (ev.kind !== 'loadMade' || this.resuming || !this.tape) return;
      const from = this.digests.get(stateDigest(eng.state));
      this.loads.push({ before: this.tape.size, from: from ?? -1 });
      this.excluded.push({ kind: 'load', entry: this.tape.size, atMs: this.rtaMs(), durationMs: 0 });
    });
    this.offJournal = () => {
      offEvents();
      eng.sessions.listeners.delete(finishWatch);
    };
  }

  /** Starts the attempt: a new game with the category's seed. Resolves when the new game's first entry is done. */
  async start(): Promise<void> {
    await this.prepare();
    this.bind();
    await this.o.engine.newGame();
  }

  /** The run's head and first chunk's place in the store (before any engine is touched). */
  async prepare(): Promise<void> {
    const { category, manifest, fingerprint } = this.o;
    const world: HeadWorld = {
      variant: worldOf(this.o),
      policy: categoryWorld(category).world,
      ...(this.o.worldEvidence ? { evidence: this.o.worldEvidence } : {}),
    };
    const refused = startable(world);
    if (refused.length) throw new RunStartRefused(refused);
    this.world = world;
    this.h0 = await headHash({ fingerprint, category, rulesVersion: manifest.rulesVersion, seed: this.seed, world });
    this.journal = new ChunkedJournal<ResumePoint>(this.o.store, this.runId, this.h0, undefined, () =>
      this.resumePoint(),
    );
    await this.o.store.putHead({ runId: this.runId, chunks: 0, lastHash: this.h0, h0: this.h0, updatedAt: Date.now() });
  }

  /**
   * Binds the prepared run to an engine about to start a new game (its seed, the tape): `start()` does it, and a tool
   * that drives the engine itself (a replay of a route recorded as a run) calls it from `replay`'s `attach`.
   */
  bind(engine: Engine = this.o.engine): void {
    this.o.engine = engine;
    engine.sessions.nextSeed = this.seed;
    this.attach();
  }

  private resumePoint(): ResumePoint {
    const eng = this.o.engine;
    return {
      state: structuredClone(eng.state),
      clock: eng.runClock.snapshot(),
      draws: eng.sessions.drawState(),
      next: (this.last?.index ?? -1) + 1,
      rtaMs: this.rtaMs(),
      excluded: structuredClone(this.excluded),
      loads: structuredClone(this.loads),
      inputs: [...this.inputs],
      digests: [...this.digests.entries()],
      signals: structuredClone(this.signals),
      ...(this.world ? { world: structuredClone(this.world) } : {}),
      runSeed: this.seed,
    };
  }

  private onLink(l: TapeLink) {
    this.last = l;
    this.journal?.push(l);
    if (l.entry.digest) this.digests.set(l.entry.digest, l.index);
    const signals = this.tracker.feed(l, this.now());
    for (const s of signals) {
      if (s.kind === 'start') this.t0 = this.now();
      for (const f of this.listeners) f(s);
      if (s.kind === 'finish')
        this.seal().catch((e) => {
          this.failure = e instanceof Error ? e : new Error(String(e));
        });
    }
  }

  /** The client declares an input method it used (the inputs a category allows are checked on these). */
  input(kind: 'mouse' | 'touch' | 'keyboard' | 'gamepad'): void {
    this.inputs.add(kind);
  }

  /** A pause, a menu or the background began (`on`) or ended: an RTA interval the category's rules read. */
  interval(kind: 'pause' | 'menu' | 'background', on: boolean): void {
    if (on) {
      if (!this.openIntervals.has(kind)) this.openIntervals.set(kind, this.rtaMs());
      return;
    }
    const at = this.openIntervals.get(kind);
    if (at === undefined) return;
    this.openIntervals.delete(kind);
    this.excluded.push({ kind, entry: this.tape?.size ?? 0, atMs: at, durationMs: Math.max(0, this.rtaMs() - at) });
  }

  /** A signal from outside, with its signed JWS (the Reality client's `onSigned`): the run's Reality proof. */
  realitySignal(jws: string, x: ExternalEntry): void {
    const kid = (() => {
      try {
        const h = jws.split('.')[0] ?? '';
        return (JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))) as { kid?: string }).kid;
      } catch {
        return undefined;
      }
    })();
    this.pendingSignals.push(
      sha256Hex(jws).then((hash) => ({
        id: x.id,
        sequence: x.sequence,
        signal: x.signal,
        source: x.source,
        receivedAt: x.receivedAt,
        jws,
        ...(kid ? { kid } : {}),
        hash,
        verdict: x.skipped ? ('skipped' as const) : ('ok' as const),
      })),
    );
    void this.pendingSignals.at(-1)!.then((sig) => this.signals.push(sig));
  }

  /** A manual save into a slot (the autosave is not one). */
  saved(): void {
    this.excluded.push({ kind: 'save', entry: this.tape?.size ?? 0, atMs: this.rtaMs(), durationMs: 0 });
  }

  /** Seals the run at its finish: the last links, the last chunk, the envelope. */
  seal(): Promise<SpeedrunEnvelopeV2> {
    this.sealing ??= this.doSeal();
    return this.sealing;
  }

  private async doSeal(): Promise<SpeedrunEnvelopeV2> {
    const { engine: eng, category, manifest } = this.o;
    const fin = this.tracker.finish;
    if (!fin) throw new Error('the run has not reached its finish');
    for (const k of [...this.openIntervals.keys()]) this.interval(k as 'pause', false);
    this.tape!.seal();
    this.detach();
    await this.journal!.seal('finished');
    const stored = (await readRun(this.o.store, this.runId))!;
    const links = stored.chunks.flatMap((c) => c.links);
    const finishLink = links.find((l) => l.index === fin.entry)!;
    const envelope = await sealEnvelope({
      gameId: this.o.gameId,
      fingerprint: this.o.fingerprint,
      engineVersion: this.o.engineVersion,
      category,
      rulesVersion: manifest.rulesVersion,
      seed: this.seed,
      world: this.world!,
      links: links.slice(0, fin.entry + 1),
      finish: { ...fin, logicalSteps: finishLink.logicalSteps },
      splits: this.tracker.splits,
      excluded: this.excluded,
      loads: this.loads,
      inputsUsed: [...this.inputs] as SpeedrunEnvelopeV2['inputsUsed'],
      realitySignals: await Promise.all(this.pendingSignals),
      finalState: eng.state,
    });
    this.envelope = envelope;
    for (const f of this.listeners) f({ kind: 'sealed', envelope });
    return envelope;
  }

  /** Waits for the chunks closed so far to be written (a test; a page about to be hidden). */
  async flushed(): Promise<void> {
    await this.journal?.idle();
  }

  /** Gives up the attempt: the run is kept, marked abandoned (the records count it). */
  async abandon(): Promise<void> {
    this.tape?.seal();
    this.detach();
    await this.journal?.seal('abandoned');
  }

  private detach() {
    this.tape?.detach();
    this.offJournal?.();
    this.offJournal = null;
  }

  /**
   * Resumes a run after the page was closed: the state, the clock, the draws and the declarations of the last stored
   * chunk, on a fresh engine. What was played after that chunk is lost (at most a chunk). Null: nothing to resume.
   */
  static async resume(o: RecorderOptions & { runId: string }): Promise<SpeedrunRecorder | null> {
    const run = await readRun(o.store, o.runId);
    if (!run || run.head.sealed || !run.chunks.length) return null;
    const point = (run.head.chunks === run.chunks.length ? run.head.resume : undefined) as ResumePoint | undefined;
    if (!point) return null;
    // The world of a run is its own: a stored chunk of 4.1.15 has none (its run cannot be sealed in schema 2); a world
    // given now, or the engine's, must be the one the run started in.
    if (!point.world) throw new RunStartRefused(['this stored run predates the world binding (4.1.16): start again']);
    // The world now: the one given, else the engine's (its story world when it has none), never left unchecked.
    const now = worldOf(o);
    if (now.hash !== point.world.variant.hash)
      throw new RunStartRefused([`this run was played in world ${point.world.variant.seed}, not ${now.seed}`]);
    if (canonicalJson(categoryWorld(o.category).world) !== canonicalJson(point.world.policy))
      throw new RunStartRefused(["this run's category no longer plays the world it was started in"]);
    // 4.1.17: its proof too (a Daily token, a Mystery commitment and reveal): the one sealed in its head, never another.
    // A Mystery's `startedAt` is when the page started it, not its proof: compared without it, the sealed one stays.
    const proof = (e: SpeedrunWorldEvidence | undefined) =>
      canonicalJson(e?.kind === 'mystery' ? { ...e, startedAt: 0 } : (e ?? null));
    if (o.worldEvidence && proof(o.worldEvidence) !== proof(point.world.evidence))
      throw new RunStartRefused(['this run rests on another proof of its world than the one given now']);
    const r = new SpeedrunRecorder(o);
    const eng = o.engine;
    r.world = point.world;
    r.seed = point.runSeed ?? point.draws?.seed ?? r.seed;
    r.h0 = run.head.h0;
    r.excluded = point.excluded;
    r.loads = point.loads;
    r.inputs = new Set(point.inputs);
    r.digests = new Map(point.digests);
    r.signals = point.signals ?? [];
    r.pendingSignals = r.signals.map((x) => Promise.resolve(x));
    for (const c of run.chunks) for (const l of c.links) r.tracker.feed(l, null);
    r.journal = new ChunkedJournal<ResumePoint>(
      o.store,
      o.runId,
      run.head.h0,
      { chunks: run.chunks.length, lastHash: run.lastHash },
      () => r.resumePoint(),
    );
    r.resuming = true;
    try {
      r.attach(point.next);
      await r.tape!.mute(() => eng.load(structuredClone(point.state)));
    } finally {
      r.resuming = false;
    }
    eng.runClock.restore(point.clock);
    if (point.draws) eng.sessions.restoreDraws(point.draws);
    r.loads.push({ before: point.next, from: point.next - 1, resume: true });
    // The live RTA goes on from where the chunk closed (the time the page was closed is not counted).
    r.t0 = r.now() - point.rtaMs;
    return r;
  }
}
