// The Studio: tabs Rooms / Storyboard / Check / Notes over the game on disk (/__studio/ on the dev server), or over a
// build-time snapshot with the edits kept in this browser (demo mode: studio.html in a STUDIO=1 build, e.g. on GitHub
// Pages; see docs/en/STUDIO.md, "Demo mode").
import { VoicesTab } from './voices';
import { MusicTab } from './music';
import { undoButtons } from './structured';
import './style.css';
import { BASE, serverApi, useApi, type GameInfo, type StudioEvent, type StudioSnapshot } from './api';
import type { BrowserApi } from './api-browser';
import { AssetsTab } from './assets';
import { AssistantPanel } from './assistant';
import { CheckTab } from './check';
import { NotesStore, NotesTab, roomNotesBlock } from './notes';
import { PlayTab } from './play';
import { RoomsTab } from './rooms';
import { StoryboardTab } from './storyboard';
import { download, h, toast } from './ui';

type TabId = 'rooms' | 'storyboard' | 'assets' | 'voices' | 'music' | 'check' | 'play' | 'notes';
const TABS: [TabId, string][] = [['rooms', 'Rooms'], ['storyboard', 'Storyboard'], ['assets', 'Assets'], ['voices', 'Voices'], ['music', 'Music'], ['check', 'Check'], ['play', 'Play'], ['notes', 'Notes']];

// Vite tells every page to reload when a game file changes (the engine view needs it). The Studio page doesn't:
// it follows changes through its own event feed, and keeps what is being typed.
import.meta.hot?.on('vite:beforeFullReload', (p: { path?: string; triggeredBy?: string }) => {
  if (p.triggeredBy && /[\\/]games[\\/]/.test(p.triggeredBy)) p.path = '/__studio-no-reload.html';
});

/** The demo backend: the snapshot served next to studio.html, the edits in localStorage, the game module for checks. */
async function demoApi(): Promise<BrowserApi> {
  const [{ BrowserApi }, snapshot] = await Promise.all([
    import('./api-browser'),
    fetch(`${BASE}studio-demo/snapshot.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`no demo snapshot (${r.status}): build with STUDIO=1`);
      return r.json() as Promise<StudioSnapshot>;
    }),
  ]);
  let storage: Storage | undefined;
  try { storage = localStorage; } catch { /* blocked: edits last until the page is closed */ }
  return new BrowserApi({
    snapshot, storage, download,
    loadGame: async () => {
      const [g, eng] = await Promise.all([import('@game'), import('@engine/minigames')]);
      const m = g.manifest as unknown as { images?: Record<string, [number, number]>; audio?: Record<string, unknown> };
      return { game: g.game, minigames: { ...eng.minigames, ...g.minigames }, commands: g.commands, locales: g.locales, assets: m.images ? { images: m.images, audio: m.audio } : undefined };
    },
  });
}

/**
 * The backend: the dev server's API, or the demo one when the build says so (VITE_STUDIO_DEMO=1) or when there is no
 * API to talk to (a static host answers 404, or a page instead of JSON).
 */
async function pickBackend(): Promise<{ info: GameInfo; demo: BrowserApi | null }> {
  if (import.meta.env.VITE_STUDIO_DEMO !== '1') {
    const r = await fetch('/__studio/api/game', { cache: 'no-store' }).catch(() => null);
    const json = r?.headers.get('content-type')?.includes('json');
    if (r && json) {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `${r.status}`);
      useApi(serverApi);
      return { info: data as GameInfo, demo: null };
    }
    if (r && r.status !== 404 && r.ok === false) throw new Error(`${r.status} ${r.statusText}`);
  }
  const demo = await demoApi();
  useApi(demo);
  return { info: await demo.game(), demo };
}

/** "Demo: your edits stay in this browser", with Download patch and Reset demo. */
function demoBanner(demo: BrowserApi): HTMLElement {
  const count = h('span', { class: 'muted small' });
  const dl = h('button', { class: 'primary', onclick: () => {
    if (!demo.edits) { toast('No edits yet: change a text, a placement, the storyboard or a note first.', 'info'); return; }
    download(`studio-patch-${demo.gameId}.json`, JSON.stringify(demo.patchFile(), null, 2) + '\n', 'application/json');
  } }, 'Download patch');
  const reset = h('button', { onclick: () => {
    if (!confirm('Drop all your edits and go back to the original game?')) return;
    demo.reset();
    location.reload();
  } }, 'Reset demo');
  const refresh = () => { count.textContent = demo.edits ? `${demo.edits} edit${demo.edits > 1 ? 's' : ''} kept` : 'no edits yet'; };
  demo.onChange = refresh;
  refresh();
  return h('div', { class: 'demo-banner', role: 'note' },
    h('span', null, h('b', null, 'Demo:'), ' your edits stay in this browser. Download them as a patch and apply them to your copy with ',
      h('code', null, 'npm run studio-apply patch.json'), '.'),
    count, dl, reset);
}

async function start() {
  const root = document.getElementById('studio')!;
  let info: GameInfo, demo: BrowserApi | null;
  try { ({ info, demo } = await pickBackend()); } catch (e) {
    root.replaceChildren(h('p', { class: 'error pad' }, `The game does not load: ${(e as Error).message}`));
    return;
  }
  document.title = `Studio · ${info.title}`;

  // Own writes come back from the file watcher: don't announce them as outside changes.
  let ownUntil = 0;
  const ownWrite = () => { ownUntil = Date.now() + 2000; };

  const badge = h('span', { class: 'badge' });
  const check = new CheckTab(info, (state, text) => { badge.className = `badge ${state}`; badge.textContent = text; }, (room, path) => { rooms.openRoom(room); show('rooms'); rooms.focusPath(path); });
  const [hashTab, hashRoom] = location.hash.slice(1).split('/');
  const store = new NotesStore(ownWrite);
  let show: (t: TabId) => void = () => undefined;
  const openRoom = (id: string) => { rooms.openRoom(id); show('rooms'); };
  const rooms = new RoomsTab({ info, saved: () => check.schedule(), ownWrite,
    notesBlock: (room) => roomNotesBlock(store, room, (about) => { notes.focusAbout(about); show('notes'); }) }, hashRoom);
  const storyboard = new StoryboardTab({ info, notes: store, ownWrite, openRoom });
  const notes = new NotesTab({
    info, store, panels: () => storyboard.panels(),
    open: (about) => {
      if (storyboard.panels().some(([id]) => id === about)) { show('storyboard'); storyboard.showPanel(about); return; }
      openRoom(about.split('.')[0]);
    },
  });
  const assets = new AssetsTab({ info, ownWrite, openRoom, prepared: () => rooms.reloadFrame() });
  const play = new PlayTab(info);
  const voices = new VoicesTab();
  const music = new MusicTab(info);
  const panes: Record<TabId, HTMLElement> = { rooms: rooms.el, storyboard: storyboard.el, assets: assets.el, voices: voices.el, music: music.el, check: check.el, play: play.el, notes: notes.el };

  const nav = h('nav', { class: 'tabs', role: 'tablist' });
  let current: TabId = (TABS.some(([t]) => t === hashTab) ? hashTab : 'rooms') as TabId;
  show = (t: TabId) => {
    current = t;
    for (const [id, el] of Object.entries(panes)) el.hidden = id !== t;
    nav.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    history.replaceState(null, '', t === 'rooms' ? `#rooms/${rooms.room}` : `#${t}`);
    if (t === 'storyboard') void storyboard.load();
    if (t === 'notes') void notes.load();
    if (t === 'assets') void assets.load();
    if (t === 'voices') void voices.load();
    if (t === 'music') music.load();
  };
  for (const [id, label] of TABS) {
    nav.append(h('button', { role: 'tab', dataset: { tab: id }, onclick: () => show(id) }, label, id === 'check' ? badge : null));
  }
  const live = demo ? null : h('span', { class: 'live', title: 'Watching the game folder' }, '●');
  const assistant = new AssistantPanel({
    info, demo,
    selection: () => {
      const sel = rooms.selection;
      return { tab: current, room: rooms.room, entity: sel ? { kind: sel.kind, id: sel.id } : undefined, panel: current === 'storyboard' ? storyboard.currentPanel() : undefined };
    },
    refresh: (wrote) => {
      // On the dev server the file watcher reloads too; the demo has only this.
      if (wrote.some((t) => t !== 'add_note' && t !== 'set_storyboard')) { void rooms.load(); if (demo) rooms.reloadFrame(); check.schedule(300); }
      if (wrote.includes('set_storyboard')) { if (demo) void storyboard.reload(); else storyboard.onDiskChange(); check.schedule(300); }
      if (wrote.includes('add_note')) void store.load();
    },
  });
  const assistantBtn = h('button', { class: 'abtn', title: 'Ask an AI to help complete the game (a)', 'aria-label': 'Assistant', onclick: () => assistant.toggle() }, 'Assistant');
  root.replaceChildren(
    ...(demo ? [demoBanner(demo)] : []),
    h('header', { class: 'top' }, h('h1', null, 'Studio'), h('span', { class: 'game' }, info.title, h('span', { class: 'muted' }, ` · games/${info.id}`)), nav,
      undoButtons(() => { void rooms.load(); rooms.reloadFrame(); check.schedule(300); }),
      h('a', { class: 'play', href: `${BASE}?dev`, target: '_blank', rel: 'noopener', title: demo ? 'Play with your edits (dev tools on)' : undefined }, 'Play ↗'), assistantBtn, live),
    h('main', null, ...Object.values(panes)), assistant.el);
  show(current);
  void check.run();
  // The storyboard (panel ids for the notes) and the notes (shown in every tab) are read at start.
  void storyboard.load();
  void store.load();

  // Ctrl/Cmd+S saves the storyboard while its tab is shown.
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's' && current === 'storyboard') { e.preventDefault(); void storyboard.save(); }
    // `a` toggles the Assistant when nothing is being typed.
    const t = e.target as HTMLElement | null;
    if (e.key === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey && !(t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) { e.preventDefault(); assistant.toggle(); }
  });

  // Changes on disk (an AI, an editor, git): reload what they touch. The demo has no disk to watch.
  if (demo || !live) return;
  const es = new EventSource('/__studio/api/events');
  es.onopen = () => live.classList.add('on');
  es.onerror = () => live.classList.remove('on');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data) as StudioEvent;
    if (ev.type !== 'changed') return;
    const outside = Date.now() > ownUntil;
    if (outside && /\.(ts|json)$/.test(ev.file)) toast(`${ev.file} changed on disk`, 'info');
    rooms.onFileChanged(ev.file);
    assets.onFileChanged(ev.file);
    if (ev.file === 'storyboard.json' && outside) storyboard.onDiskChange();
    if (ev.file === 'notes.json' && outside) void store.load();
    if (outside && /\.(ts|json)$/.test(ev.file) && ev.file !== 'notes.json' && ev.file !== 'storyboard.json') check.schedule(1000);
  };
}

void start();
