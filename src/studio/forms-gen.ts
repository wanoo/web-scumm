// Forms generated from the IR's schema (4.1.12, ADR 0013): a zod schema of core/ir-schema.ts becomes an editor
// (`{ el, get }`, like the hand-written ones of forms.ts): an object a row per field with its description, an optional
// field a box that says whether it is there, a list or a record its items, an id its suggestions, a condition or a
// command list the DSL's own editors. The objectives' form (ADR 0014) is this one; a new field in the schema shows up
// in the form without a line here. `formIssues` checks a value before it is written and names the file, the id and the
// field; `explainErrors` does the same for the validator's errors the server sends back.
import type { GameIR } from '@engine/core/ir';
import { cmdSchema, condSchema, type FieldMeta } from '@engine/core/ir-schema';
import type { Cmd, Cond } from '@engine/core/types';
import type * as z from 'zod';
import { cmdsEditor, condEditor, type Ed, type FormCtx, fieldEditor, listEditor } from './forms';
import { autoGrow, h } from './ui';

type Def = { type: string; [k: string]: unknown };
const defOf = (s: z.ZodType): Def => (s as unknown as { def: Def }).def;
/** A field's metadata: on the schema itself, else on what an `optional` wraps. */
function metaOf(s: z.ZodType): FieldMeta | undefined {
  const own = (s as unknown as { meta(): FieldMeta | undefined }).meta();
  if (own) return own;
  const d = defOf(s);
  return d.type === 'optional' ? metaOf(d.innerType as z.ZodType) : undefined;
}
const unwrap = (s: z.ZodType): z.ZodType =>
  defOf(s).type === 'optional' ? unwrap(defOf(s).innerType as z.ZodType) : s;

let lists = 0;
/** The ids a metadata reference suggests: the game's (free text stays possible). */
function suggestions(ctx: FormCtx, ref: FieldMeta['ref']): string[] {
  const i = ctx.info;
  switch (ref) {
    case 'objective':
      return Object.keys(i.objectives ?? {});
    case 'item':
      return Object.keys(i.items);
    case 'room':
      return i.rooms.map((r) => r.id);
    case 'char':
      return Object.keys(i.characters);
    case 'verb':
      return i.verbs.map((v) => v.id);
    default:
      return [];
  }
}

/** An editor for any value of `schema` (`meta`: the field's, when an `optional` around it carried it). */
function zodEditor(schema: z.ZodType, value: unknown, ctx: FormCtx, meta = metaOf(schema)): Ed {
  if (schema === condSchema) return condEditor(value as Cond | undefined, ctx);
  const d = defOf(schema);
  switch (d.type) {
    case 'optional':
      return zodEditor(d.innerType as z.ZodType, value, ctx, meta);
    case 'string': {
      const ref = meta?.ref;
      if (ref) {
        const list = `zids-${++lists}`;
        const input = h('input', { type: 'text', value: typeof value === 'string' ? value : '', list, class: 'f-id' });
        return {
          el: h(
            'span',
            { class: 'f-idwrap' },
            input,
            h(
              'datalist',
              { id: list },
              suggestions(ctx, ref).map((x) => h('option', { value: x })),
            ),
          ),
          get: () => input.value.trim() || undefined,
        };
      }
      const t = autoGrow(h('textarea', { rows: 1, class: 'f-text' }, typeof value === 'string' ? value : ''));
      return { el: t, get: () => t.value };
    }
    case 'number':
      return fieldEditor({ k: 'number' }, value, ctx);
    case 'boolean': {
      const c = h('input', { type: 'checkbox', checked: value === true });
      return { el: c, get: () => c.checked };
    }
    case 'enum':
      return fieldEditor({ k: 'enum', values: Object.values(d.entries as Record<string, string>) }, value, ctx);
    case 'literal':
      return {
        el: h('span', { class: 'muted' }, String((d.values as unknown[])[0])),
        get: () => (d.values as unknown[])[0],
      };
    case 'object':
      return objectForm(schema as z.ZodObject, value, ctx);
    case 'array': {
      const el = d.element as z.ZodType;
      if (el === cmdSchema) return cmdsEditor(Array.isArray(value) ? (value as Cmd[]) : [], ctx);
      return listEditor(
        Array.isArray(value) ? value : [],
        (x) => zodEditor(el, x, ctx),
        'item',
        () => undefined,
      );
    }
    case 'record': {
      const entries = value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : [];
      const valueSchema = d.valueType as z.ZodType;
      const ed = listEditor(
        entries,
        (x) => {
          const [k, v] = (x as [string, unknown] | undefined) ?? ['', undefined];
          const key = h('input', { type: 'text', value: k, class: 'f-id', placeholder: 'id' });
          const val = zodEditor(valueSchema, v, ctx);
          return { el: h('div', { class: 'f-row' }, key, val.el), get: () => [key.value.trim(), val.get()] };
        },
        'entry',
        () => undefined,
      );
      return { el: ed.el, get: () => Object.fromEntries(ed.get() as [string, unknown][]) };
    }
    default:
      return fieldEditor({ k: 'json' }, value, ctx);
  }
}

/** An object: a row per field of the schema, its description beside it, an optional field behind a box. */
export function objectForm(schema: z.ZodObject, value: unknown, ctx: FormCtx): Ed {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const rows = Object.entries(schema.shape as Record<string, z.ZodType>).map(([k, s]) => {
    const optional = defOf(s).type === 'optional';
    const meta = metaOf(s);
    const ed = zodEditor(unwrap(s), v[k], ctx, meta);
    const on = h('input', { type: 'checkbox', checked: !optional || v[k] !== undefined, disabled: !optional });
    const body = h('div', { class: 'f-val', hidden: optional && v[k] === undefined }, ed.el);
    on.addEventListener('change', () => {
      body.hidden = !on.checked;
    });
    const el = h(
      'div',
      { class: 'f-field', dataset: { field: k } },
      h('label', { class: 'f-key', title: meta?.description }, optional ? on : null, k),
      body,
      meta ? h('p', { class: 'muted small f-doc' }, meta.description) : null,
    );
    return { k, ed, on, el };
  });
  return {
    el: h(
      'div',
      { class: 'f-object' },
      rows.map((r) => r.el),
    ),
    get: () =>
      Object.fromEntries(
        rows
          .filter((r) => r.on.checked)
          .map((r) => [r.k, r.ed.get()])
          .filter(([, x]) => x !== undefined && x !== ''),
      ),
  };
}

/** Where an id is written, as `file:line`, from the IR's provenance (empty when unknown). */
const at = (ir: GameIR | undefined, key: string) => {
  const p = ir?.provenance[key];
  return p ? `${p.file}:${p.line}` : '';
};

/**
 * The problems of a value against its schema, each naming the file, the id and the field:
 * `games/demo/game.ts:120 · objective key · title: Too small: expected string to have >=1 characters`.
 */
export function formIssues(
  schema: z.ZodType,
  value: unknown,
  where: { id: string; kind: string; ir?: GameIR; key?: string },
): string[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  const file = at(where.ir, where.key ?? where.id);
  return r.error.issues.map(
    (i) =>
      `${file ? `${file} · ` : ''}${where.kind} ${where.id} · ${i.path.length ? i.path.join('.') : '(the value)'}: ${i.message}`,
  );
}

/**
 * The validator's errors (`<where> › <message>`) said with the file and line of the id they are about, the id, and
 * the field: `objectives.ghost.done › can never hold…` becomes `games/demo/game.ts:120 · objective ghost · done: can
 * never hold…`. An error whose id the IR does not know is kept as it is.
 */
export function explainErrors(errors: readonly string[], ir: GameIR | undefined): string[] {
  return errors.map((e) => {
    const i = e.indexOf(' › ');
    if (i < 0 || !ir) return e;
    const where = e.slice(0, i),
      msg = e.slice(i + 3);
    const m = /^(objectives|checkpoints)\.([\w-]+)(?:\.(.+))?$/.exec(where);
    if (m) {
      const kind = m[1] === 'objectives' ? 'objective' : 'checkpoint';
      const file = at(ir, `${kind}:${m[2]}`);
      return `${file ? `${file} · ` : ''}${kind} ${m[2]} · ${m[3] ?? '(the whole)'}: ${msg}`;
    }
    // A room, a rule or a script id at the head of the path (`garden.on[2].do`, `house`).
    const parts = where.split(/(?=[.[])/);
    for (let n = parts.length; n > 0; n--) {
      const id = parts.slice(0, n).join('');
      const file = at(ir, id);
      if (file) {
        const field = parts.slice(n).join('').replace(/^\./, '');
        return `${file} · ${id} · ${field || '(the whole)'}: ${msg}`;
      }
    }
    return e;
  });
}
