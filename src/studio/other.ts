// Storyboard and Notes tabs: placeholders that prove the API wiring (their full UI is another lot).
import { api } from './api';
import { h, toast } from './ui';

export class StoryboardTab {
  readonly el = h('section', { class: 'tab placeholder' });
  async load() {
    try {
      const sb = await api.storyboard();
      this.el.replaceChildren(
        h('div', { class: 'soon' }, h('h2', null, 'Storyboard'), h('p', { class: 'muted' }, 'Coming soon: boards, panels, previews and notes per panel.')),
        h('div', { class: 'panel' }, h('h3', null, sb.title ?? 'storyboard.json', ' ', h('span', { class: 'muted small' }, `${sb.boards.length} board(s)`)),
          h('ol', { class: 'boards' }, sb.boards.map((b) => h('li', null, h('b', null, b.title), ' ',
            h('span', { class: 'muted small' }, `${b.id}${b.room ? ` · room ${b.room}` : ''} · ${b.panels?.length ?? 0} panel(s)`))))));
    } catch (e) { this.el.replaceChildren(h('p', { class: 'error' }, (e as Error).message)); }
  }
}

export class NotesTab {
  readonly el = h('section', { class: 'tab placeholder' });
  constructor(private ownWrite: () => void = () => undefined) {}
  async load() {
    try {
      const { entries } = await api.notes();
      const about = h('input', { type: 'text', placeholder: 'About (room, panel id, room.entity…)', 'aria-label': 'About' });
      const author = h('input', { type: 'text', value: localStorageGet('studio.author') || 'you', 'aria-label': 'Author' });
      const text = h('textarea', { rows: 3, placeholder: 'Your note…', 'aria-label': 'Note', required: true });
      const form = h('form', { class: 'addform' },
        h('div', { class: 'row2' }, h('label', { class: 'field' }, h('span', null, 'About'), about), h('label', { class: 'field' }, h('span', null, 'Author'), author)),
        h('label', { class: 'field' }, h('span', null, 'Note'), text),
        h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Add note')));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          localStorageSet('studio.author', author.value.trim());
          this.ownWrite();
          await api.addNote({ about: about.value, author: author.value, text: text.value });
          toast('Note added');
          await this.load();
        } catch (x) { toast((x as Error).message, 'error'); }
      });
      this.el.replaceChildren(
        h('div', { class: 'soon' }, h('h2', null, 'Notes'), h('p', { class: 'muted' }, 'A shared log in notes.json: you, your teammates and any AI read and write it. Full view coming soon.')),
        h('div', { class: 'panel' }, form),
        h('div', { class: 'panel' }, h('h3', null, `${entries.length} note(s)`),
          entries.length ? h('ul', { class: 'notes' }, [...entries].reverse().map((n) => h('li', null,
            h('div', { class: 'muted small' }, `${n.author} · ${new Date(n.at).toLocaleString()}${n.about ? ` · ${n.about}` : ''}`), h('p', null, n.text))))
          : h('p', { class: 'muted' }, 'No notes yet.')));
    } catch (e) { this.el.replaceChildren(h('p', { class: 'error' }, (e as Error).message)); }
  }
}

function localStorageGet(k: string): string { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
