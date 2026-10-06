import type { MotionSpec } from '../core/motion';
import { check } from '../core/cond';
import { Engine } from '../core/engine';
import type { Presenter, SaveStore, SlotStore } from '../core/ports';
import type { GameDef, GameState, Id, Layout, Point, RoomDef, VerbId } from '../core/types';
import { minigames as builtin, MINIGAME_CSS, type Minigame } from '../minigames';
import { Ending } from '../ending';
import type { CustomCommands } from '../core/custom';
import { AssetBank, type AssetManifest } from './assets';
import { Audio } from './audio';
import { FONT_PIXEL, FONT_UI, fontStack } from './fonts';
import { RoomView } from './room';
import { type AssetGraph } from '../core/asset-graph';
import { type OfflineStatus } from './offline';
import { uiFallbacks, uiText, type UiKey } from './ui-defaults';
import './style.css';

import {
  onKey as onKeyImpl,
  toScene as toSceneImpl,
  pickVerb as pickVerbImpl,
  resetVerb as resetVerbImpl,
  onItem as onItemImpl,
  verbFor as verbForImpl,
  actOnTarget as actOnTargetImpl,
  nearMiss as nearMissImpl,
  onScenePointer as onScenePointerImpl,
  onHover as onHoverImpl,
  sentence as sentenceImpl,
  showLabel as showLabelImpl,
  renderVerbs as renderVerbsImpl,
  renderInv as renderInvImpl,
} from './input';
import {
  say as sayImpl,
  transcribe as transcribeImpl,
  openTranscript as openTranscriptImpl,
  closeTranscript as closeTranscriptImpl,
  endSpeech as endSpeechImpl,
  choose as chooseImpl,
  phone as phoneImpl,
  callFrame as callFrameImpl,
  callFrames as callFramesImpl,
  openCall as openCallImpl,
  sizeCall as sizeCallImpl,
  callPose as callPoseImpl,
  hangUp as hangUpImpl,
} from './speech';
import { openMap as openMapImpl } from './map-view';
import {
  videoBg as videoBgImpl,
  credits as creditsImpl,
  pauseMenu as pauseMenuImpl,
  slotMenu as slotMenuImpl,
  restart as restartImpl,
  showTitle as showTitleImpl,
  layoutTitle as layoutTitleImpl,
} from './menus';
import { applySettings as applySettingsImpl, settingsMenu as settingsMenuImpl } from './settings';
import {
  offerUpdate as offerUpdateImpl,
  warmAround as warmAroundImpl,
  warmAll as warmAllImpl,
  offlineUrl as offlineUrlImpl,
  offlineUrls as offlineUrlsImpl,
  onOffline as onOfflineImpl,
} from './update';
import {
  buildShell as buildShellImpl,
  layout as layoutImpl,
  renderA11yTargets as renderA11yTargetsImpl,
} from './shell';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { LocalSlotStore, LocalStore, withPhase } from './storage';
import { el, esc, fpsMeter, sleep, type RealityLinkLike } from './app-shared';
export type { Settings } from './settings';
export { LocalSlotStore } from './storage';

export interface AppOptions {
  root: HTMLElement;
  game: GameDef;
  layouts: Record<Id, Layout>;
  manifest: AssetManifest;
  minigames?: Record<Id, Minigame>;
  /** Custom commands (`{ custom }`), from games/<id>/index.ts. */
  commands?: CustomCommands;
  /** Translations the game ships: the settings menu offers them (the page reloads with the choice). */
  languages?: { current: string; available: string[] };
  store?: SaveStore;
  /** Manual slots; default: the store when it has them (IndexedDB), else verified localStorage. */
  slots?: SlotStore;
  base?: string;
  /** Asset version (added to URLs to invalidate the cache). */
  version?: string;
}

/**
 * The in-browser application: landscape layout, verb and inventory column,
 * scene, lines, menus, map, minigames, sealed ending. Implements the core's Presenter.
 * Nothing in it is specific to a game: icons, sounds and fonts come from GameDef.skin, the texts from GameDef.ui.
 */
export class App implements Presenter {
  readonly engine: Engine;
  readonly bank: AssetBank;
  readonly audio: Audio;
  readonly game: GameDef;
  /** The world link (4.1.1, dom/reality-ui.ts), when the game declares `reality`. */
  reality?: RealityLinkLike;
  /** @internal Read by the modules of dom/ (4.1.0). */
  mg: Record<Id, Minigame>;
  private sealed!: Ending;
  readonly slots: SlotStore;
  /** Player preferences (`GameDef.settings`), kept in the browser outside the save. */
  settings: Settings = { ...DEFAULT_SETTINGS };
  /** @internal Read by the modules of dom/ (4.1.0). */
  root: HTMLElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  g!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  scol!: HTMLDivElement;
  scene!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  side!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  verbsEl!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  invEl!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  invNav!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  toolsEl!: HTMLDivElement;
  /** @internal Read by the modules of dom/ (4.1.0). */
  sbar!: HTMLDivElement;
  readonly view: RoomView;
  /** @internal Read by the modules of dom/ (4.1.0). */
  u = 1;
  /** @internal Read by the modules of dom/ (4.1.0). */
  sw = 640;
  // interaction
  /** @internal Read by the modules of dom/ (4.1.0). */
  verb: VerbId | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  a: Id | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  invPage = 0;
  /** "Desktop" layout: scene on top, verbs / inventory / menu at the bottom (classic SCUMM). */
  /** @internal Read by the modules of dom/ (4.1.0). */
  desk = false;
  /** @internal Read by the modules of dom/ (4.1.0). */
  get invCols() {
    return this.desk ? 4 : 3;
  }
  /** @internal Read by the modules of dom/ (4.1.0). */
  items: Id[] = [];
  /** Inventory items that have been used (greyed out). */
  /** @internal Read by the modules of dom/ (4.1.0). */
  used: Id[] = [];
  /** @internal Read by the modules of dom/ (4.1.0). */
  labelEl: HTMLDivElement | null = null;
  private sparkEl: HTMLImageElement | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  guideState: { verb: VerbId; target: Id } | null = null;
  // speech
  /** @internal Read by the modules of dom/ (4.1.0). */
  speechEl: HTMLElement | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  speechDone: (() => void) | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  speechTimer = 0;
  /** @internal Read by the modules of dom/ (4.1.0). */
  eatClick = -Infinity;
  /** The item was picked from the bag without a verb (4.0): the target decides, give to a character, use on the rest. */
  /** @internal Read by the modules of dom/ (4.1.0). */
  implicit = false;
  /** The last target tapped and when: a second tap on it soon after is a double tap (4.0, `defaultVerb`). */
  /** @internal Read by the modules of dom/ (4.1.0). */
  lastTap: { id: Id; t: number } | null = null;
  /** Taps on nothing next to a target, by `room/target` (3.8, `nearMiss`). */
  /** @internal Read by the modules of dom/ (4.1.0). */
  misses: Record<string, number> = {};
  /** @internal Read by the modules of dom/ (4.1.0). */
  inCutscene = false;
  /** @internal Read by the modules of dom/ (4.1.0). */
  saveError: string | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  warmedAll = false;
  /** The asset graph of the game, built on the first warm-up. */
  /** @internal Read by the modules of dom/ (4.1.0). */
  assets?: AssetGraph;
  /** @internal Read by the modules of dom/ (4.1.0). */
  offlineDone!: (s: OfflineStatus) => void;
  /** Where the full warm-up stands (`GameDef.offline`): only `complete` means the whole game is in the cache. */
  offlineStatus: OfflineStatus = { state: 'idle', done: 0, total: 0, failed: [] };
  /** Every minigame played in this page: won, or skipped with its Skip button (`mg-skip`), and how long it took. */
  readonly minigameLog: { id: Id; skipped: boolean; ms: number }[] = [];
  /** @internal Read by the modules of dom/ (4.1.0). */
  offlineWatchers = new Set<(s: OfflineStatus) => void>();
  /** Resolves with the final status of the first full warm-up (`complete`, `partial`, `skipped` or `off`). */
  readonly offlineReady: Promise<OfflineStatus> = new Promise((r) => {
    this.offlineDone = r;
  });
  private saveWarning: string | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  a11yTargets: HTMLDivElement | null = null;
  /** @internal Read by the modules of dom/ (4.1.0). */
  live!: HTMLDivElement;

  /** An interface text: the game's `ui`, else the English default (`dom/ui-defaults.ts`). */
  t(key: UiKey): string {
    return uiText(this.game.ui, key);
  }
  /** The `ui` keys this game leaves to the English defaults (the release-language e2e fails when one is visible). */
  uiFallbacks(): Record<string, string> {
    return uiFallbacks(this.game.ui);
  }

  /** Makes an asynchronous storage failure visible instead of silently claiming autosave success. */
  reportStorageError(error: Error) {
    if (this.saveError === error.message) return;
    this.saveError = error.message;
    if (this.scene) this.toast(`${this.t('saveFailed')}: ${error.message}`);
  }

  /** A content update may safely prune stale optional ids; tell the player without disabling Continue. */
  reportSaveWarning(message: string) {
    if (this.saveWarning === message) return;
    this.saveWarning = message;
    if (this.scene) this.toast(`${this.t('saveAdjusted')}: ${message}`);
  }

  /** Offers a service-worker update and activates it only after a verified autosave. */
  offerUpdate(activate: () => Promise<void>) {
    return offerUpdateImpl(this, activate);
  }

  /** @internal Read by the modules of dom/ (4.1.0). */
  withMusic(s: GameState): GameState {
    return withPhase(s, this.audio.phaseToSave());
  }

  constructor(/** @internal Read by the modules of dom/ (4.1.0). */ readonly o: AppOptions) {
    this.game = o.game;
    this.root = o.root;
    this.bank = new AssetBank(o.manifest, o.base ?? `${import.meta.env?.BASE_URL ?? '/'}assets`, o.version ?? '');
    // `?music=mix|stems` forces the single mix or the director's stems (tests, the Studio); else the device decides.
    const musicMode = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('music') : null;
    this.audio = new Audio(
      this.bank,
      {
        music: o.game.audio?.music,
        sfx: o.game.audio?.sfx,
        voice: o.game.audio?.voices,
        scores: o.game.audio?.scores,
        maxDecodedMB: o.game.audio?.maxDecodedMB,
        transitions: o.game.audio?.transitions,
      },
      musicMode === 'mix' ? { stems: false } : musicMode === 'stems' ? { stems: true } : {},
    );
    this.audio.holds = (c) => !!this.engine?.state && check(c, this.engine.state);
    this.mg = { ...builtin, ...(o.minigames ?? {}) };
    const storageFailure = (error: Error) => queueMicrotask(() => this.reportStorageError(error));
    const storageWarning = (message: string) => queueMicrotask(() => this.reportSaveWarning(message));
    this.engine = new Engine(
      o.game,
      o.layouts,
      this,
      o.store ?? new LocalStore(`${o.game.id}.save`, o.game, storageFailure, storageWarning),
      { commands: o.commands, runCustom: true, scene: () => this.scene },
    );
    // The music's phase (3.6): every save keeps where the music is, and a loaded save resumes it there.
    const store = this.engine.store as SaveStore & Partial<SlotStore>;
    const saveRaw = store.save.bind(store);
    store.save = (s) => saveRaw(this.withMusic(s));
    const loadRaw = this.engine.load.bind(this.engine);
    // Loading is a restore, not a scene change (3.6.1): the saved music at its point, with no transition or bridge.
    this.engine.load = async (s) => {
      this.audio.restore(s.music ?? null);
      try {
        return await loadRaw(s);
      } finally {
        this.audio.restored();
      }
    };
    this.slots =
      o.slots ??
      (typeof store.listSlots === 'function'
        ? (store as SlotStore)
        : new LocalSlotStore(o.game.id, o.game, storageFailure, storageWarning));
    this.view = new RoomView(this.engine, this.bank);
    // `?renderer=canvas|dom` forces a painter for every room (the visual parity check, the Studio's comparison).
    const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('renderer') : null;
    if (forced === 'canvas' || forced === 'dom') this.view.forced = forced;
    // `?fps` (3.8): a frame counter in a corner, now and the lowest second seen, for the real-phone pass (docs/en/FIELD.md).
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('fps')) fpsMeter();
    this.view.onSurface = (el, old) => {
      if (old.parentElement) old.replaceWith(el);
      else this.scene?.prepend(el);
    };
    // A walk stopped before a closed link: its refusal (`stage.links[id].locked`), the way an exit's `locked` is said.
    this.view.onBlocked = (l) => {
      if (l.locked) this.toast(l.locked);
    };
    this.engine.autoScripts = true;
    this.engine.clock = () => performance.now();
    this.engine.onChange = () => this.refresh();
    this.engine.digestOn = true;
    try {
      const raw = localStorage.getItem(`${o.game.id}.settings`);
      if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      /* no storage */
    }
    const F = o.game.skin?.fonts;
    document.documentElement.style.setProperty('--font-ui', fontStack(F?.ui ?? FONT_UI));
    document.documentElement.style.setProperty('--font-pixel', fontStack(F?.pixel ?? FONT_PIXEL));
    const st = document.createElement('style');
    st.textContent = MINIGAME_CSS;
    document.head.append(st);
    this.buildShell();
    this.applySettings();
    this.sealed = new Ending({
      game: this.game,
      scene: this.scene,
      img: (i) => this.bank.img(i),
      flags: () => this.engine.state.flags,
      minigame: (id, params) => this.minigame(id, params),
      toast: (t) => this.toast(t),
      sfx: (i) => this.audio.sfx(i),
      once: (i) => this.audio.once(i),
      play: (i) => this.audio.play(i),
      stopMusic: () => this.audio.stop(),
      replay: () => {
        void this.showTitle();
      },
      credits: () => this.credits(),
    });
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  // ================================================================== layout

  buildShell() {
    return buildShellImpl(this);
  }

  /** Escape closes the topmost thing (a menu, the map, the transcript, a cutscene's skip) or opens the pause menu;
   * Space and Enter advance a line of dialogue (a focused button already acts on Enter and Space on its own). */
  onKey(e: KeyboardEvent) {
    return onKeyImpl(this, e);
  }

  /** @internal Read by the modules of dom/ (4.1.0). */
  layout() {
    return layoutImpl(this);
  }

  toScene(e: PointerEvent): Point {
    return toSceneImpl(this, e);
  }

  // ================================================================== interaction

  pickVerb(v: VerbId) {
    return pickVerbImpl(this, v);
  }

  resetVerb() {
    return resetVerbImpl(this);
  }

  async onItem(id: Id) {
    return onItemImpl(this, id);
  }

  /** The verb a tap on this target means now: the chosen one, or (an item picked without a verb) give or use (4.0). */
  verbFor(target: Id): VerbId | null {
    return verbForImpl(this, target);
  }

  async actOnTarget(id: Id) {
    return actOnTargetImpl(this, id);
  }

  /** Keyboard and screen-reader representation of the visible coordinate-based scene hotspots. */
  renderA11yTargets() {
    return renderA11yTargetsImpl(this);
  }

  /**
   * A tap on nothing, close to something (3.8): a hotspot players aim at and miss. Counted by room and target, ids
   * only, for the playtest a tester shares (`misses` in the session file, `npm run playtests`).
   */
  nearMiss(p: Point) {
    return nearMissImpl(this, p);
  }

  async onScenePointer(e: PointerEvent) {
    return onScenePointerImpl(this, e);
  }

  onHover(e: PointerEvent) {
    return onHoverImpl(this, e);
  }

  sentence(target?: Id) {
    return sentenceImpl(this, target);
  }

  showLabel(id: Id | null) {
    return showLabelImpl(this, id);
  }

  renderVerbs() {
    return renderVerbsImpl(this);
  }

  renderInv() {
    return renderInvImpl(this);
  }

  private refresh() {
    this.side.classList.toggle('off', this.engine.busy && !this.choosing);
    if (this.engine.state && this.view.room) this.view.refreshVisibility();
    // The active character's button is hidden, the others show.
    for (const b of this.toolsEl.querySelectorAll<HTMLElement>('.tool.player'))
      b.hidden = b.dataset.player === this.engine.heroId();
    this.renderA11yTargets();
    this.audio.remix();
  }

  // ================================================================== Presenter

  async enterRoom(room: RoomDef) {
    this.resetVerb();
    this.showLabel(null);
    this.guide(null);
    this.scene.style.visibility = 'hidden';
    await this.view.build(room);
    this.view.resize(this.u);
    this.scene.style.visibility = '';
    this.renderA11yTargets();
    this.live.textContent = room.name;
    void this.warmAround(room.id);
  }

  say(who: Id, text: string, o: { shout?: boolean; fast?: boolean; voice?: Id }): Promise<void> {
    return sayImpl(this, who, text, o);
  }

  /** During a conversation, every line is also written in the panel, to be read at leisure. */
  /** @internal Read by the modules of dom/ (4.1.0). */
  transcript: HTMLElement | null = null;
  transcribe(who: Id, text: string, color: string) {
    return transcribeImpl(this, who, text, color);
  }
  openTranscript(who: Id | undefined, question: string) {
    return openTranscriptImpl(this, who, question);
  }
  closeTranscript() {
    return closeTranscriptImpl(this);
  }

  endSpeech() {
    return endSpeechImpl(this);
  }

  walk(who: Id, to: Point, fast: boolean) {
    return this.view.walkTo(who, to, fast);
  }
  face(who: Id, dir: 'left' | 'right') {
    this.view.face(who, dir);
  }
  pose(who: Id, pose: string) {
    this.view.pose(who, pose);
    this.callPose(who, pose);
  }
  anim(who: Id, pose: string, ms: number, fast: boolean) {
    return this.view.anim(who, pose, ms, fast);
  }
  place(who: Id, at: Point, face?: 'left' | 'right') {
    this.view.place(who, at, face);
  }
  wait(ms: number, fast: boolean) {
    return fast ? Promise.resolve() : sleep(ms);
  }
  prop(id: Id, state: string) {
    this.view.setProp(id, state);
    this.view.refreshVisibility();
  }
  propFrame(id: Id, img: Id | null) {
    this.view.propFrame(id, img);
  }
  propLoop(id: Id, frames: Id[], fps: number, onFrame?: (i: number) => void) {
    this.view.propLoop(id, frames, fps, onFrame);
  }
  camera(x: number | null, follow: boolean, ms: number, fast: boolean) {
    if (follow || x === null) {
      this.view.followHero();
      return Promise.resolve();
    }
    return this.view.setCamera(x, fast ? 0 : ms);
  }
  show(id: Id, visible: boolean, fade: number, fast: boolean) {
    return this.view.show(id, visible, fade, fast || this.settings.reduceMotion);
  }
  motion(who: Id, m: MotionSpec, fast: boolean, leader?: Id) {
    return this.view.motion(who, m, fast || this.view.reduceMotion, leader);
  }
  inventory(items: Id[], used?: Id[]) {
    this.used = [...(used ?? [])];
    if (!this.view.room) {
      this.items = [...items];
      return;
    }
    const previous = new Set(this.items);
    const added = items.length > this.items.length;
    this.items = [...items];
    if (added) {
      const names = items.filter((id) => !previous.has(id)).map((id) => this.game.items[id]?.name ?? id);
      if (names.length) this.live.textContent = names.join(', ');
    }
    if (added) this.invPage = Math.max(0, Math.ceil((items.length - this.invCols * 2) / this.invCols));
    this.renderInv();
    this.view.refreshVisibility();
    this.view.redraw();
  }
  sfx(id: Id, caption?: string) {
    this.audio.sfx(id);
    // A sound that matters, in writing (`{ sfx, caption }`), for whoever plays without sound or cannot hear it.
    if (caption && this.settings.captions && this.scene) {
      this.live.textContent = caption;
      const c = el('div', 'caption', esc(caption));
      this.scene.append(c);
      setTimeout(() => c.remove(), Math.max(1800, caption.length * 70));
    }
  }
  music(c: { play?: Id; push?: Id; pop?: true; stop?: true; once?: Id; stinger?: Id }) {
    if (c.play) this.audio.play(c.play);
    else if (c.push) this.audio.push(c.push);
    else if (c.pop) this.audio.pop();
    else if (c.stop) this.audio.stop();
    else if (c.once) this.audio.once(c.once);
    else if (c.stinger) this.audio.stinger(c.stinger);
  }
  toast(text: string) {
    this.live.textContent = text;
    const t = el('div', 'toast', esc(text));
    this.scene.append(t);
    setTimeout(() => t.remove(), 2400);
  }
  shake(ms: number) {
    if (this.settings.reduceMotion) return;
    this.scene.classList.add('shake');
    setTimeout(() => this.scene.classList.remove('shake'), ms);
  }

  guide(g: { verb: VerbId; target: Id } | null) {
    this.guideState = g;
    this.sparkEl?.remove();
    this.sparkEl = null;
    this.renderVerbs();
    this.renderInv();
    const spark = this.game.skin.icons.spark;
    if (!g || !spark || this.items.includes(g.target)) return;
    const b = this.view.box(g.target);
    if (!b) return;
    const s = el('img', 'spark') as HTMLImageElement;
    s.src = this.bank.img(spark);
    s.alt = '';
    const [sx, sy] = this.view.toScreen([b[0] + b[2] / 2, b[1] + b[3] / 2]);
    s.style.width = `${22 * this.u}px`;
    s.style.left = `${sx}px`;
    s.style.top = `${sy}px`;
    this.scene.append(s);
    this.sparkEl = s;
  }

  cutscene(on: boolean) {
    this.inCutscene = on;
    this.scene.classList.toggle('cine', on);
    this.scene.querySelector('.skip')?.remove();
    if (on) {
      const b = el('button', 'skip', esc(this.game.ui.skip));
      b.onclick = (e) => {
        e.stopPropagation();
        this.engine.skip();
        this.endSpeech();
      };
      queueMicrotask(() => b.focus({ preventScroll: true }));
      this.scene.append(b);
    }
  }

  // ---------------------------------------------------------------- choices and conversations

  /** @internal Read by the modules of dom/ (4.1.0). */
  choosing = false;
  choose(options: { text: string; seen?: boolean; global?: boolean }[], who?: Id): Promise<number> {
    return chooseImpl(this, options, who);
  }

  /** Call in progress: phone frame with the callers, animated mouth for whoever is speaking. */
  /** @internal Read by the modules of dom/ (4.1.0). */
  call: {
    ids: Id[];
    el: HTMLElement;
    timer: number;
    talking: Id | null;
    frames: ReturnType<App['callFrame']>[];
    imgs: HTMLImageElement[];
  } | null = null;

  async phone(whoIn: Id | Id[], ringing: boolean) {
    return phoneImpl(this, whoIn, ringing);
  }

  /** A caller's pose and images: the requested pose, otherwise the first of `skin.callPoses` (default `phone`, `front`, `face`, `idle`). */
  callFrame(id: Id, want?: string) {
    return callFrameImpl(this, id, want);
  }

  callFrames(ids: Id[]) {
    return callFramesImpl(this, ids);
  }

  /** Shows the phone frame (side by side, the first one in front) during the dialogue. */
  openCall(ids: Id[], frames: ReturnType<App['callFrames']>) {
    return openCallImpl(this, ids, frames);
  }

  /** Relative heights of the callers (each at their own size, pose included). */
  sizeCall() {
    return sizeCallImpl(this);
  }

  /** `{ pose }` during a call: the phone frame shows the new pose. */
  callPose(who: Id, pose: string) {
    return callPoseImpl(this, who, pose);
  }

  hangUp() {
    return hangUpImpl(this);
  }

  // ---------------------------------------------------------------- map

  async openMap(state: GameState): Promise<Id | null> {
    return openMapImpl(this, state);
  }

  // ---------------------------------------------------------------- minigames

  async minigame(id: Id, params: Record<string, unknown>) {
    const game = this.mg[id];
    if (!game) {
      console.warn('unknown minigame', id);
      return;
    }
    const host = el('div', 'overlay');
    host.style.background = '#000';
    this.scene.append(host);
    this.side.classList.add('off');
    const voice = this.game.characters[this.game.hintVoice ?? this.game.hero];
    let frame: HTMLElement | null = null;
    const ac = new AbortController();
    const entry = { id, skipped: false, ms: 0 };
    const t0 = performance.now();
    host.addEventListener('mg-skip', () => {
      entry.skipped = true;
    });
    try {
      await game.run({
        root: host,
        u: this.u,
        img: (i) => this.bank.img(i),
        size: (i) => this.bank.size(i),
        sfx: (i) => this.audio.sfx(i),
        instruct: (text) => {
          if (!frame) {
            frame = el('div', 'narr');
            frame.style.color = voice?.color ?? '#fff';
            frame.style.zIndex = '60';
            host.append(frame);
          }
          frame.innerHTML = `<span class="who">${esc((voice?.name ?? '').toUpperCase())}</span>${esc(text)}`;
        },
        params,
        signal: ac.signal,
        fonts: { ui: this.game.skin.fonts?.ui ?? FONT_UI, pixel: this.game.skin.fonts?.pixel ?? FONT_PIXEL },
        labels: { skip: this.game.ui.skip, jump: this.t('jump'), duck: this.t('duck') },
      });
    } finally {
      entry.ms = Math.round(performance.now() - t0);
      this.minigameLog.push(entry);
      ac.abort();
      host.remove();
      this.side.classList.remove('off');
    }
  }

  // ---------------------------------------------------------------- sealed ending (ending module)

  async ending(phase: 'open' | 'card') {
    if (phase === 'open') await this.sealed.open();
    else await this.sealed.card();
  }

  /** Silent looping video, framed as "cover"; the backdrop serves as a poster until it plays. */
  videoBg(file: string, poster?: Id): HTMLVideoElement {
    return videoBgImpl(this, file, poster);
  }

  credits() {
    return creditsImpl(this);
  }

  end() {
    /* the sealed ending handles the end screen */
  }

  // ================================================================== out-of-game screens

  pauseMenu() {
    return pauseMenuImpl(this);
  }

  /** Applies the preferences: fonts, text size, volumes, motion. */
  applySettings() {
    return applySettingsImpl(this);
  }

  /** The settings menu: each row cycles its value. */
  settingsMenu(d: HTMLElement, m: HTMLElement) {
    return settingsMenuImpl(this, d, m);
  }

  /** The save / load menu: one row per slot, export and import as a JSON file. */
  async slotMenu(d: HTMLElement, m: HTMLElement, mode: 'save' | 'load', count: number) {
    return slotMenuImpl(this, d, m, mode, count);
  }

  /** "Restart from the beginning": the autosave must go first; when the browser refuses, the player keeps the game. */
  async restart() {
    return restartImpl(this);
  }

  /** Title screen, then launches the game. */
  async showTitle() {
    return showTitleImpl(this);
  }

  /**
   * Background preload scoped to the current room and immediately reachable rooms. The room renderer itself still
   * blocks on exactly what it needs; this only fills the runtime cache during idle time and respects constrained links.
   */
  async warmAround(roomId: Id, initial = false) {
    return warmAroundImpl(this, roomId, initial);
  }

  /**
   * The rest of the game, for offline play (`GameDef.offline`, default `full`): once per page, after the room-scoped
   * warm-up, batch by batch during idle time, paused while the page is hidden. The room renderer never waits for it.
   */
  async warmAll(retry = false) {
    return warmAllImpl(this, retry);
  }

  offlineUrl(kind: string, id: string) {
    return offlineUrlImpl(this, kind, id);
  }

  /** Every URL the full warm-up caches (`scripts/e2e-pwa.mjs` checks each one against the cache, offline). */
  offlineUrls(): string[] {
    return offlineUrlsImpl(this);
  }

  /** Watches the warm-up status (the pause menu's row); returns the unsubscribe. */
  onOffline(w: (s: OfflineStatus) => void): () => void {
    return onOfflineImpl(this, w);
  }

  /** The title screen takes up the full width (no side column). */
  layoutTitle(full: boolean) {
    return layoutTitleImpl(this, full);
  }
}
