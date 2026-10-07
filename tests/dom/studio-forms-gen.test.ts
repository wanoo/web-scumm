// @vitest-environment happy-dom
// The Studio's generated forms and its Language tab (4.1.12, ADR 0013 and 0014): a form built from the IR's schema
// shows every field with its description and reads back what it was given; a value is checked before it is sent and
// its problems name the file, the id and the field; the server's validation errors are said the same way; the tab lists
// the objectives with where they are written, and Edit previews the diff (a dry run) before Apply writes it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileGame } from '@engine/core/define';
import { compileIR } from '@engine/core/ir';
import { objectiveSchema } from '@engine/core/ir-schema';
import { type Api, type GameInfo, serverApi, useApi } from '../../src/studio/api';
import { explainErrors, formIssues, objectForm } from '../../src/studio/forms-gen';
import { IrTab } from '../../src/studio/ir-tab';
import { quest } from '../fixtures/objectives';

const info = {
  id: 'quest',
  title: 'Quest',
  rooms: [{ id: 'hall', name: 'Hall', decor: 'd/hall' }],
  characters: {},
  items: { key: { name: 'key', icon: 'i/key' } },
  verbs: [],
  checkpoints: {},
  objectives: quest().objectives,
  hero: 'hero',
  images: {},
} as unknown as GameInfo;
const ir = () => {
  const r = compileIR(compileGame(quest()), { extensions: { trusted: '' } });
  r.provenance = {
    'objective:chest': { file: 'games/quest/game.ts', line: 12 },
    hall: { file: 'games/quest/rooms/hall.ts', line: 3 },
  };
  return r;
};

describe('a form generated from the schema', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('has a row per field of the schema, with its description, and reads back what it was given', () => {
    const value = { title: 'Open the chest', done: 'chest_open', parent: 'escape' };
    const ed = objectForm(objectiveSchema, value, { info });
    document.body.append(ed.el);
    const fields = [...ed.el.querySelectorAll<HTMLElement>('.f-field')].map((f) => f.dataset.field);
    expect(fields).toEqual(Object.keys(objectiveSchema.shape));
    expect(ed.el.textContent).toContain('What the quest journal shows');
    expect(ed.get()).toEqual(value);
    // The optional field `optional`, ticked and set.
    const row = ed.el.querySelector<HTMLElement>('[data-field="optional"]')!;
    const [on, box] = row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    on!.checked = true;
    on!.dispatchEvent(new Event('change'));
    box!.checked = true;
    expect(ed.get()).toEqual({ ...value, optional: true });
    // The parent's id input suggests the game's objectives.
    const options = [...row.parentElement!.querySelectorAll('[data-field="parent"] datalist option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(options).toEqual(Object.keys(quest().objectives!));
  });

  it('names the file, the id and the field of a problem, before sending and after', () => {
    expect(formIssues(objectiveSchema, { title: 'x', done: 'y' }, { id: 'chest', kind: 'objective' })).toEqual([]);
    const issues = formIssues(
      objectiveSchema,
      { title: '', done: 'y' },
      {
        id: 'chest',
        kind: 'objective',
        ir: ir(),
        key: 'objective:chest',
      },
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^games\/quest\/game\.ts:12 · objective chest · title: /);
    expect(explainErrors(['objectives.chest.done › can never hold: flag "x" is never set'], ir())).toEqual([
      'games/quest/game.ts:12 · objective chest · done: can never hold: flag "x" is never set',
    ]);
    expect(explainErrors(['hall.on[2].do[0] › unknown item: "x"'], ir())).toEqual([
      'games/quest/rooms/hall.ts:3 · hall · on[2].do[0]: unknown item: "x"',
    ]);
    // An error whose id the IR does not know stays as it is.
    expect(explainErrors(['elsewhere › odd'], ir())).toEqual(['elsewhere › odd']);
  });
});

describe('the Language tab', () => {
  afterEach(() => {
    useApi(serverApi);
    document.body.innerHTML = '';
  });

  it('lists the objectives with where they are written; Edit previews the diff, Apply writes, a bad value is held back', async () => {
    const setValue = vi.fn(async (_id: string, _path: string, _v: unknown, dry?: boolean) => ({
      ok: true as const,
      line: 12,
      changed: true,
      diff: '@@ line 12 @@\n-    chest: { … }\n+    chest: { … }',
      ...(dry ? { dry: true as const } : {}),
    }));
    useApi({ ...serverApi, ir: async () => ir(), setValue } as unknown as Api);
    const tab = new IrTab(info);
    document.body.append(tab.el);
    await tab.load();
    const rows = [...tab.el.querySelectorAll<HTMLTableRowElement>('table.objectives tr[data-objective]')];
    expect(rows.map((r) => r.dataset.objective)).toEqual(['escape', 'chest', 'key', 'bell']);
    expect(rows[1]!.textContent).toContain('games/quest/game.ts:12');
    expect(tab.el.textContent).toContain('IR schema 1');
    rows[1]!.querySelector('button')!.click();
    const dialog = document.querySelector('.modal')!;
    expect(dialog.querySelector('h2')?.textContent).toBe('Objective chest');
    const [preview, apply] = [...dialog.querySelectorAll<HTMLButtonElement>('.structured .row button')];
    preview!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(setValue).toHaveBeenLastCalledWith(
      '@game',
      'objectives.chest',
      { title: 'Open the chest', done: 'chest_open', parent: 'escape' },
      true,
    );
    expect(dialog.querySelector('.diff')?.textContent).toContain('@@ line 12 @@');
    // An empty title: held back before anything is sent, with the file, the id and the field.
    const title = dialog.querySelector<HTMLTextAreaElement>('[data-field="title"] textarea')!;
    title.value = '';
    setValue.mockClear();
    apply!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(setValue).not.toHaveBeenCalled();
    expect(dialog.querySelector('.error')?.textContent).toMatch(/games\/quest\/game\.ts:12 · objective chest · title:/);
    title.value = 'Open it';
    apply!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(setValue).toHaveBeenLastCalledWith(
      '@game',
      'objectives.chest',
      { title: 'Open it', done: 'chest_open', parent: 'escape' },
      false,
    );
  });

  it('says it needs the dev server when the backend has no IR', async () => {
    const { ir: _ir, ...rest } = serverApi;
    useApi(rest as Api);
    const tab = new IrTab(info);
    await tab.load();
    expect(tab.el.textContent).toContain('needs the dev server');
  });
});
