import { check } from '../core/cond';
import { sayMs } from '../core/timing';
import { Engine } from '../core/engine';
import type { Presenter, SaveStore, SlotMeta, SlotStore } from '../core/ports';
import type { GameDef, GameState, Id, Layout, Point, RoomDef, VerbId } from '../core/types';
import { minigames as builtin, MINIGAME_CSS, type Minigame } from '../minigames';
import { Ending } from '../ending';
import type { CustomCommands } from '../core/custom';
import { AssetBank, type AssetManifest } from './assets';
import { Audio } from './audio';
import { FONT_PIXEL, FONT_UI, fontStack } from './fonts';
import { RoomView } from './room';
import { isTyping, roving, trapFocus } from './a11y';
import { assetGraph, splitKey, type AssetGraph, type AssetKind } from '../core/asset-graph';
import { offlinePlan, offlineFinish, offlineFold, offlineStart, offlineText, type OfflineStatus } from './offline';
import { uiFallbacks, uiText, type UiKey } from './ui-defaults';
import './style.css';
import { parseSave, parseSlot, saveEnvelope, type SlotRecord } from '../core/save';

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

class LocalStore implements SaveStore {
  constructor(private key: string, private game: GameDef, private fail: (error: Error) => void, private warn: (message: string) => void) {}
  load(): GameState | null {
    try { const v = localStorage.getItem(this.key); return v ? parseSave(this.game, JSON.parse(v), { warn: this.warn }) : null; }
    catch (e) { this.fail(e as Error); return null; }
  }
  save(s: GameState) {
    try {
      const raw = JSON.stringify(saveEnvelope(this.game, s));
      localStorage.setItem(this.key, raw);
      const check = localStorage.getItem(this.key);
      if (!check) throw new Error('the browser did not retain the autosave');
      parseSave(this.game, JSON.parse(check));
    } catch (e) { this.fail(e as Error); }
  }
  async clear() { try { localStorage.removeItem(this.key); return true; } catch (e) { this.fail(e as Error); return false; } }
}

/** Player preferences (see `GameDef.settings`). */
export interface Settings { textSpeed: number; textSize: number; reduceMotion: boolean; readableFont: boolean; musicVolume: number; sfxVolume: number; voiceVolume: number }
const DEFAULT_SETTINGS: Settings = { textSpeed: 1, textSize: 1, reduceMotion: false, readableFont: false, musicVolume: 1, sfxVolume: 1, voiceVolume: 1 };

/** Manual slots in localStorage (`<game>.slot.<n>`), the fallback when IndexedDB is unavailable; verified like the autosave. */
export class LocalSlotStore implements SlotStore {
  constructor(private prefix: string, private game: GameDef, private fail: (error: Error) => void, private warn: (message: string) => void) {}
  private key(n: number) { return `${this.prefix}.slot.${n}`; }
  private read(n: number): { meta: SlotMeta; state: GameState } | null {
    try { const v = localStorage.getItem(this.key(n)); return v ? parseSlot(this.game, JSON.parse(v), { warn: this.warn }) : null; }
    catch (e) { this.fail(e as Error); return null; }
  }
  async listSlots(count: number) { return Array.from({ length: count }, (_, i) => this.read(i + 1)?.meta ?? null); }
  async getSlot(n: number) { return this.read(n)?.state ?? null; }
  async putSlot(n: number, state: GameState, meta: SlotMeta) {
    try {
      const record: SlotRecord = { meta, envelope: saveEnvelope(this.game, state) };
      const raw = JSON.stringify(record); localStorage.setItem(this.key(n), raw);
      if (localStorage.getItem(this.key(n)) !== raw) throw new Error('the browser did not retain the save slot');
      return true;
    } catch (e) { this.fail(e as Error); return false; }
  }
  async clearSlot(n: number) { try { localStorage.removeItem(this.key(n)); return true; } catch (e) { this.fail(e as Error); return false; } }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  // Images are decorative unless a caller names them (the scene is reachable through the a11y targets, items by name).
  if (tag === 'img') (e as HTMLImageElement).alt = '';
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

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
  private mg: Record<Id, Minigame>;
  private sealed!: Ending;
  readonly slots: SlotStore;
  /** Player preferences (`GameDef.settings`), kept in the browser outside the save. */
  settings: Settings = { ...DEFAULT_SETTINGS };
  private root: HTMLElement;
  private g!: HTMLDivElement;
  private scol!: HTMLDivElement;
  scene!: HTMLDivElement;
  private side!: HTMLDivElement;
  private verbsEl!: HTMLDivElement;
  private invEl!: HTMLDivElement;
  private invNav!: HTMLDivElement;
  private toolsEl!: HTMLDivElement;
  private sbar!: HTMLDivElement;
  readonly view: RoomView;
  private u = 1;
  private sw = 640;
  // interaction
  private verb: VerbId | null = null;
  private a: Id | null = null;
  private invPage = 0;
  /** "Desktop" layout: scene on top, verbs / inventory / menu at the bottom (classic SCUMM). */
  private desk = false;
  private get invCols() { return this.desk ? 4 : 3; }
  private items: Id[] = [];
  /** Inventory items that have been used (greyed out). */
  private used: Id[] = [];
  private labelEl: HTMLDivElement | null = null;
  private sparkEl: HTMLImageElement | null = null;
  private guideState: { verb: VerbId; target: Id } | null = null;
  // speech
  private speechEl: HTMLElement | null = null;
  private speechDone: (() => void) | null = null;
  private speechTimer = 0;
  private eatClick = -Infinity;
  private inCutscene = false;
  private saveError: string | null = null;
  private warmedAll = false;
  /** The asset graph of the game, built on the first warm-up. */
  private assets?: AssetGraph;
  private offlineDone!: (s: OfflineStatus) => void;
  /** Where the full warm-up stands (`GameDef.offline`): only `complete` means the whole game is in the cache. */
  offlineStatus: OfflineStatus = { state: 'idle', done: 0, total: 0, failed: [] };
  /** Every minigame played in this page: won, or skipped with its Skip button (`mg-skip`), and how long it took. */
  readonly minigameLog: { id: Id; skipped: boolean; ms: number }[] = [];
  private offlineWatchers = new Set<(s: OfflineStatus) => void>();
  /** Resolves with the final status of the first full warm-up (`complete`, `partial`, `skipped` or `off`). */
  readonly offlineReady: Promise<OfflineStatus> = new Promise((r) => { this.offlineDone = r; });
  private saveWarning: string | null = null;
  private a11yTargets: HTMLDivElement | null = null;
  private live!: HTMLDivElement;

  /** An interface text: the game's `ui`, else the English default (`dom/ui-defaults.ts`). */
  t(key: UiKey): string { return uiText(this.game.ui, key); }
  /** The `ui` keys this game leaves to the English defaults (the release-language e2e fails when one is visible). */
  uiFallbacks(): Record<string, string> { return uiFallbacks(this.game.ui); }

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
    if (this.root.querySelector('.update-banner')) return;
    const box = el('div', 'update-banner');
    box.setAttribute('role', 'status');
    const text = el('span', '', esc(this.t('updateAvailable')));
    const button = el('button', '', esc(this.t('updateNow')));
    button.onclick = async () => {
      button.disabled = true;
      this.saveError = null;
      try {
        // On the untouched title screen there is no progress to persist; do not create a misleading Continue save.
        if (this.engine.hasSave()) {
          this.engine.save();
          await this.engine.store.whenIdle?.();
        }
        if (this.saveError) throw new Error(this.saveError);
        await activate();
      } catch (e) {
        this.reportStorageError(e instanceof Error ? e : new Error(String(e)));
        button.disabled = false;
      }
    };
    box.append(text, button);
    this.root.append(box);
  }

  constructor(private o: AppOptions) {
    this.game = o.game;
    this.root = o.root;
    this.bank = new AssetBank(o.manifest, o.base ?? `${import.meta.env?.BASE_URL ?? '/'}assets`, o.version ?? '');
    this.audio = new Audio(this.bank, { music: o.game.audio?.music, sfx: o.game.audio?.sfx, voice: o.game.audio?.voices });
    this.mg = { ...builtin, ...(o.minigames ?? {}) };
    const storageFailure = (error: Error) => queueMicrotask(() => this.reportStorageError(error));
    const storageWarning = (message: string) => queueMicrotask(() => this.reportSaveWarning(message));
    this.engine = new Engine(o.game, o.layouts, this, o.store ?? new LocalStore(`${o.game.id}.save`, o.game, storageFailure, storageWarning), { commands: o.commands, runCustom: true, scene: () => this.scene });
    const store = this.engine.store as SaveStore & Partial<SlotStore>;
    this.slots = o.slots ?? (typeof store.listSlots === 'function' ? (store as SlotStore) : new LocalSlotStore(o.game.id, o.game, storageFailure, storageWarning));
    this.view = new RoomView(this.engine, this.bank);
    // `?renderer=canvas|dom` forces a painter for every room (the visual parity check, the Studio's comparison).
    const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('renderer') : null;
    if (forced === 'canvas' || forced === 'dom') this.view.forced = forced;
    this.view.onSurface = (el, old) => { if (old.parentElement) old.replaceWith(el); else this.scene?.prepend(el); };
    this.engine.autoScripts = true;
    this.engine.clock = () => performance.now();
    this.engine.onChange = () => this.refresh();
    this.engine.digestOn = true;
    try { const raw = localStorage.getItem(`${o.game.id}.settings`); if (raw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch { /* no storage */ }
    const F = o.game.skin?.fonts;
    document.documentElement.style.setProperty('--font-ui', fontStack(F?.ui ?? FONT_UI));
    document.documentElement.style.setProperty('--font-pixel', fontStack(F?.pixel ?? FONT_PIXEL));
    const st = document.createElement('style');
    st.textContent = MINIGAME_CSS;
    document.head.append(st);
    this.buildShell();
    this.applySettings();
    this.sealed = new Ending({
      game: this.game, scene: this.scene, img: (i) => this.bank.img(i), flags: () => this.engine.state.flags,
      minigame: (id, params) => this.minigame(id, params), toast: (t) => this.toast(t), sfx: (i) => this.audio.sfx(i),
      once: (i) => this.audio.once(i), play: (i) => this.audio.play(i), stopMusic: () => this.audio.stop(),
      replay: () => { void this.showTitle(); }, credits: () => this.credits(),
    });
    window.addEventListener('resize', () => this.layout());
    this.layout();
  }

  // ================================================================== layout

  private buildShell() {
    this.root.innerHTML = '';
    const rot = el('div', 'rotate', `<div class="ph"></div><div style="font-size:22px;color:#ffd84d">${esc(this.game.ui.rotate)}</div><div style="max-width:260px;color:#a99fbd">${esc(this.game.ui.rotateSub)}</div>`);
    document.body.append(rot);
    this.g = el('div', 'game');
    this.scol = el('div', 'scol');
    this.scene = el('div', 'scene');
    // Pixel-art games: sprites and backgrounds scaled up with hard edges (style.css `.scene.pixel img`).
    if (this.game.skin?.pixelArt) this.scene.classList.add('pixel');
    this.scene.append(this.view.el);
    this.live = el('div', 'sr-only'); this.live.setAttribute('aria-live', 'polite'); this.live.setAttribute('aria-atomic', 'true');
    this.scene.append(this.live);
    this.scene.append(el('div', 'letter t'), el('div', 'letter b'));
    this.sbar = el('div', 'sbar');
    this.scene.append(this.sbar);
    this.scol.append(this.scene);
    this.side = el('div', 'side');
    this.verbsEl = el('div', 'verbs');
    this.verbsEl.setAttribute('role', 'group'); this.verbsEl.setAttribute('aria-label', this.t('verbs'));
    roving(this.verbsEl, '.verb');
    for (const v of this.game.verbs) {
      const b = el('button', 'verb', esc(v.label));
      b.style.color = v.color; b.dataset.verb = v.id;
      b.onclick = () => this.pickVerb(v.id);
      this.verbsEl.append(b);
    }
    this.invEl = el('div', 'inv');
    this.invNav = el('div', 'invnav');
    const up = el('button', 'tool', '▲'), down = el('button', 'tool', '▼'), pg = el('span', 'invpg');
    up.onclick = () => { if (this.invPage > 0) { this.invPage--; this.renderInv(); } };
    down.onclick = () => { if ((this.invPage + 2) * this.invCols < this.items.length) { this.invPage++; this.renderInv(); } };
    this.invNav.append(up, pg, down);
    this.toolsEl = el('div', 'tools');
    const tool = (icon: Id, label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = el('button', 'tool', `<img src="${this.bank.img(icon)}" alt="">`);
      b.setAttribute('aria-label', label); b.title = label; b.onclick = () => fn(b); this.toolsEl.append(b); return b;
    };
    const icons = this.game.skin.icons;
    // Several playable characters: one button per other character (their portrait, or their initial), before the map.
    for (const pid of this.game.players?.ids ?? []) {
      const c = this.game.characters[pid];
      const b = el('button', 'tool player', c?.portrait ? `<img src="${this.bank.img(c.portrait)}" alt="">` : `<span>${esc((c?.name ?? pid).slice(0, 1))}</span>`);
      b.dataset.player = pid; b.setAttribute('aria-label', c?.name ?? pid); b.title = c?.name ?? pid;
      b.onclick = () => { if (!this.engine.busy && !this.speechEl) void this.engine.switchTo(pid); };
      this.toolsEl.append(b);
    }
    tool(icons.map, this.game.ui.mapTitle, () => { if (!this.engine.busy && !this.speechEl) void this.engine.openMap(); });
    tool(icons.pause, this.game.ui.pause, () => this.pauseMenu());
    tool(icons.music, this.game.ui.music, (b) => { const on = !this.audio.musicOn; this.audio.setMusic(on); this.audio.setSfx(on); b.classList.toggle('off', !on); });
    this.side.append(this.verbsEl, this.invEl, this.invNav, this.toolsEl);
    this.g.append(this.scol, this.side);
    this.root.append(this.g);

    // Input: a tap during a line of dialogue dismisses it, otherwise it acts.
    this.g.addEventListener('pointerdown', (e) => { if (this.speechEl && !(e.target as HTMLElement).closest('.overlay')) { e.stopPropagation(); e.preventDefault(); this.endSpeech(); this.eatClick = performance.now(); } }, true);
    // The tap that dismisses a line shouldn't also pick the verb or item that was under the finger.
    this.g.addEventListener('click', (e) => { if (performance.now() - this.eatClick < 700) { e.stopPropagation(); e.preventDefault(); this.eatClick = -Infinity; } }, true);
    this.scene.addEventListener('pointerdown', (e) => this.onScenePointer(e));
    this.scene.addEventListener('pointermove', (e) => this.onHover(e));
    this.scene.addEventListener('pointerleave', () => { this.showLabel(null); this.sentence(); });
    // The keyboard plays the whole game: Space / Enter advance a line, Escape closes what is on top, then pauses.
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Escape closes the topmost thing (a menu, the map, the transcript, a cutscene's skip) or opens the pause menu;
   * Space and Enter advance a line of dialogue (a focused button already acts on Enter and Space on its own). */
  private onKey(e: KeyboardEvent) {
    if (isTyping(e) || !this.engine.state) return;
    const onButton = (e.target as HTMLElement | null)?.tagName === 'BUTTON';
    if (e.key === 'Escape') {
      const dim = this.scene.querySelector<HTMLElement>('.dim');
      if (dim) { dim.remove(); return; }
      const mapBack = this.side.querySelector<HTMLButtonElement>('.mapview ~ * .choice.gl, .choices .choice.gl:last-child');
      if (this.scene.querySelector('.overlay.mapview') && mapBack) { mapBack.click(); return; }
      const mgSkip = this.scene.querySelector<HTMLButtonElement>('.overlay .mg-skip');
      if (mgSkip) { mgSkip.click(); return; }
      if (this.transcript) { this.closeTranscript(); return; }
      const skip = this.scene.querySelector<HTMLButtonElement>('.skip');
      if (skip) { skip.click(); return; }
      if (this.choosing) { const last = this.side.querySelector<HTMLButtonElement>('.choices .choice.gl:last-child'); if (last) { last.click(); return; } }
      if (!this.scene.querySelector('.overlay')) this.pauseMenu();
      return;
    }
    if ((e.key === ' ' || e.key === 'Enter') && this.speechEl && !onButton && !this.scene.querySelector('.overlay:not(.mapview) .mg-skip')) {
      e.preventDefault(); this.endSpeech(); this.eatClick = performance.now();
    }
  }

  private layout() {
    const r = this.root.getBoundingClientRect();
    const W = r.width, H = r.height;
    this.desk = matchMedia('(pointer: fine)').matches && W >= 720 && H >= 450;
    this.g.classList.toggle('desk', this.desk);
    let sw: number, sh: number;
    if (this.desk) {
      // 16:10 scene on top, panel at the bottom (sentence line + verbs + inventory + menu), like LucasArts games.
      sh = Math.floor(Math.min(W / 1.6, H / 1.34)); sw = Math.round(sh * 1.6);
      const ph = Math.round(sh * 0.34);
      Object.assign(this.g.style, { width: `${sw}px`, height: `${sh + ph}px` });
      Object.assign(this.scol.style, { width: `${sw}px`, height: `${sh}px` });
      Object.assign(this.side.style, { width: `${sw}px`, height: `${ph}px`, fontSize: `${Math.max(12, Math.round(ph * 0.1))}px` });
      this.verbsEl.style.fontSize = `${Math.max(12, Math.round(ph * 0.105))}px`;
      for (const b of this.verbsEl.children) (b as HTMLElement).style.height = '';
      if (this.sbar.parentElement !== this.side) this.side.prepend(this.sbar);
    } else {
      const sideW = Math.max(176, Math.min(300, W - H * 1.6));
      sw = W - sideW; sh = Math.min(H, sw / 1.6);
      sw = Math.round(sh * 1.6); sh = Math.round(sh);
      Object.assign(this.g.style, { width: `${sw + sideW}px`, height: `${H}px` });
      Object.assign(this.scol.style, { width: `${sw}px`, height: `${H}px` });
      Object.assign(this.side.style, { width: `${sideW}px`, height: '', fontSize: `${Math.max(12, Math.min(16, Math.round(sideW / 13)))}px` });
      const colW = (sideW - 16) / 3;
      this.verbsEl.style.fontSize = `${Math.max(10, Math.min(16, Math.floor(colW / 4.1)))}px`;
      for (const b of this.verbsEl.children) (b as HTMLElement).style.height = `${Math.max(26, Math.min(44, Math.round(H * 0.1)))}px`;
      if (this.sbar.parentElement !== this.scene) this.scene.append(this.sbar);
    }
    Object.assign(this.scene.style, { width: `${sw}px`, height: `${sh}px`, fontSize: `${Math.max(13, Math.round(sw * 0.03))}px` });
    this.u = sw / 640; this.sw = sw;
    this.view.resize(this.u);
    this.renderA11yTargets();
    if (this.items) this.renderInv();
  }

  private toScene(e: PointerEvent): Point {
    const r = this.scene.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 640 + this.view.cam, ((e.clientY - r.top) / r.height) * 400];
  }

  // ================================================================== interaction

  private pickVerb(v: VerbId) {
    if (this.engine.busy) return;
    this.verb = this.verb === v ? null : v;
    this.a = null;
    this.renderVerbs(); this.renderInv(); this.sentence();
  }

  private resetVerb() { this.verb = null; this.a = null; this.renderVerbs(); this.renderInv(); this.sentence(); }

  private async onItem(id: Id) {
    if (this.engine.busy) return;
    const v = this.verb;
    // Item that has already been used: can still be looked at, not used or given (unless a rule targets it).
    if ((!v || v === 'use' || v === 'give') && this.engine.usedLocked(id)) return;
    if ((v === 'use' || v === 'give') && !this.a) { this.a = id; this.renderInv(); this.sentence(); return; }
    if ((v === 'use' || v === 'give') && this.a && this.a !== id) { const a = this.a; this.resetVerb(); await this.engine.act({ verb: v, a, b: id }); return; }
    if (!v) { this.verb = 'use'; this.a = id; this.renderVerbs(); this.renderInv(); this.sentence(); return; }
    this.resetVerb();
    await this.engine.act({ verb: v, a: id });
  }

  private async actOnTarget(id: Id) {
    const v = this.verb;
    if (!v) { const ap = this.engine.approach(id); this.sentence(id); if (ap) await this.engine.walkTo(ap); return; }
    if ((v === 'use' || v === 'give') && this.a) { const a = this.a; this.resetVerb(); await this.engine.act({ verb: v, a, b: id }); return; }
    if (v === 'give') { void this.say(this.game.hero, this.game.ui.giveWhat, {}); return; }
    this.resetVerb();
    await this.engine.act({ verb: v, a: id });
  }

  /** Keyboard and screen-reader representation of the visible coordinate-based scene hotspots. */
  private renderA11yTargets() {
    this.a11yTargets?.remove();
    if (!this.view.room || !this.engine.state) return;
    const layer = el('div', 'a11y-targets'); layer.setAttribute('aria-label', this.view.room.name);
    for (const id of this.engine.targets(this.view.room)) {
      const box = this.view.box(id); if (!box) continue;
      const b = el('button', 'a11y-target', esc(this.engine.nameOf(id)));
      b.dataset.target = id; b.setAttribute('aria-label', this.engine.nameOf(id));
      Object.assign(b.style, { left: `${box[0] * this.u}px`, top: `${box[1] * this.u}px`, width: `${Math.max(24, box[2] * this.u)}px`, height: `${Math.max(24, box[3] * this.u)}px` });
      b.onfocus = () => { this.showLabel(id); this.sentence(id); };
      b.onblur = () => { this.showLabel(null); this.sentence(); };
      b.onclick = (e) => { e.stopPropagation(); if (!this.engine.busy && !this.speechEl && !this.inCutscene) void this.actOnTarget(id); };
      layer.append(b);
    }
    this.view.el.append(layer); this.a11yTargets = layer;
  }

  private async onScenePointer(e: PointerEvent) {
    if (!this.view.room || this.engine.busy || this.speechEl || this.inCutscene) return;
    if ((e.target as HTMLElement).closest('.dim, .overlay, .skip, button')) return;
    const p = this.toScene(e);
    const id = this.view.hit(p);
    if (!id) { await this.engine.walkTo(this.view.clampFloor(p)); return; }
    if (e.pointerType !== 'mouse') { this.showLabel(id); setTimeout(() => this.showLabel(null), 900); }
    await this.actOnTarget(id);
  }

  private onHover(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || !this.view.room || this.engine.busy || this.speechEl) return;
    const id = this.view.hit(this.toScene(e));
    this.showLabel(id); this.sentence(id ?? undefined);
    this.scene.style.cursor = id ? 'pointer' : 'crosshair';
  }

  private sentence(target?: Id) {
    const V = this.game.verbs.find((x) => x.id === this.verb);
    const n = (id: Id) => `<b>${esc(this.engine.nameOf(id))}</b>`;
    let s: string;
    if (!V) s = esc(this.game.ui.walkTo) + (target ? ' ' + n(target) : '');
    else if (this.a && V.join) s = `${esc(V.label)} ${n(this.a)} ${esc(V.join)}${target ? ' ' + n(target) : ' …'}`;
    else s = esc(V.label) + (target ? ' ' + n(target) : '');
    this.sbar.innerHTML = s;
  }

  private showLabel(id: Id | null) {
    this.labelEl?.remove(); this.labelEl = null;
    if (!id) return;
    const b = this.view.box(id);
    if (!b) return;
    const l = el('div', 'label', esc(this.engine.nameOf(id)));
    l.style.left = `${(b[0] + b[2] / 2 - this.view.cam) * this.u}px`; l.style.top = `${Math.max(14, b[1] - 2) * this.u}px`;
    this.scene.append(l); this.labelEl = l;
  }

  private renderVerbs() {
    for (const b of this.verbsEl.children as HTMLCollectionOf<HTMLElement>) {
      b.classList.toggle('on', b.dataset.verb === this.verb);
      b.setAttribute('aria-pressed', String(b.dataset.verb === this.verb));
      b.classList.toggle('blink', b.dataset.verb === this.guideState?.verb);
    }
  }

  private renderInv() {
    const n = this.items.length, cols = this.invCols, per = cols * 2;
    const maxPage = Math.max(0, Math.ceil((n - per) / cols));
    this.invPage = Math.min(this.invPage, maxPage);
    this.invEl.innerHTML = '';
    this.invEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    const off = this.invPage * cols;
    for (let j = 0; j < per; j++) {
      const id = this.items[off + j];
      const b = el('button', 'slot');
      // An empty slot is layout, not a control: out of the tab order and of the accessibility tree.
      if (!id) { b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
      if (id) {
        const it = this.game.items[id];
        b.innerHTML = `<img src="${this.bank.img(it?.icon ?? id)}" alt="">`;
        b.setAttribute('aria-label', it?.name ?? id);
        b.classList.toggle('sel', id === this.a);
        b.classList.toggle('blink', id === this.guideState?.target);
        if (this.used.includes(id)) {
          b.classList.add('used');
          if (this.engine.state && this.engine.usedLocked(id)) { b.classList.add('locked'); b.setAttribute('aria-disabled', 'true'); }
        }
        b.onclick = () => void this.onItem(id);
        b.onpointerenter = (e) => { if (e.pointerType === 'mouse' && !this.engine.busy) this.sentence(id); };
      }
      this.invEl.append(b);
    }
    this.invNav.hidden = n <= per && !this.desk;
    const [up, pg, down] = this.invNav.children as HTMLCollectionOf<HTMLButtonElement>;
    up.disabled = this.invPage === 0; down.disabled = off + per >= n;
    pg.textContent = n > per ? `${Math.min(n, off + per)} / ${n}` : '';
  }

  private refresh() {
    this.side.classList.toggle('off', this.engine.busy && !this.choosing);
    if (this.engine.state && this.view.room) this.view.refreshVisibility();
    // The active character's button is hidden, the others show.
    for (const b of this.toolsEl.querySelectorAll<HTMLElement>('.tool.player')) b.hidden = b.dataset.player === this.engine.heroId();
    this.renderA11yTargets();
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
    this.endSpeech();
    if (o.fast) return Promise.resolve();
    const char = this.game.characters[who];
    this.live.textContent = `${char?.name ?? who}: ${text}`;
    const color = char?.color ?? '#fff';
    const inCall = !!this.call?.ids.includes(who);
    const head = char?.offscreen || inCall ? null : this.view.head(who);
    if (inCall) this.call!.talking = who;
    let box: HTMLElement;
    if (!head) {
      box = el('div', 'narr', `<span class="who">${esc((char?.name ?? who).toUpperCase())}</span>${esc(text)}`);
      box.style.color = color;
    } else {
      box = el('div', 'speech' + (o.shout ? ' shout' : ''), esc(text));
      box.style.color = color;
      const maxW = Math.min(0.62 * this.sw, 390 * this.u);
      box.style.maxWidth = `${maxW}px`;
      const half = maxW / 2 / this.u + 6;
      box.style.left = `${Math.max(half, Math.min(640 - half, head[0] - this.view.cam)) * this.u}px`;
      box.style.top = `${Math.max(head[1], 70) * this.u}px`;
      this.view.setTalking(who, text.length > 70);
    }
    const next = el('button', 'tapnext', '▼'); next.setAttribute('aria-label', this.t('advance')); next.tabIndex = -1;
    next.onclick = (e) => { e.stopPropagation(); this.endSpeech(); this.eatClick = performance.now(); };
    this.scene.append(box, next);
    this.speechEl = box;
    this.transcribe(who, text, color);
    return new Promise((res) => {
      this.speechDone = res;
      const mine = box;
      // With a voice clip, the line lasts as long as the clip (a tap still skips it); otherwise a reading time.
      if (o.voice && this.audio.hasVoice(o.voice)) this.audio.voice(o.voice).then(() => { if (this.speechEl === mine) this.endSpeech(); });
      else this.speechTimer = window.setTimeout(() => this.endSpeech(), sayMs(text, this.settings.textSpeed));
    });
  }

  /** During a conversation, every line is also written in the panel, to be read at leisure. */
  private transcript: HTMLElement | null = null;
  private transcribe(who: Id, text: string, color: string) {
    const t = this.transcript;
    if (!t) return;
    const char = this.game.characters[who];
    const line = el('div', 'line', `<b style="color:${color}">${esc(char?.name ?? who)} :</b>${esc(text)}`);
    t.querySelector('.hint')?.before(line);
    t.scrollTop = t.scrollHeight;
  }
  private openTranscript(who: Id | undefined, question: string) {
    this.closeTranscript();
    const t = el('div', 'transcript');
    if (who) {
      const c = this.game.characters[who];
      t.append(el('div', 'who', `${c?.portrait ? `<img src="${this.bank.img(c.portrait)}" alt="">` : ''}${esc(c?.name ?? who)}`));
      t.classList.add('choices');
    }
    void question; // the engine has the hero say the question: it arrives through transcribe()
    t.append(el('div', 'hint', esc(this.game.ui.tapToContinue)));
    t.onclick = () => this.closeTranscript();
    this.side.insertBefore(t, this.toolsEl);
    this.transcript = t;
    this.verbsEl.hidden = true; this.invEl.hidden = true; this.invNav.hidden = true;
  }
  private closeTranscript() {
    if (!this.transcript) return;
    this.transcript.remove(); this.transcript = null;
    if (!this.choosing) { this.verbsEl.hidden = false; this.invEl.hidden = false; this.renderInv(); }
  }

  private endSpeech() {
    clearTimeout(this.speechTimer);
    // End of the conversation (nothing speaking any more, no more choice): the panel gives the verbs back.
    if (this.transcript) setTimeout(() => { if (this.transcript && !this.choosing && !this.engine.busy && !this.speechEl) this.closeTranscript(); }, 120);
    this.speechEl?.remove(); this.speechEl = null;
    this.scene.querySelector('.tapnext')?.remove();
    this.view.setTalking(null);
    if (this.call) this.call.talking = null;
    const d = this.speechDone; this.speechDone = null; d?.();
  }

  walk(who: Id, to: Point, fast: boolean) { return this.view.walkTo(who, to, fast); }
  face(who: Id, dir: 'left' | 'right') { this.view.face(who, dir); }
  pose(who: Id, pose: string) { this.view.pose(who, pose); this.callPose(who, pose); }
  anim(who: Id, pose: string, ms: number, fast: boolean) { return this.view.anim(who, pose, ms, fast); }
  place(who: Id, at: Point, face?: 'left' | 'right') { this.view.place(who, at, face); }
  wait(ms: number, fast: boolean) { return fast ? Promise.resolve() : sleep(ms); }
  prop(id: Id, state: string) { this.view.setProp(id, state); this.view.refreshVisibility(); }
  propFrame(id: Id, img: Id | null) { this.view.propFrame(id, img); }
  propLoop(id: Id, frames: Id[], fps: number, onFrame?: (i: number) => void) { this.view.propLoop(id, frames, fps, onFrame); }
  camera(x: number | null, follow: boolean, ms: number, fast: boolean) {
    if (follow || x === null) { this.view.followHero(); return Promise.resolve(); }
    return this.view.setCamera(x, fast ? 0 : ms);
  }
  show(id: Id, visible: boolean, fade: number, fast: boolean) { return this.view.show(id, visible, fade, fast || this.settings.reduceMotion); }
  inventory(items: Id[], used?: Id[]) {
    this.used = [...(used ?? [])];
    if (!this.view.room) { this.items = [...items]; return; }
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
  sfx(id: Id) { this.audio.sfx(id); }
  music(c: { play?: Id; push?: Id; pop?: true; stop?: true; once?: Id }) {
    if (c.play) this.audio.play(c.play);
    else if (c.push) this.audio.push(c.push);
    else if (c.pop) this.audio.pop();
    else if (c.stop) this.audio.stop();
    else if (c.once) this.audio.once(c.once);
  }
  toast(text: string) { this.live.textContent = text; const t = el('div', 'toast', esc(text)); this.scene.append(t); setTimeout(() => t.remove(), 2400); }
  shake(ms: number) { if (this.settings.reduceMotion) return; this.scene.classList.add('shake'); setTimeout(() => this.scene.classList.remove('shake'), ms); }

  guide(g: { verb: VerbId; target: Id } | null) {
    this.guideState = g;
    this.sparkEl?.remove(); this.sparkEl = null;
    this.renderVerbs(); this.renderInv();
    const spark = this.game.skin.icons.spark;
    if (!g || !spark || this.items.includes(g.target)) return;
    const b = this.view.box(g.target);
    if (!b) return;
    const s = el('img', 'spark') as HTMLImageElement;
    s.src = this.bank.img(spark); s.alt = '';
    s.style.width = `${22 * this.u}px`; s.style.left = `${(b[0] + b[2] / 2 - this.view.cam) * this.u}px`; s.style.top = `${(b[1] + b[3] / 2) * this.u}px`;
    this.scene.append(s); this.sparkEl = s;
  }

  cutscene(on: boolean) {
    this.inCutscene = on;
    this.scene.classList.toggle('cine', on);
    this.scene.querySelector('.skip')?.remove();
    if (on) {
      const b = el('button', 'skip', esc(this.game.ui.skip));
      b.onclick = (e) => { e.stopPropagation(); this.engine.skip(); this.endSpeech(); };
      queueMicrotask(() => b.focus({ preventScroll: true }));
      this.scene.append(b);
    }
  }

  // ---------------------------------------------------------------- choices and conversations

  private choosing = false;
  choose(options: { text: string; seen?: boolean; global?: boolean }[], who?: Id): Promise<number> {
    this.closeTranscript();
    this.choosing = true;
    this.verbsEl.hidden = true; this.invEl.hidden = true; this.invNav.hidden = true;
    this.side.classList.remove('off');
    const box = el('div', 'choices');
    if (who) {
      const c = this.game.characters[who];
      box.append(el('div', 'who', `${c?.portrait ? `<img src="${this.bank.img(c.portrait)}" alt="">` : ''}${esc(c?.name ?? who)}`));
    }
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', who ? (this.game.characters[who]?.name ?? who) : this.game.ui.mapTitle);
    roving(box, '.choice');
    this.side.insertBefore(box, this.toolsEl);
    queueMicrotask(() => box.querySelector<HTMLElement>('.choice')?.focus({ preventScroll: true }));
    return new Promise((res) => {
      options.forEach((o, i) => {
        const b = el('button', 'choice' + (o.seen ? ' read' : '') + (o.global ? ' gl' : ''), '• ' + esc(o.text));
        b.onclick = () => {
          box.remove();
          this.choosing = false;
          if (who) this.openTranscript(who, o.text);
          else { this.verbsEl.hidden = false; this.invEl.hidden = false; this.renderInv(); }
          res(i);
        };
        box.append(b);
      });
    });
  }

  /** Call in progress: phone frame with the callers, animated mouth for whoever is speaking. */
  private call: { ids: Id[]; el: HTMLElement; timer: number; talking: Id | null; frames: ReturnType<App['callFrame']>[]; imgs: HTMLImageElement[] } | null = null;

  async phone(whoIn: Id | Id[], ringing: boolean) {
    const ids = Array.isArray(whoIn) ? whoIn : [whoIn];
    if (!ringing) { this.hangUp(); return; }
    this.hangUp();
    const chars = ids.map((id) => this.game.characters[id]);
    const color = chars[0]?.color ?? '#fff';
    const card = el('div', 'overlay');
    Object.assign(card.style, { inset: 'auto', left: '50%', top: '6%', transform: 'translateX(-50%)', background: '#120d1c', border: `3px solid ${color}`, borderRadius: '12px', padding: '.5em .8em', display: 'flex', alignItems: 'center', gap: '.7em', color, animation: 'drop .5s ease-out both' });
    const faces = chars.map((c) => c?.portrait ? `<img src="${this.bank.img(c.portrait)}" alt="" style="width:3em;height:3em;object-fit:cover;border-radius:50%;border:2px solid ${c.color ?? 'currentColor'}">` : '').join('');
    const names = ids.map((id, i) => `<span style="color:${chars[i]?.color ?? color}">${esc(chars[i]?.name ?? id)}</span>`).join(' &amp; ');
    card.innerHTML = `${faces}<div>${names} ${esc(this.game.ui.calling)}</div>`;
    const pick = el('button', 'bigbtn', esc(this.game.ui.pickUp));
    Object.assign(pick.style, { color: '#8fe36a', fontSize: '.55em' });
    card.append(pick);
    this.scene.append(card);
    const ring = this.game.skin.sounds?.phone;
    if (ring) this.audio.sfx(ring);
    const shown = this.callFrames(ids);
    void this.bank.preload(shown.flatMap((f) => f.all));
    await new Promise<void>((res) => { pick.onclick = (e) => { e.stopPropagation(); res(); }; });
    card.remove();
    this.openCall(ids, shown);
  }

  /** A caller's pose and images: the requested pose, otherwise the first of `skin.callPoses` (default `phone`, `front`, `face`, `idle`). */
  private callFrame(id: Id, want?: string) {
    const c = this.engine.character(id);
    const sp = c?.sprites ?? {};
    const pose = [want, ...(this.game.skin.callPoses ?? ['phone', 'front', 'face', 'idle'])].find((p) => p && (sp[p]?.length || c?.mouths?.[p]));
    const m = pose ? c?.mouths?.[pose] : undefined;
    const base = m?.closed ?? (pose ? sp[pose]?.[0] : undefined) ?? c?.portrait;
    const talk = !m && pose ? sp[`${pose}_talk`]?.[0] : undefined;
    const all = [base, talk, ...(m ? [...m.open, m.blink, m.smile] : [])].filter(Boolean) as Id[];
    const ref = sp.idle?.[0] ?? base;
    const [, rh] = ref ? this.bank.size(ref) : [0, 0], [, bh] = base ? this.bank.size(base) : [0, 0];
    const h = (c?.height ?? this.game.skin.heights?.actor ?? 110) * (rh ? bh / rh : 1);
    return { id, c, m, base, talk, all, h };
  }

  private callFrames(ids: Id[]) { return ids.map((id) => this.callFrame(id)); }

  /** Shows the phone frame (side by side, the first one in front) during the dialogue. */
  private openCall(ids: Id[], frames: ReturnType<App['callFrames']>) {
    const shown = frames.filter((f) => f.base);
    if (!shown.length) { this.call = { ids, el: el('div'), timer: 0, talking: null, frames: [], imgs: [] }; return; }
    const box = el('div', 'callframe');
    box.style.borderColor = shown[0].c?.color ?? '#fff';
    const imgs = shown.map((f, i) => {
      const im = el('img') as HTMLImageElement;
      im.alt = f.c?.name ?? f.id; im.src = this.bank.img(f.base!); im.dataset.img = f.base!;
      im.style.zIndex = String(shown.length - i);
      box.append(im);
      return im;
    });
    this.scene.append(box);
    let blinkAt = performance.now() + 2500;
    const tick = () => {
      const call = this.call;
      if (!call) return;
      const now = performance.now();
      const blink = now >= blinkAt && now < blinkAt + 150;
      if (now >= blinkAt + 150) blinkAt = now + 3000 + Math.random() * 4000;
      call.frames.forEach((f, i) => {
        const im = call.imgs[i];
        const talking = call.talking === f.id;
        let img = f.base!;
        let bob = false;
        if (f.m) {
          if (talking) { const o = f.m.open.filter((x) => x !== im.dataset.img); img = o[Math.floor(Math.random() * o.length)] ?? f.m.closed; }
          else if (blink && f.m.blink) img = f.m.blink;
        } else if (talking) { if (f.talk) img = im.dataset.img === f.talk ? f.base! : f.talk; else bob = im.style.transform === ''; }
        if (im.dataset.img !== img) { im.src = this.bank.img(img); im.dataset.img = img; }
        im.style.transform = bob ? 'translateY(-3%)' : '';
      });
    };
    this.call = { ids, el: box, timer: window.setInterval(tick, 180), talking: null, frames: shown, imgs };
    this.sizeCall();
  }

  /** Relative heights of the callers (each at their own size, pose included). */
  private sizeCall() {
    const call = this.call;
    if (!call?.frames.length) return;
    const hmax = Math.max(...call.frames.map((f) => f.h));
    call.frames.forEach((f, i) => { call.imgs[i].style.height = `${(f.h / hmax) * 100}%`; });
  }

  /** `{ pose }` during a call: the phone frame shows the new pose. */
  private callPose(who: Id, pose: string) {
    const call = this.call;
    const i = call ? call.frames.findIndex((f) => f.id === who) : -1;
    if (!call || i < 0) return;
    const f = this.callFrame(who, pose);
    if (!f.base) return;
    void this.bank.preload(f.all);
    call.frames[i] = f;
    call.imgs[i].src = this.bank.img(f.base); call.imgs[i].dataset.img = f.base;
    this.sizeCall();
  }

  private hangUp() {
    if (!this.call) return;
    clearInterval(this.call.timer);
    this.call.el.remove();
    this.call = null;
  }

  // ---------------------------------------------------------------- map

  async openMap(state: GameState): Promise<Id | null> {
    const map = this.game.map;
    if (!map) return null;
    const here = Object.entries(map.places).find(([, p]) => p.room === state.room)?.[0];
    let region = here ? map.places[here].region : map.start;
    if (map.music) this.audio.push(map.music);
    const ov = el('div', 'overlay mapview');
    ov.style.background = '#000';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', this.game.ui.mapTitle);
    this.scene.append(ov);
    this.verbsEl.hidden = true; this.invEl.hidden = true; this.invNav.hidden = true;
    // The place list is a prompt like a `choice`: `choosing` keeps refresh() from dimming the side column (busy) while
    // the player is expected to tap it. Without it, any refresh during the map (a script tick, a save) made the list
    // untappable; CI runners hit it, phones can too.
    this.choosing = true;
    this.side.classList.remove('off');
    const list = el('div', 'choices');
    list.setAttribute('role', 'group'); list.setAttribute('aria-label', this.game.ui.mapTitle);
    roving(list, '.choice');
    this.side.insertBefore(list, this.toolsEl);
    const places = () => Object.entries(map.places).filter(([id, p]) => state.unlocked.includes(id) && p.region === region);
    const icons = this.game.skin.icons;
    const pin = map.vehicles?.pin ?? icons.pin, newsImg = map.vehicles?.news ?? icons.news;
    const cleanup = () => { this.choosing = false; ov.remove(); list.remove(); this.verbsEl.hidden = false; this.invEl.hidden = false; this.renderInv(); if (map.music) this.audio.pop(); };

    return new Promise<Id | null>((resolve) => {
      let layer: HTMLElement = ov;
      let svg: SVGSVGElement;
      const draw = () => {
        ov.innerHTML = ''; list.innerHTML = '';
        const R = map.regions[region];
        const parent = R.parent ? map.regions[R.parent] : null;
        if (parent) {
          const bg = el('img', 'bg') as HTMLImageElement; bg.src = this.bank.img(parent.image);
          Object.assign(bg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(3px) brightness(.55)' });
          ov.append(bg);
          const [w, h] = this.bank.size(R.image);
          layer = el('div');
          Object.assign(layer.style, { position: 'absolute', top: '2.5%', bottom: '2.5%', left: '50%', transform: 'translateX(-50%)', aspectRatio: `${w}/${h}` });
          const im = el('img') as HTMLImageElement; im.src = this.bank.img(R.image);
          Object.assign(im.style, { width: '100%', height: '100%', display: 'block', filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.6))' });
          layer.append(im); ov.append(layer);
        } else {
          layer = el('div'); Object.assign(layer.style, { position: 'absolute', inset: '0' });
          const im = el('img') as HTMLImageElement; im.src = this.bank.img(R.image);
          Object.assign(im.style, { width: '100%', height: '100%', objectFit: 'cover' });
          layer.append(im); ov.append(layer);
        }
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
        Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
        layer.append(svg);
        const size = parent ? 7.5 : 6;
        list.append(el('div', 'who', `<img src="${this.bank.img(icons.map)}" alt="">${esc(this.game.ui.mapTitle)}`));
        for (const [id, p] of places()) {
          const b = el('button', 'pin' + (id === here ? ' here' : ''));
          b.setAttribute('aria-label', p.name);
          Object.assign(b.style, { left: `${p.pos[0]}%`, top: `${p.pos[1]}%`, width: `${size * 1.1}%` });
          const face = p.portrait ?? pin;
          b.innerHTML = `${face ? `<img class="face" src="${this.bank.img(face)}" alt="">` : ''}${pin ? `<img class="needle" src="${this.bank.img(pin)}" alt="">` : ''}`;
          const news = p.news ? check(p.news, state) : false;
          if (news && newsImg) b.insertAdjacentHTML('beforeend', `<img class="news" src="${this.bank.img(newsImg)}" alt="">`);
          b.onclick = () => void go(id);
          layer.append(b);
          const li = el('button', 'choice', `• ${esc(p.name)}${news ? ' <span style="color:#ffd84d">!</span>' : ''}`);
          li.onclick = () => void go(id);
          list.append(li);
        }
        // zoom button to the parent or child region
        const child = Object.entries(map.regions).find(([, r]) => r.parent === region);
        const other = R.parent ?? child?.[0];
        if (other) {
          const sw = el('button', 'bigbtn', esc(R.parent ? this.game.ui.world + ' ⤢' : this.game.ui.zoomIn + ' ⤡'));
          Object.assign(sw.style, { position: 'absolute', right: '2%', bottom: '3%', color: '#ffd84d', fontSize: `${Math.max(8, Math.round(this.sw * 0.016))}px`, zIndex: '20' });
          sw.onclick = () => { region = other; draw(); };
          ov.append(sw);
        }
        const back = el('button', 'choice gl', '• ' + esc(this.game.ui.mapBack));
        back.onclick = () => { cleanup(); resolve(null); };
        list.append(back);
        queueMicrotask(() => list.querySelector<HTMLElement>('.choice')?.focus({ preventScroll: true }));
      };
      const go = async (id: Id) => {
        if (id === here) { cleanup(); resolve(null); return; }
        const p = map.places[id];
        const from = here && map.places[here].region === region ? map.places[here].pos : null;
        const origin = from ?? [50, 50];
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (origin[0] + p.pos[0]) / 2, my = Math.min(origin[1], p.pos[1]) - 10;
        path.setAttribute('d', `M${origin[0]} ${origin[1] - 2} Q${mx} ${my} ${p.pos[0]} ${p.pos[1] - 2}`);
        Object.assign(path.style, { fill: 'none', stroke: '#e02828', strokeWidth: '3', vectorEffect: 'non-scaling-stroke' });
        svg.append(path);
        const L = path.getTotalLength();
        path.style.strokeDasharray = `${L}`; path.style.strokeDashoffset = `${L}`;
        path.style.transition = 'stroke-dashoffset 1.6s linear';
        requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
        const veh = el('img') as HTMLImageElement;
        const vehImg = p.vehicle === 'plane' ? map.vehicles?.plane ?? icons.plane : map.vehicles?.car ?? icons.car;
        if (vehImg) veh.src = this.bank.img(vehImg);
        Object.assign(veh.style, { position: 'absolute', width: p.vehicle === 'plane' ? '6%' : '4%', transform: 'translate(-50%,-50%)', zIndex: '15', pointerEvents: 'none' });
        if (vehImg) layer.append(veh);
        const planeSfx = this.game.skin.sounds?.plane;
        if (p.vehicle === 'plane' && planeSfx) this.audio.sfx(planeSfx);
        const t0 = performance.now();
        await new Promise<void>((r) => {
          const f = (n: number) => { const k = Math.min(1, (n - t0) / 1600); const pt = path.getPointAtLength(L * k); veh.style.left = `${pt.x}%`; veh.style.top = `${pt.y}%`; if (k < 1) requestAnimationFrame(f); else r(); };
          requestAnimationFrame(f);
        });
        await sleep(300);
        cleanup();
        resolve(id);
      };
      draw();
    });
  }

  // ---------------------------------------------------------------- minigames

  async minigame(id: Id, params: Record<string, unknown>) {
    const game = this.mg[id];
    if (!game) { console.warn('unknown minigame', id); return; }
    const host = el('div', 'overlay');
    host.style.background = '#000';
    this.scene.append(host);
    this.side.classList.add('off');
    const voice = this.game.characters[this.game.hintVoice ?? this.game.hero];
    let frame: HTMLElement | null = null;
    const ac = new AbortController();
    const entry = { id, skipped: false, ms: 0 };
    const t0 = performance.now();
    host.addEventListener('mg-skip', () => { entry.skipped = true; });
    try {
      await game.run({
        root: host, u: this.u,
        img: (i) => this.bank.img(i), size: (i) => this.bank.size(i), sfx: (i) => this.audio.sfx(i),
        instruct: (text) => {
          if (!frame) { frame = el('div', 'narr'); frame.style.color = voice?.color ?? '#fff'; frame.style.zIndex = '60'; host.append(frame); }
          frame.innerHTML = `<span class="who">${esc((voice?.name ?? '').toUpperCase())}</span>${esc(text)}`;
        },
        params, signal: ac.signal, fonts: { ui: this.game.skin.fonts?.ui ?? FONT_UI, pixel: this.game.skin.fonts?.pixel ?? FONT_PIXEL },
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
    if (phase === 'open') await this.sealed.open(); else await this.sealed.card();
  }

  /** Silent looping video, framed as "cover"; the backdrop serves as a poster until it plays. */
  private videoBg(file: string, poster?: Id): HTMLVideoElement {
    const v = el('video') as HTMLVideoElement;
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', '');
    if (poster) v.poster = this.bank.img(poster);
    v.src = this.bank.video(file);
    Object.assign(v.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' });
    v.play().catch(() => { /* autoplay blocked: the poster stays */ });
    return v;
  }

  private credits() {
    const box = el('div', 'credits');
    const C = this.game.creditsScreen ?? { video: this.game.titleScreen?.video, decor: this.game.titleScreen?.decor };
    if (C.video) { const v = this.videoBg(C.video, C.decor); v.style.filter = 'brightness(.35)'; box.append(v); }
    const inner = el('div', '', (this.game.credits ?? []).map((l) => esc(l) || '&nbsp;').join('<br>'));
    box.append(inner);
    box.onclick = () => box.remove();
    this.scene.append(box);
    const h = this.scene.clientHeight;
    inner.animate([{ transform: `translateY(0)` }, { transform: `translateY(-${h + inner.scrollHeight + 40}px)` }], { duration: 22000, easing: 'linear', fill: 'forwards' }).onfinish = () => box.remove();
  }

  end() { /* the sealed ending handles the end screen */ }

  // ================================================================== out-of-game screens

  private pauseMenu() {
    if (this.scene.querySelector('.dim')) return;
    const ui = this.game.ui;
    const previousFocus = document.activeElement as HTMLElement | null;
    const d = el('div', 'dim'); const m = el('div', 'menu', `<h3>${esc(ui.pause.toUpperCase())}</h3>`);
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', ui.pause);
    const remove = d.remove.bind(d); d.remove = () => { release(); remove(); previousFocus?.focus(); };
    const release = trapFocus(m, { onEscape: () => d.remove(), restore: false });
    const row = (t: string, v: string, cls = '') => { const b = el('button', cls, `<span>${esc(t)}</span><span>${esc(v)}</span>`); m.append(b); return b; };
    row(ui.resume, '▶').onclick = () => d.remove();
    const mu = row(ui.music, this.audio.musicOn ? ui.on : ui.off);
    mu.onclick = () => { this.audio.setMusic(!this.audio.musicOn); mu.lastElementChild!.textContent = this.audio.musicOn ? ui.on : ui.off; };
    const sf = row(ui.sfx, this.audio.sfxOn ? ui.on : ui.off);
    sf.onclick = () => { this.audio.setSfx(!this.audio.sfxOn); sf.lastElementChild!.textContent = this.audio.sfxOn ? ui.on : ui.off; };
    row(ui.autosave, this.saveError ? '⚠' : '✓');
    if (this.game.offline !== 'nearby') {
      // What is really in the cache: a tap retries a partial warm-up (files already cached are not fetched again).
      const labels = { complete: this.t('offlineComplete'), retry: this.t('offlineRetry') };
      const off = row(this.t('offlineStatus'), offlineText(this.offlineStatus, labels));
      off.setAttribute('aria-live', 'polite');
      const stop = this.onOffline((s) => { off.lastElementChild!.textContent = offlineText(s, labels); });
      const prevRemove = d.remove; d.remove = () => { stop(); prevRemove(); };
      off.onclick = () => { if (this.offlineStatus.state === 'partial' || this.offlineStatus.state === 'skipped') void this.warmAll(true); };
    }
    const slots = this.game.saves?.slots ?? 0;
    if (slots > 0 && this.engine.state) {
      row(this.t('save'), '💾').onclick = () => void this.slotMenu(d, m, 'save', slots);
      row(this.t('load'), '📂').onclick = () => void this.slotMenu(d, m, 'load', slots);
    }
    if (this.game.settings) row(this.t('settings'), '⚙').onclick = () => this.settingsMenu(d, m);
    row(ui.credits, '★').onclick = () => { d.remove(); this.credits(); };
    row(ui.restart, '!', 'warn').onclick = () => {
      m.innerHTML = `<h3>!</h3><p>${esc(ui.confirmErase)}</p>`;
      const y = el('button', 'warn', `<span>${esc(ui.yes)}</span><span>!</span>`), n = el('button', '', `<span>${esc(ui.no)}</span><span>▶</span>`);
      n.onclick = () => d.remove();
      y.onclick = () => { d.remove(); void this.restart(); };
      m.append(y, n);
    };
    d.append(m); this.scene.append(d);
  }

  /** Applies the preferences: fonts, text size, volumes, motion. */
  private applySettings() {
    const S = this.settings;
    const F = this.game.skin?.fonts;
    document.documentElement.style.setProperty('--font-ui', fontStack(S.readableFont && F?.readable ? F.readable : (F?.ui ?? FONT_UI)));
    this.scene.style.setProperty('--text-scale', String(S.textSize));
    this.audio.setVolumes(S.musicVolume, S.sfxVolume, S.voiceVolume);
    // The setting, or the system's `prefers-reduced-motion`: no camera glide, no parallax, no particles, no room transition.
    this.view.reduceMotion = S.reduceMotion || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.view.room && this.engine.state) this.view.refreshVisibility();
    try { localStorage.setItem(`${this.game.id}.settings`, JSON.stringify(S)); } catch { /* no storage */ }
  }

  /** The settings menu: each row cycles its value. */
  private settingsMenu(d: HTMLElement, m: HTMLElement) {
    const ui = this.game.ui;
    const S = this.settings;
    m.innerHTML = `<h3>${esc((this.t('settings')).toUpperCase())}</h3>`;
    const row = (t: string, v: () => string, onclick: () => void) => {
      const b = el('button', '', `<span>${esc(t)}</span><span>${esc(v())}</span>`);
      b.onclick = () => { onclick(); this.applySettings(); b.lastElementChild!.textContent = v(); };
      m.append(b); return b;
    };
    const speeds: [number, string][] = [[0.7, this.t('slow')], [1, this.t('normal')], [1.6, this.t('fast')]];
    row(this.t('textSpeed'), () => speeds.find(([k]) => k === S.textSpeed)?.[1] ?? String(S.textSpeed), () => { const i = speeds.findIndex(([k]) => k === S.textSpeed); S.textSpeed = speeds[(i + 1) % speeds.length][0]; });
    row(this.t('textSize'), () => (S.textSize > 1 ? this.t('large') : this.t('normal')), () => { S.textSize = S.textSize > 1 ? 1 : 1.3; });
    row(this.t('reduceMotion'), () => (S.reduceMotion ? ui.on : ui.off), () => { S.reduceMotion = !S.reduceMotion; });
    if (this.game.skin?.fonts?.readable) row(this.t('readableFont'), () => (S.readableFont ? ui.on : ui.off), () => { S.readableFont = !S.readableFont; });
    const langs = this.o.languages;
    if (langs && langs.available.length > 1) {
      const b = el('button', '', `<span>${esc(this.t('language'))}</span><span>${esc(langs.current)}</span>`);
      b.onclick = () => {
        const next = langs.available[(langs.available.indexOf(langs.current) + 1) % langs.available.length];
        try { localStorage.setItem(`${this.game.id}.lang`, next); } catch { /* no storage */ }
        const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.toString();
      };
      m.append(b);
    }
    const vol = (t: string, k: 'musicVolume' | 'sfxVolume' | 'voiceVolume') => row(t, () => `${Math.round(S[k] * 100)} %`, () => { S[k] = Math.round(((S[k] * 4 + 1) % 5)) / 4; });
    vol(this.t('volumeMusic'), 'musicVolume');
    vol(this.t('volumeSfx'), 'sfxVolume');
    if (this.game.audio?.voices && Object.keys(this.game.audio.voices).length) vol(this.t('volumeVoice'), 'voiceVolume');
    const back = el('button', '', `<span>${esc(ui.resume)}</span><span>▶</span>`); back.onclick = () => d.remove(); m.append(back);
  }

  /** The save / load menu: one row per slot, export and import as a JSON file. */
  private async slotMenu(d: HTMLElement, m: HTMLElement, mode: 'save' | 'load', count: number) {
    const ui = this.game.ui;
    m.innerHTML = `<h3>${esc((mode === 'save' ? this.t('save') : this.t('load')).toUpperCase())}</h3>`;
    const row = (t: string, v: string, cls = '') => { const b = el('button', cls, `<span>${esc(t)}</span><span>${esc(v)}</span>`); m.append(b); return b; };
    const meta = (): SlotMeta => ({ at: Date.now(), room: this.engine.state.room, roomName: this.engine.room().name, v: this.engine.state.v });
    const slotName = (n: number) => (this.t('slot')).replace('{n}', String(n));
    const label = (s: SlotMeta | null) => s ? `${s.roomName} · ${new Date(s.at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : (this.t('emptySlot'));
    // The rows exist at once (the menu never jumps), disabled until the store has listed the slots.
    const rows = Array.from({ length: count }, (_, i) => { const b = row(slotName(i + 1), '…', 'off'); b.disabled = true; return b; });
    const metas = await this.slots.listSlots(count);
    if (!d.isConnected) return;
    metas.forEach((s, i) => {
      const n = i + 1, b = rows[i];
      b.lastElementChild!.textContent = label(s);
      b.disabled = mode === 'load' && !s;
      b.classList.toggle('off', mode === 'load' && !s);
      if (mode === 'save') b.onclick = () => {
        const write = async () => { if (!(await this.slots.putSlot(n, structuredClone(this.engine.state), meta()))) return; d.remove(); this.toast(`${slotName(n)} ✓`); };
        if (!s) return void write();
        m.innerHTML = `<h3>?</h3><p>${esc(this.t('confirmOverwrite'))}</p>`;
        const y = el('button', 'warn', `<span>${esc(ui.yes)}</span><span>!</span>`), no = el('button', '', `<span>${esc(ui.no)}</span><span>▶</span>`);
        y.onclick = () => void write(); no.onclick = () => d.remove(); m.append(y, no);
      };
      else if (s) b.onclick = async () => {
        const state = await this.slots.getSlot(n);
        if (!state) { this.toast(this.t('saveFailed')); return; }
        d.remove(); void this.engine.load(state).catch((e) => this.toast(String((e as Error).message)));
      };
    });
    if (mode === 'save') row(this.t('exportSave'), '⤓').onclick = () => {
      const blob = new Blob([JSON.stringify(saveEnvelope(this.game, this.engine.state), null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${this.game.id}-save.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000); d.remove();
    };
    if (mode === 'save') row(this.t('shareSession'), '⇪').onclick = () => {
      // A playtest: the inputs since the game started, ids only, for games/<id>/playtests/ (npm run playtests).
      void import('../tools/replay').then(async ({ sessionFile }) => {
        const json = JSON.stringify(sessionFile(this.game.id, this.engine, { playtest: true }));
        const name = `${this.game.id}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.session.json`;
        const file = new File([json], name, { type: 'application/json' });
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: this.game.title }); return; } catch { /* cancelled: fall back to the download */ } }
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      d.remove();
    };
    if (mode === 'save') row(this.t('exportSession'), '⤓').onclick = () => {
      // The inputs since the game started or a save was loaded, with the journal: `npm run replay` plays it back.
      void import('../tools/replay').then(({ sessionFile }) => {
        const blob = new Blob([JSON.stringify(sessionFile(this.game.id, this.engine), null, 1)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${this.game.id}-session.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      d.remove();
    };
    else row(this.t('importSave'), '⤒').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
      inp.onchange = async () => {
        const f = inp.files?.[0]; if (!f) return;
        try {
          const st = parseSave(this.game, JSON.parse(await f.text()), { warn: (message) => this.reportSaveWarning(message) });
          d.remove();
          // The imported game also lands in the first free slot, so it survives the next autosave.
          const free = metas.findIndex((x) => !x);
          if (free >= 0) {
            const roomName = this.game.rooms.find((r) => r.id === st.room)?.name ?? st.room;
            // The write failed (reported): the current game is kept, the file is not loaded over it.
            if (!(await this.slots.putSlot(free + 1, structuredClone(st), { at: Date.now(), room: st.room, roomName, v: st.v }))) return;
            this.toast(`${slotName(free + 1)} ✓`);
          }
          await this.engine.load(st);
        } catch (e) { this.toast(String((e as Error).message)); }
      };
      inp.click();
    };
    row(ui.resume, '▶').onclick = () => d.remove();
  }

  /** "Restart from the beginning": the autosave must go first; when the browser refuses, the player keeps the game. */
  private async restart() {
    if (!(await this.engine.store.clear())) { this.toast(this.t('saveFailed')); return; }
    await this.engine.newGame();
  }

  /** Title screen, then launches the game. */
  async showTitle() {
    const T = this.game.titleScreen;
    this.side.style.display = 'none';
    this.layoutTitle(true);
    const ov = el('div', 'overlay');
    this.scene.append(ov);
    await this.bank.preload([T?.decor, T?.logo].filter(Boolean) as Id[]);
    if (T?.decor) ov.innerHTML = `<img src="${this.bank.img(T.decor)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`;
    if (T?.video) ov.append(this.videoBg(T.video, T.decor));
    if (T?.logo) {
      const lg = el('img') as HTMLImageElement; lg.src = this.bank.img(T.logo); lg.alt = this.game.title;
      Object.assign(lg.style, { position: 'absolute', left: `${(370 - 215) * this.u}px`, top: `${8 * this.u}px`, width: `${430 * this.u}px`, animation: 'drop .9s ease-out both' });
      ov.append(lg);
    }
    const row = el('div'); Object.assign(row.style, { position: 'absolute', left: '0', right: '0', top: '73%', display: 'flex', justifyContent: 'center', gap: '4%', fontSize: `${Math.max(9, Math.round(this.sw * 0.018))}px` });
    const nb = el('button', 'bigbtn', '▶ ' + esc(this.game.ui.newGame.toUpperCase())); nb.style.color = '#ffd640';
    const cb = el('button', 'bigbtn', esc(this.game.ui.continue.toUpperCase())); cb.style.color = '#9fe0ff';
    const has = this.engine.hasSave();
    (cb as HTMLButtonElement).disabled = !has;
    row.append(nb, cb); ov.append(row);
    queueMicrotask(() => nb.focus({ preventScroll: true }));
    if (T?.footer) { const f = el('div', '', esc(T.footer)); Object.assign(f.style, { position: 'absolute', bottom: '2.5%', left: '0', right: '0', textAlign: 'center', font: `${Math.max(7, Math.round(this.sw * 0.011))}px var(--font-pixel)`, color: '#c8bedc', textShadow: '2px 2px 0 #14081e' }); ov.append(f); }
    let musicStarted = false;
    const startMusic = () => { if (!musicStarted && T?.music) { musicStarted = true; this.audio.play(T.music); } };
    ov.addEventListener('pointerdown', startMusic);
    const launch = async (fresh: boolean) => {
      ov.remove(); this.side.style.display = ''; this.layoutTitle(false);
      if (fresh) { if (!(await this.engine.store.clear())) { this.toast(this.t('saveFailed')); if (this.engine.hasSave()) { await this.engine.continueGame(); return; } } await this.engine.newGame(); } else await this.engine.continueGame();
    };
    nb.onclick = () => {
      startMusic();
      if (!has) { void launch(true); return; }
      const d = el('div', 'dim'); const m = el('div', 'menu', `<h3>!</h3><p>${esc(this.game.ui.confirmErase)}</p>`);
      const y = el('button', 'warn', `<span>${esc(this.game.ui.yes)}</span><span>!</span>`), n = el('button', '', `<span>${esc(this.game.ui.no)}</span><span>▶</span>`);
      y.onclick = () => { d.remove(); void launch(true); }; n.onclick = () => d.remove();
      m.append(y, n); d.append(m); ov.append(d);
    };
    cb.onclick = () => { startMusic(); void launch(false); };
    void this.warmAround(this.engine.store.load()?.room ?? this.game.start.room, true).then(() => this.warmAll());
  }

  /**
   * Background preload scoped to the current room and immediately reachable rooms. The room renderer itself still
   * blocks on exactly what it needs; this only fills the runtime cache during idle time and respects constrained links.
   */
  private async warmAround(roomId: Id, initial = false) {
    const b = this.bank;
    const budget = this.game.assetBudgets ?? {};
    // The asset graph's scopes (core/asset-graph.ts): the current room, the title at boot, then the rooms one exit or
    // one unlocked map place away. The same keys the weight budgets count and the offline plan caches.
    const g = this.assets ??= assetGraph(this.game, { manifest: b.manifest, bindings: Object.fromEntries(Object.entries(this.mg).map(([k, m]) => [k, m.bindings ?? {}])), layouts: Object.fromEntries(this.game.rooms.map((r) => [r.id, this.engine.layout(r.id)])) });
    const rooms = new Map(this.game.rooms.map((r) => [r.id, r]));
    const current = rooms.get(roomId);
    if (!current) return;
    const urls = (keys: string[]) => {
      const by: Record<AssetKind, string[]> = { img: [], sfx: [], music: [], voice: [], video: [] };
      for (const k of keys) { const [kind, id] = splitKey(k); by[kind].push(kind === 'img' ? b.img(id) : kind === 'sfx' ? b.sfx(id) : kind === 'voice' ? b.voice(id) : kind === 'music' ? b.music(id) : b.video(id)); }
      return by;
    };
    const imageLimit = budget.initialImages ?? 120, audioLimit = budget.audioFiles ?? 16;
    const here = urls([...(g.rooms[roomId] ?? []), ...(initial ? g.title : [])]);
    await b.warm(here.img.slice(0, imageLimit));
    const neighbors = new Set<Id>(Object.values(current.exits ?? {}).map((x) => x.to));
    for (const [id, place] of Object.entries(this.game.map?.places ?? {})) if (this.engine.state?.unlocked.includes(id)) neighbors.add(place.room);
    const near = urls([...neighbors].slice(0, budget.neighboringRooms ?? 3).flatMap((id) => g.rooms[id] ?? []));
    await b.warm(near.img.filter((u) => !here.img.includes(u)).slice(0, imageLimit));
    await b.warm([...new Set([...here.sfx, ...near.sfx])].slice(0, audioLimit));
    await b.warm([...new Set([...here.voice, ...near.voice])].slice(0, audioLimit));
    await b.warm([...new Set([...here.music, ...near.music])].slice(0, 4), 2);
    if (initial) await b.warm(here.video, 1);
  }

  /**
   * The rest of the game, for offline play (`GameDef.offline`, default `full`): once per page, after the room-scoped
   * warm-up, batch by batch during idle time, paused while the page is hidden. The room renderer never waits for it.
   */
  async warmAll(retry = false) {
    if (this.warmedAll && !retry) return;
    if (this.offlineStatus.state === 'running') return;
    const first = !this.warmedAll;
    this.warmedAll = true;
    const set = (s: OfflineStatus) => { this.offlineStatus = s; this.offlineWatchers.forEach((w) => w(s)); };
    try {
      if (this.game.offline === 'nearby') { set({ state: 'off', done: 0, total: 0, failed: [] }); return; }
      const b = this.bank;
      const plan = offlinePlan(this.game, b.manifest);
      let estimate: { usage?: number; quota?: number } | undefined;
      try { estimate = await (navigator as unknown as { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } }).storage?.estimate?.(); } catch { /* no estimate: proceed */ }
      let status = offlineStart(plan, estimate);
      set(status);
      if (status.state !== 'running') return; // quota too small: say so, download nothing
      const visible = () => new Promise<void>((r) => { if (!document.hidden) return r(); const on = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', on); r(); } }; document.addEventListener('visibilitychange', on); });
      for (const batch of plan) {
        await visible();
        const r = await b.warm(batch.ids.map((id) => this.offlineUrl(batch.kind, id)), batch.kind === 'img' ? 3 : 1, { heavy: batch.kind === 'music' || batch.kind === 'video' });
        status = offlineFold(status, r, batch.ids.length);
        set(status);
      }
      status = offlineFinish(status);
      set(status);
      if (import.meta.env?.DEV) console.info(`offline: ${status.state}, ${status.done}/${status.total} files${status.reason ? ` (${status.reason})` : ''}`);
    } catch (e) {
      set(offlineFinish({ ...this.offlineStatus, state: 'partial', reason: this.offlineStatus.reason ?? 'network' }));
      console.warn('offline warm-up stopped', e);
    } finally { if (first) this.offlineDone(this.offlineStatus); }
  }

  private offlineUrl(kind: string, id: string) {
    const b = this.bank;
    return kind === 'img' ? b.img(id) : kind === 'sfx' ? b.sfx(id) : kind === 'voice' ? b.voice(id) : kind === 'music' ? b.music(id) : b.video(id);
  }

  /** Every URL the full warm-up caches (`scripts/e2e-pwa.mjs` checks each one against the cache, offline). */
  offlineUrls(): string[] {
    return offlinePlan(this.game, this.bank.manifest).flatMap((batch) => batch.ids.map((id) => this.offlineUrl(batch.kind, id)));
  }

  /** Watches the warm-up status (the pause menu's row); returns the unsubscribe. */
  onOffline(w: (s: OfflineStatus) => void): () => void { this.offlineWatchers.add(w); return () => this.offlineWatchers.delete(w); }

  /** The title screen takes up the full width (no side column). */
  private layoutTitle(full: boolean) {
    if (!full) { this.layout(); return; }
    const r = this.root.getBoundingClientRect();
    let sw = r.width, sh = Math.min(r.height, sw / 1.6); sw = Math.round(sh * 1.6);
    Object.assign(this.g.style, { width: `${sw}px`, height: `${r.height}px` });
    Object.assign(this.scol.style, { width: `${sw}px`, height: `${r.height}px` });
    Object.assign(this.scene.style, { width: `${sw}px`, height: `${Math.round(sh)}px` });
    this.u = sw / 640; this.sw = sw;
  }
}
