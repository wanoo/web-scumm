// The Studio's Language tab (4.1.12, ADR 0013 and 0014): the game as the tools see it. The objectives first, each with
// a form generated from its schema (src/studio/forms-gen.ts) behind Edit and Add: a preview of the diff before the
// write, the write validated by the server and undone by the header's Undo, problems named by file, id and field.
// Then the IR: rooms and what stands in them, rules, scripts, each id with the `file:line` that writes it, and the
// whole IR as JSON.
import type { GameIR, IrSource } from '@engine/core/ir';
import { objectiveSchema } from '@engine/core/ir-schema';
import { api, type GameInfo } from './api';
import { explainErrors, formIssues, objectForm } from './forms-gen';
import { structuredEdit } from './structured';
import { h, toast } from './ui';

const where = (p: IrSource | undefined) => (p ? `${p.file}:${p.line}` : '');

export class IrTab {
  readonly el = h('section', { class: 'tab ir' });
  private ir: GameIR | undefined;

  constructor(private info: GameInfo) {}

  async load(): Promise<void> {
    if (!api.ir) {
      this.el.replaceChildren(h('p', { class: 'muted' }, 'The IR view needs the dev server (npm run studio).'));
      return;
    }
    try {
      this.ir = await api.ir();
      this.info = { ...this.info, objectives: Object.fromEntries(this.ir.objectives.map(({ id, ...o }) => [id, o])) };
    } catch (e) {
      this.el.replaceChildren(h('p', { class: 'error' }, (e as Error).message));
      return;
    }
    this.render();
  }

  private edit(id: string, value: Record<string, unknown> | undefined) {
    const editor = objectForm(objectiveSchema, value ?? { title: '', done: '' }, { info: this.info });
    structuredEdit({
      title: value ? `Objective ${id}` : `New objective ${id}`,
      room: '@game',
      path: `objectives.${id}`,
      editor,
      remove: !!value,
      check: (v) => formIssues(objectiveSchema, v, { id, kind: 'objective', ir: this.ir, key: `objective:${id}` }),
      explain: (errors) => explainErrors(errors, this.ir),
      after: () => void this.load(),
    });
  }

  private render() {
    const ir = this.ir!;
    const objectives = h(
      'table',
      { class: 'grid objectives' },
      h(
        'tr',
        null,
        ['id', 'title', 'done', 'parent', '', 'written at', ''].map((x) => h('th', null, x)),
      ),
      ir.objectives.map((o) =>
        h(
          'tr',
          { dataset: { objective: o.id } },
          h('td', null, h('code', null, o.id)),
          h('td', null, o.title),
          h('td', null, h('code', null, JSON.stringify(o.done))),
          h('td', null, o.parent ?? ''),
          h('td', null, o.optional ? 'optional' : ''),
          h('td', { class: 'muted small' }, where(ir.provenance[`objective:${o.id}`])),
          h(
            'td',
            null,
            h(
              'button',
              {
                class: 'small',
                type: 'button',
                onclick: () => {
                  const { id: _id, optional, ...rest } = o;
                  this.edit(o.id, optional ? { ...rest, optional } : rest);
                },
              },
              'Edit',
            ),
          ),
        ),
      ),
    );
    const add = h(
      'button',
      {
        class: 'small',
        type: 'button',
        onclick: () => {
          const id = prompt('Id of the new objective (letters, digits, . _ -)')?.trim();
          if (!id) return;
          if (!/^[\w.-]{1,64}$/.test(id)) {
            toast(`"${id}": letters, digits and . _ - only`, 'error');
            return;
          }
          this.edit(id, undefined);
        },
      },
      '+ objective',
    );
    const section = (title: string, rows: [string, string, string][]) =>
      h(
        'details',
        { class: 'ir-section' },
        h('summary', null, `${title} (${rows.length})`),
        h(
          'table',
          { class: 'grid' },
          rows.map(([id, what, at]) =>
            h(
              'tr',
              null,
              h('td', null, h('code', null, id)),
              h('td', null, what),
              h('td', { class: 'muted small' }, at),
            ),
          ),
        ),
      );
    this.el.replaceChildren(
      h('h2', null, 'Objectives'),
      h(
        'p',
        { class: 'muted small' },
        'The quest journal of the pause menu (ADR 0014). npm run solve -- --goal=100% proves every one that is not optional.',
      ),
      objectives,
      add,
      h('h2', null, 'The game as the tools see it'),
      h(
        'p',
        { class: 'muted small' },
        `${ir.gameId} · IR schema ${ir.schema} · engine ${ir.engine} · trusted extensions ${ir.extensions.trusted.slice(0, 12) || 'unknown'} (${ir.extensions.commands.map((c) => c.name).join(', ') || 'no custom command'})`,
      ),
      section(
        'Rooms',
        ir.rooms.map((r) => [r.id, `${r.name} · ${r.entities.length} entities`, where(ir.provenance[r.id])]),
      ),
      section(
        'Entities',
        ir.entities.map((e) => [e.key, `${e.kind}${e.name ? ` "${e.name}"` : ''}`, where(ir.provenance[e.key])]),
      ),
      section(
        'Rules, topics and listeners',
        ir.rules.map((r) => [r.id, r.kind, where(ir.provenance[r.id])]),
      ),
      section(
        'Scripts',
        ir.scripts.map((s) => [s.id, `${s.trigger} · ${s.do.length} commands`, where(ir.provenance[s.id])]),
      ),
      h(
        'details',
        { class: 'ir-section' },
        h('summary', null, 'The whole IR (JSON)'),
        h('pre', { class: 'ir-json' }, JSON.stringify(ir, null, 2)),
      ),
    );
  }
}
