// The Studio (/__studio/, dev server only): tabs Rooms / Storyboard / Check / Notes over the game on disk.
import './style.css';
import { api, type StudioEvent } from './api';
import { CheckTab } from './check';
import { NotesTab, StoryboardTab } from './other';
import { RoomsTab } from './rooms';
import { h, toast } from './ui';

type TabId = 'rooms' | 'storyboard' | 'check' | 'notes';
const TABS: [TabId, string][] = [['rooms', 'Rooms'], ['storyboard', 'Storyboard'], ['check', 'Check'], ['notes', 'Notes']];

// Vite tells every page to reload when a game file changes (the engine view needs it). The Studio page doesn't:
// it follows changes through its own event feed, and keeps what is being typed.
import.meta.hot?.on('vite:beforeFullReload', (p: { path?: string; triggeredBy?: string }) => {
  if (p.triggeredBy && /[\\/]games[\\/]/.test(p.triggeredBy)) p.path = '/__studio-no-reload.html';
});

async function start() {
  const root = document.getElementById('studio')!;
  let info;
  try { info = await api.game(); } catch (e) {
    root.replaceChildren(h('p', { class: 'error pad' }, `The game does not load: ${(e as Error).message}`));
    return;
  }
  document.title = `Studio · ${info.title}`;

  // Own writes come back from the file watcher: don't announce them as outside changes.
  let ownUntil = 0;
  const ownWrite = () => { ownUntil = Date.now() + 2000; };

  const badge = h('span', { class: 'badge' });
  const check = new CheckTab(info, (state, text) => { badge.className = `badge ${state}`; badge.textContent = text; });
  const [hashTab, hashRoom] = location.hash.slice(1).split('/');
  const rooms = new RoomsTab({ info, saved: () => check.schedule(), ownWrite }, hashRoom);
  const storyboard = new StoryboardTab();
  const notes = new NotesTab(ownWrite);
  const panes: Record<TabId, HTMLElement> = { rooms: rooms.el, storyboard: storyboard.el, check: check.el, notes: notes.el };

  const nav = h('nav', { class: 'tabs', role: 'tablist' });
  let current: TabId = (TABS.some(([t]) => t === hashTab) ? hashTab : 'rooms') as TabId;
  const show = (t: TabId) => {
    current = t;
    for (const [id, el] of Object.entries(panes)) el.hidden = id !== t;
    nav.querySelectorAll('button').forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    history.replaceState(null, '', t === 'rooms' ? `#rooms/${rooms.room}` : `#${t}`);
    if (t === 'storyboard') void storyboard.load();
    if (t === 'notes') void notes.load();
  };
  for (const [id, label] of TABS) {
    nav.append(h('button', { role: 'tab', dataset: { tab: id }, onclick: () => show(id) }, label, id === 'check' ? badge : null));
  }
  const live = h('span', { class: 'live', title: 'Watching the game folder' }, '●');
  root.replaceChildren(
    h('header', { class: 'top' }, h('h1', null, 'Studio'), h('span', { class: 'game' }, info.title, h('span', { class: 'muted' }, ` · games/${info.id}`)), nav,
      h('a', { class: 'play', href: '/?dev', target: '_blank', rel: 'noopener' }, 'Play ↗'), live),
    h('main', null, ...Object.values(panes)));
  show(current);
  void check.run();
  // Proves the wiring of the other tabs even before they are opened.
  void storyboard.load();
  void notes.load();

  // Changes on disk (an AI, an editor, git): reload what they touch.
  const es = new EventSource('/__studio/api/events');
  es.onopen = () => live.classList.add('on');
  es.onerror = () => live.classList.remove('on');
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data) as StudioEvent;
    if (ev.type !== 'changed') return;
    const outside = Date.now() > ownUntil;
    if (outside && /\.(ts|json)$/.test(ev.file)) toast(`${ev.file} changed on disk`, 'info');
    rooms.onFileChanged(ev.file);
    if (ev.file === 'storyboard.json' && current === 'storyboard') void storyboard.load();
    if (ev.file === 'notes.json' && current === 'notes') void notes.load();
    if (outside && /\.(ts|json)$/.test(ev.file) && ev.file !== 'notes.json') check.schedule(1000);
  };
}

void start();
