// Structured forms for the DSL (3.4): a condition, a command list, a reaction, a stage, built from the shapes of
// src/studio/schema.ts. Each editor is `{ el, get() }`: the element to show and a function that reads the value back
// (it throws on a field that cannot be read, like broken JSON). Ids come with the game's own as suggestions.
import type { Cmd, Cond, RoomDef } from '@engine/core/types';
import { CMD_KEYS, cmdKey, type CmdKey } from '@engine/core/cmds';
import { CMD_SPECS, COND_KINDS, type CondKind, type Field, type Ref } from './schema';
import type { GameInfo } from './api';
import { autoGrow, h } from './ui';
import { must } from '../engine/core/must';

export interface Ed {
  el: HTMLElement;
  get(): unknown;
}
export interface FormCtx {
  info: GameInfo;
  room?: RoomDef;
}

let lists = 0;
/** The ids a reference suggests (free text stays possible: a flag is born where it is first set). */
function ids(ctx: FormCtx, ref?: Ref): string[] {
  const r = ctx.room,
    i = ctx.info;
  switch (ref) {
    case 'item':
      return Object.keys(i.items);
    case 'char':
      return Object.keys(i.characters);
    case 'who':
      return ['hero', ...Object.keys(i.characters), ...Object.keys(r?.props ?? {}), ...Object.keys(r?.actors ?? {})];
    case 'room':
      return i.rooms.map((x) => x.id);
    case 'verb':
      return i.verbs.map((v) => v.id);
    case 'sfx':
      return i.sfx ?? [];
    case 'image':
      return Object.keys(i.images);
    case 'prop':
      return Object.keys(r?.props ?? {});
    case 'target':
      return [
        ...Object.keys(r?.props ?? {}),
        ...Object.keys(r?.hotspots ?? {}),
        ...Object.keys(r?.actors ?? {}),
        ...Object.keys(i.items),
      ];
    case 'checkpoint':
      return Object.keys(i.checkpoints);
    default:
      return [];
  }
}

function idInput(v: unknown, ctx: FormCtx, ref?: Ref): Ed {
  const list = `ids-${++lists}`;
  const input = h('input', {
    type: 'text',
    value: typeof v === 'string' ? v : '',
    list,
    class: 'f-id',
    placeholder: ref ?? 'id',
  });
  const dl = h(
    'datalist',
    { id: list },
    ids(ctx, ref).map((x) => h('option', { value: x })),
  );
  return { el: h('span', { class: 'f-idwrap' }, input, dl), get: () => input.value.trim() };
}

const num = (v: unknown, f: { min?: number; max?: number; step?: number }): Ed => {
  const input = h('input', {
    type: 'number',
    value: typeof v === 'number' ? String(v) : '',
    min: f.min,
    max: f.max,
    step: f.step ?? 1,
    class: 'f-num',
  });
  return { el: input, get: () => (input.value === '' ? undefined : Number(input.value)) };
};

function pointEd(v: unknown): Ed {
  const p = Array.isArray(v) ? (v as number[]) : [320, 360];
  const x = num(p[0], { step: 1 }),
    y = num(p[1], { step: 1 });
  return { el: h('span', { class: 'f-point' }, 'x ', x.el, ' y ', y.el), get: () => [x.get() ?? 0, y.get() ?? 0] };
}

/** Any field of the schema. */
function fieldEditor(f: Field, v: unknown, ctx: FormCtx): Ed {
  switch (f.k) {
    case 'text': {
      const t = autoGrow(h('textarea', { rows: 1, class: 'f-text' }, typeof v === 'string' ? v : ''));
      return { el: t, get: () => t.value };
    }
    case 'id':
      return idInput(v, ctx, f.ref);
    case 'number':
      return num(v, f);
    case 'bool': {
      const c = h('input', { type: 'checkbox', checked: v !== false && v !== undefined });
      return { el: c, get: () => c.checked };
    }
    case 'enum': {
      const s = h(
        'select',
        null,
        f.values.map((x) => h('option', { value: x, selected: x === v }, x)),
      );
      return { el: s, get: () => s.value };
    }
    case 'point':
      return pointEd(v);
    case 'idOrPoint': {
      const isPt = Array.isArray(v);
      const mode = h(
        'select',
        null,
        h('option', { value: 'id', selected: !isPt }, 'a thing'),
        h('option', { value: 'pt', selected: isPt }, 'a point'),
      );
      const slot = h('span');
      let ed: Ed = isPt ? pointEd(v) : idInput(v, ctx, f.ref);
      slot.append(ed.el);
      mode.addEventListener('change', () => {
        ed = mode.value === 'pt' ? pointEd(undefined) : idInput(undefined, ctx, f.ref);
        slot.replaceChildren(ed.el);
      });
      return { el: h('span', { class: 'f-row' }, mode, slot), get: () => ed.get() };
    }
    case 'cond':
      return condEditor(v as Cond | undefined, ctx);
    case 'cmds':
      return cmdsEditor(Array.isArray(v) ? (v as Cmd[]) : [], ctx);
    case 'tuple': {
      const arr = Array.isArray(v) ? v : [];
      const eds = f.items.map((it, i) => fieldEditor(it, arr[i], ctx));
      return {
        el: h(
          'span',
          { class: 'f-row' },
          eds.map((e, i) =>
            h(
              'label',
              { class: 'f-lab' },
              f.labels?.[i] ? h('span', { class: 'muted small' }, f.labels[i]) : null,
              e.el,
            ),
          ),
        ),
        get: () => eds.map((e) => e.get()),
      };
    }
    case 'list':
      return listEditor(
        Array.isArray(v) ? v : [],
        (x) => fieldEditor(f.of, x, ctx),
        f.label ?? 'item',
        () => (f.of.k === 'cmds' ? [] : f.of.k === 'object' ? {} : undefined),
      );
    case 'object':
      return objectEditor(f.fields, (v && typeof v === 'object' ? v : {}) as Record<string, unknown>, ctx);
    case 'json': {
      const t = autoGrow(
        h('textarea', { rows: 1, class: 'f-json', spellcheck: false }, v === undefined ? '' : JSON.stringify(v)),
      );
      return {
        el: t,
        get: () => {
          const s = t.value.trim();
          if (!s) return undefined;
          try {
            return JSON.parse(s);
          } catch {
            throw new Error(`not JSON: ${s.slice(0, 40)}`);
          }
        },
      };
    }
  }
}

/** A list: each item with move up / down and remove, then "+ item". */
function listEditor(items: unknown[], make: (v: unknown) => Ed, label: string, blank: () => unknown): Ed {
  const box = h('div', { class: 'f-list' });
  const rows: { el: HTMLElement; ed: Ed }[] = [];
  const draw = () =>
    box.replaceChildren(
      ...rows.map((r) => r.el),
      h(
        'button',
        {
          class: 'small',
          type: 'button',
          onclick: () => {
            add(blank());
            draw();
          },
        },
        `+ ${label}`,
      ),
    );
  const add = (v: unknown) => {
    const ed = make(v);
    const row = { el: h('div', { class: 'f-item' }), ed };
    const move = (d: number) => {
      const i = rows.indexOf(row),
        j = i + d;
      if (j < 0 || j >= rows.length) return;
      [rows[i], rows[j]] = [must(rows[j], 'row to swap'), must(rows[i], 'row to move')];

      draw();
    };
    row.el.append(
      h('div', { class: 'f-body' }, ed.el),
      h(
        'span',
        { class: 'f-tools' },
        h('button', { class: 'icon', type: 'button', title: 'Up', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'icon', type: 'button', title: 'Down', onclick: () => move(1) }, '↓'),
        h(
          'button',
          {
            class: 'icon',
            type: 'button',
            title: 'Remove',
            onclick: () => {
              rows.splice(rows.indexOf(row), 1);
              draw();
            },
          },
          '✕',
        ),
      ),
    );
    rows.push(row);
  };
  items.forEach(add);
  draw();
  return { el: box, get: () => rows.map((r) => r.ed.get()) };
}

/** An object: one row per field; an optional field has a box that says whether it is there. */
export function objectEditor(
  fields: Readonly<Record<string, Field & { optional?: boolean }>>,
  v: Record<string, unknown>,
  ctx: FormCtx,
): Ed {
  const rows = Object.entries(fields).map(([k, f]) => {
    const ed = fieldEditor(f, v[k], ctx);
    const on = h('input', {
      type: 'checkbox',
      checked: !f.optional || v[k] !== undefined,
      title: f.optional ? 'Set' : undefined,
      disabled: !f.optional,
    });
    const body = h('div', { class: 'f-val', hidden: f.optional && v[k] === undefined }, ed.el);
    on.addEventListener('change', () => {
      body.hidden = !on.checked;
    });
    return {
      k,
      ed,
      on,
      el: h('div', { class: 'f-field' }, h('label', { class: 'f-key' }, f.optional ? on : null, k), body),
    };
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

// ---------------------------------------------------------------- conditions

function condKind(c: Cond | undefined): CondKind {
  if (typeof c === 'string') return c.startsWith('!') ? 'notflag' : 'flag';
  if (!c) return 'flag';
  if ('flag' in c) return 'flagvalue';
  return (Object.keys(c)[0] as CondKind) ?? 'flag';
}

/** A condition: its kind, then its fields (`all` / `any` / `not` hold conditions). */
function condEditor(c: Cond | undefined, ctx: FormCtx): Ed {
  const kind = h(
    'select',
    { class: 'f-kind' },
    COND_KINDS.map((k) => h('option', { value: k, selected: k === condKind(c) }, k)),
  );
  const slot = h('span', { class: 'f-row' });
  let get: () => unknown = () => undefined;
  const build = (k: CondKind, v: Cond | undefined) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    let ed: Ed;
    switch (k) {
      case 'flag':
        ed = idInput(typeof v === 'string' && !v.startsWith('!') ? v : '', ctx, 'flag');
        get = () => ed.get();
        break;
      case 'notflag':
        ed = idInput(typeof v === 'string' && v.startsWith('!') ? v.slice(1) : '', ctx, 'flag');
        get = () => `!${ed.get()}`;
        break;
      case 'flagvalue':
        ed = objectEditor(
          {
            flag: { k: 'id', ref: 'flag' },
            eq: { k: 'json', optional: true },
            gte: { k: 'number', optional: true },
            lt: { k: 'number', optional: true },
          },
          o,
          ctx,
        );
        get = () => ed.get();
        break;
      case 'not':
        ed = condEditor(o.not as Cond, ctx);
        get = () => ({ not: ed.get() });
        break;
      case 'all':
      case 'any':
        ed = listEditor(
          (o[k] as Cond[]) ?? [],
          (x) => condEditor(x as Cond, ctx),
          'condition',
          () => undefined,
        );
        get = () => ({ [k]: ed.get() });
        break;
      case 'prop':
      case 'actorIn':
        ed = fieldEditor(
          {
            k: 'tuple',
            items: [
              { k: 'id', ref: k === 'prop' ? 'prop' : 'char' },
              { k: 'id', ref: k === 'prop' ? undefined : 'room' },
            ],
            labels: k === 'prop' ? ['prop', 'state'] : ['who', 'room'],
          },
          o[k],
          ctx,
        );
        get = () => ({ [k]: ed.get() });
        break;
      default: {
        const ref: Ref | undefined =
          k === 'has' ? 'item' : k === 'visited' || k === 'room' ? 'room' : k === 'player' ? 'char' : undefined;
        ed = idInput(o[k], ctx, ref);
        get = () => ({ [k]: ed.get() });
      }
    }
    slot.replaceChildren(ed.el);
  };
  build(condKind(c), c);
  kind.addEventListener('change', () => build(kind.value as CondKind, undefined));
  return { el: h('span', { class: 'f-cond' }, kind, slot), get: () => get() };
}

// ---------------------------------------------------------------- commands

/** One command: its key (or a plain hero line), then its fields. */
function cmdEditor(c: Cmd | undefined, ctx: FormCtx): Ed {
  const keyOf = (x: Cmd | undefined): CmdKey | 'line' =>
    typeof x === 'string' || x === undefined ? 'line' : (cmdKey(x) ?? 'line');
  const key = h(
    'select',
    { class: 'f-kind' },
    h('option', { value: 'line', selected: keyOf(c) === 'line' }, 'Hero says'),
    ...CMD_KEYS.map((k) => h('option', { value: k, selected: keyOf(c) === k }, CMD_SPECS[k].label)),
  );
  const slot = h('div', { class: 'f-cmdbody' });
  let get: () => unknown = () => undefined;
  const build = (k: CmdKey | 'line', v: Cmd | undefined) => {
    if (k === 'line') {
      const t = fieldEditor({ k: 'text' }, typeof v === 'string' ? v : '', ctx);
      get = () => t.get();
      slot.replaceChildren(t.el);
      return;
    }
    const spec = CMD_SPECS[k],
      o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const main = fieldEditor(spec.value, o[k] ?? (spec.value.k === 'bool' ? true : undefined), ctx);
    const extra = spec.extra ? objectEditor(spec.extra, o, ctx) : null;
    get = () => ({ [k]: main.get(), ...((extra?.get() as Record<string, unknown>) ?? {}) });
    slot.replaceChildren(main.el, ...(extra ? [extra.el] : []));
  };
  build(keyOf(c), c);
  key.addEventListener('change', () => build(key.value as CmdKey | 'line', undefined));
  return { el: h('div', { class: 'f-cmd' }, key, slot), get: () => get() };
}

function cmdsEditor(list: Cmd[], ctx: FormCtx): Ed {
  return listEditor(
    list,
    (x) => cmdEditor(x as Cmd, ctx),
    'command',
    () => '',
  );
}
