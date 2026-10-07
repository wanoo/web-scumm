// The player's speedrun mode (4.1.14 "Time Attack"): loaded on demand (`import()`) when a game with `speedrun` starts
// an attempt from the pause menu. It starts the recorder (tools/speedrun/recorder.ts) on the app's engine with the
// runs' IndexedDB store (dom/run-store.ts), shows a small timer with the current split and the ghost's line, tells the
// recorder when the pause menu or the background takes the screen, keeps the local records when the run ends, and
// hands out the sealed `.wsrun` (the pause menu's "Export run", the dev panel). It reads the engine, never writes it.
import type { ChunkStore } from '../core/journal-chunks';
import type { SpeedrunCategory } from '../core/types';
import type { SpeedrunEnvelope } from '../tools/speedrun/envelope';
import type { Ghost } from '../tools/speedrun/ghost';
import type { SpeedrunRecorder } from '../tools/speedrun/recorder';
import type { CategoryRecords } from '../tools/speedrun/records';
import type { SplitSignal } from '../tools/speedrun/splits';
import type { App } from './app';
import { el } from './app-shared';
import type { IndexedDbRunStore } from './run-store';

/** A store that can also keep records (IndexedDB in the browser; memory when IndexedDB is missing). */
type RunStore = ChunkStore & Partial<Pick<IndexedDbRunStore, 'getRecord' | 'putRecord'>>;

/** One attempt in the player: the recorder, its HUD and its records. */
export class SpeedrunSession {
  private hud: HTMLElement;
  private frame = 0;
  private offVisibility: () => void = () => {};
  private status = '';
  records: CategoryRecords | null = null;
  /** Off by default the first time a category is played (a ghost must not show the puzzles' answers). */
  ghostOn = false;
  /** The PB's ghost, on semantic targets (tools/speedrun/ghost.ts), when there is a PB and the ghost is on. */
  ghost: Ghost | null = null;

  private constructor(
    private app: App,
    readonly category: SpeedrunCategory,
    readonly recorder: SpeedrunRecorder,
    private store: RunStore,
  ) {
    this.hud = el('div', 'speedrun-hud');
    this.hud.setAttribute('aria-live', 'off');
    this.hud.setAttribute('data-category', category.id);
  }

  /** Starts an attempt in `category`: a new game with its seed, the clock and the splits on. */
  static async start(app: App, categoryId: string): Promise<SpeedrunSession> {
    const manifest = app.game.speedrun;
    const category = manifest?.categories.find((c) => c.id === categoryId);
    if (!manifest || !category) throw new Error(`no speedrun category "${categoryId}"`);
    const [{ SpeedrunRecorder }, { emptyRecords }, fingerprint] = await Promise.all([
      import('../tools/speedrun/recorder'),
      import('../tools/speedrun/records'),
      app.fingerprint(),
    ]);
    let store: RunStore;
    try {
      store = await (await import('./run-store')).IndexedDbRunStore.open();
    } catch {
      store = new (await import('../core/journal-chunks')).MemoryChunkStore();
    }
    const recorder = new SpeedrunRecorder({
      engine: app.engine,
      gameId: app.game.id,
      manifest,
      category,
      store,
      fingerprint,
      engineVersion: app.buildEngine ?? 'unknown',
    });
    const s = new SpeedrunSession(app, category, recorder, store);
    const key = `${app.game.id}:${category.id}`;
    s.records =
      (await store.getRecord?.<CategoryRecords>(key)) ?? emptyRecords(app.game.id, category.id, manifest.rulesVersion);
    const ghosts = await import('../tools/speedrun/ghost');
    s.ghostOn = ghosts.ghostByDefault(s.records.attempts);
    if (s.ghostOn && s.records.pb) {
      const pb = await (await import('../core/journal-chunks')).readRun(store, s.records.pb.runId);
      if (pb?.ok) s.ghost = new ghosts.Ghost(pb.chunks.flatMap((c) => c.links));
    }
    recorder.listeners.add((sig) => s.signal(sig));
    s.watchVisibility();
    app.scene.append(s.hud);
    s.tick();
    await recorder.start();
    return s;
  }

  private watchVisibility() {
    if (typeof document === 'undefined') return;
    const f = () => this.recorder.interval('background', document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', f);
    this.offVisibility = () => document.removeEventListener('visibilitychange', f);
  }

  /** The pause menu opened (`true`) or closed. */
  paused(on: boolean): void {
    this.recorder.interval('pause', on);
  }

  private signal(s: SplitSignal | { kind: 'sealed'; envelope: SpeedrunEnvelope }) {
    if (s.kind === 'split') this.status = s.split.id;
    else if (s.kind === 'missed') this.status = `${s.id} ✗`;
    else if (s.kind === 'sealed') void this.keep(s.envelope);
  }

  /** The run ended: the records updated (a PB, best segments) and kept on this device. */
  private async keep(envelope: SpeedrunEnvelope) {
    const { addRun } = await import('../tools/speedrun/records');
    const manifest = this.app.game.speedrun!;
    const t = this.recorder.tracker;
    this.records = addRun(this.records!, this.category, manifest.rulesVersion, {
      runId: this.recorder.runId,
      at: Date.now(),
      splits: t.splits,
      finish: t.finish,
    });
    await this.store.putRecord?.(`${this.app.game.id}:${this.category.id}`, this.records);
    this.status = envelope.finalProof.slice(0, 8);
  }

  /** The HUD's text: the category, the time it is ranked on, the last split. */
  text(): string {
    const c = this.app.engine.runClock;
    const fin = this.recorder.tracker.finish;
    const igt = fin
      ? BigInt(this.category.timing === 'active-igt' ? fin.activeTime : fin.logicalTime)
      : c.logicalTime();
    const ms = this.category.timing === 'rta' ? (fin?.rtaMs ?? this.recorder.rtaMs()) : Number(igt / 1000n);
    const m = Math.floor(ms / 60000);
    const sec = ((ms % 60000) / 1000).toFixed(1).padStart(4, '0');
    const g = this.ghostOn ? this.ghost?.at(c.logicalTime()) : null;
    const ghost = g ? ` · 👻 ${g.room ?? ''} ${g.action}` : '';
    return `${this.category.name} ${m}:${sec}${this.status ? ` · ${this.status}` : ''}${ghost}`;
  }

  private tick = () => {
    this.hud.textContent = this.text();
    if (typeof requestAnimationFrame === 'function' && this.hud.isConnected)
      this.frame = requestAnimationFrame(this.tick);
  };

  /** The sealed run, once the finish fired. */
  get envelope(): SpeedrunEnvelope | null {
    return this.recorder.envelope;
  }

  /** Downloads the sealed `.wsrun`. */
  async exportRun(): Promise<boolean> {
    const env = this.recorder.envelope;
    if (!env) return false;
    const { exportEnvelope } = await import('../tools/speedrun/envelope');
    const blob = new Blob([exportEnvelope(env)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.app.game.id}-${this.category.id.replace(/%/g, '')}.wsrun`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  }

  /** Gives up: the attempt is kept as abandoned in the records, the HUD goes. */
  async abandon(): Promise<void> {
    await this.recorder.abandon();
    const { addRun } = await import('../tools/speedrun/records');
    this.records = addRun(this.records!, this.category, this.app.game.speedrun!.rulesVersion, {
      runId: this.recorder.runId,
      at: Date.now(),
      splits: this.recorder.tracker.splits,
      finish: null,
    });
    await this.store.putRecord?.(`${this.app.game.id}:${this.category.id}`, this.records);
    this.destroy();
  }

  destroy(): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame);
    this.offVisibility();
    this.hud.remove();
  }
}
