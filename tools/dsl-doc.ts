// npx tsx tools/dsl-doc.ts [--check] (4.1.12): the DSL's reference, generated from its schemas and their sentences, as
// the "Reference" section of docs/en/DSL.md and docs/fr/DSL.md (between `<!-- dsl-doc:begin -->` and
// `<!-- dsl-doc:end -->`, each in its language): every condition (core/ir-schema.ts, tools/dsl-meta.ts), every
// command with its shape (src/studio/schema.ts `CMD_SPECS`, the Studio's forms) and its sentence, the objectives'
// fields (`objectiveSchema` and its metadata), and how each field of the game and of a room counts for the IR and the
// fingerprint (core/ir-fields.ts). `--check` exits 1 when a page is behind; tests/dsl-doc.test.ts runs it.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type * as z from 'zod';
import { CMD_KEYS } from '../src/engine/core/cmds';
import { FIELD_CLASSES, type FieldClass } from '../src/engine/core/ir-fields';
import { type FieldMeta, objectiveSchema } from '../src/engine/core/ir-schema';
import { CMD_SPECS, COND_KINDS, type Field } from '../src/studio/schema';
import { CMD_DOCS, COND_DOCS } from './dsl-meta';

const ROOT = resolve(import.meta.dirname, '..');
const BEGIN = '<!-- dsl-doc:begin -->';
const END = '<!-- dsl-doc:end -->';
type Lang = 'en' | 'fr';

/** A field of the Studio's schema, as it is written. */
export function shapeOf(f: Field): string {
  switch (f.k) {
    case 'text':
      return 'text';
    case 'id':
      return f.ref ? `${f.ref}` : 'id';
    case 'number':
      return 'number';
    case 'bool':
      return 'true';
    case 'enum':
      return f.values.map((v) => `'${v}'`).join(' \\| ');
    case 'point':
      return '[x, y]';
    case 'idOrPoint':
      return `${f.ref ?? 'id'} \\| [x, y]`;
    case 'cond':
      return 'cond';
    case 'cmds':
      return '[cmd, …]';
    case 'tuple':
      return `[${f.items.map((it, i) => f.labels?.[i] ?? shapeOf(it)).join(', ')}]`;
    case 'list':
      return `[${shapeOf(f.of)}, …]`;
    case 'object':
      return `{ ${Object.entries(f.fields)
        .map(([k, x]) => `${k}${x.optional ? '?' : ''}: ${shapeOf(x)}`)
        .join(', ')} }`;
    case 'json':
      return '…';
  }
}

const cell = (s: string) => s.replace(/\n/g, ' ');
const T = {
  en: {
    conditions: 'Conditions',
    condIntro: 'A condition is data: a string for a flag, an object for the rest, nested with `not`, `all`, `any`.',
    written: 'Written',
    means: 'Means',
    commands: 'Commands',
    cmdIntro:
      'A command is one key of `CMD_KEYS`; its fields are the Studio form’s. A plain string is the hero’s line.',
    command: 'Command',
    shape: 'Shape',
    does: 'Does',
    objectives: 'Objectives (`GameDef.objectives[id]`)',
    field: 'Field',
    type: 'Type',
    classes: 'How each field counts (IR and fingerprint)',
    classIntro:
      'From `core/ir-fields.ts`: `logic` is in the IR and the fingerprint’s `logic`; `presentation` in its `presentation`; `both` splits; `meta` is for the tools only.',
    game: 'The game (`GameDef`)',
    room: 'A room (`RoomDef`)',
    counts: { logic: 'logic', presentation: 'presentation', both: 'both', meta: 'meta' } as Record<FieldClass, string>,
  },
  fr: {
    conditions: 'Conditions',
    condIntro:
      'Une condition est une donnée : une chaîne pour un drapeau, un objet pour le reste, imbriqués avec `not`, `all`, `any`.',
    written: 'Écrit',
    means: 'Signifie',
    commands: 'Commandes',
    cmdIntro:
      'Une commande est une clé de `CMD_KEYS` ; ses champs sont ceux du formulaire du Studio. Une chaîne seule est une réplique du héros.',
    command: 'Commande',
    shape: 'Forme',
    does: 'Fait',
    objectives: 'Objectifs (`GameDef.objectives[id]`)',
    field: 'Champ',
    type: 'Type',
    classes: 'Ce que compte chaque champ (IR et empreinte)',
    classIntro:
      'Selon `core/ir-fields.ts` : `logic` est dans l’IR et dans le `logic` de l’empreinte ; `presentation` dans son `presentation` ; `both` se partage ; `meta` ne sert qu’aux outils.',
    game: 'Le jeu (`GameDef`)',
    room: 'Une salle (`RoomDef`)',
    counts: { logic: 'logic', presentation: 'presentation', both: 'both', meta: 'meta' } as Record<FieldClass, string>,
  },
};

type Def = { type: string; innerType?: z.ZodType };
const defOf = (s: z.ZodType) => (s as unknown as { def: Def }).def;
const metaOf = (s: z.ZodType): FieldMeta | undefined =>
  (s as unknown as { meta(): FieldMeta | undefined }).meta() ??
  (defOf(s).type === 'optional' ? metaOf(defOf(s).innerType!) : undefined);
const typeOf = (s: z.ZodType, lang: Lang): string => {
  const d = defOf(s);
  if (d.type === 'optional') return `${typeOf(d.innerType!, lang)} (${lang === 'en' ? 'optional' : 'facultatif'})`;
  if (d.type === 'lazy' || d.type === 'union') return 'cond';
  return d.type === 'boolean' ? 'boolean' : d.type;
};

/** The generated block of one language. */
export function dslBlock(lang: Lang): string {
  const t = T[lang];
  const i = lang === 'en' ? 0 : 1;
  const out: string[] = [];
  out.push(`### ${t.conditions}`, '', t.condIntro, '', `| ${t.written} | ${t.means} |`, '|---|---|');
  for (const k of COND_KINDS) out.push(`| \`${COND_DOCS[k].shape}\` | ${cell(COND_DOCS[k].said[i])} |`);
  out.push('', `### ${t.commands}`, '', t.cmdIntro, '', `| ${t.command} | ${t.shape} | ${t.does} |`, '|---|---|---|');
  for (const k of CMD_KEYS) {
    const spec = CMD_SPECS[k];
    const extra = Object.entries(spec.extra ?? {})
      .map(([x, f]) => `, ${x}${f.optional ? '?' : ''}: ${shapeOf(f)}`)
      .join('');
    out.push(`| \`${k}\` | \`{ ${k}: ${shapeOf(spec.value)}${extra} }\` | ${cell(CMD_DOCS[k][i])} |`);
  }
  out.push('', `### ${t.objectives}`, '', `| ${t.field} | ${t.type} | ${t.means} |`, '|---|---|---|');
  for (const [k, s] of Object.entries(objectiveSchema.shape as Record<string, z.ZodType>)) {
    const m = metaOf(s);
    out.push(`| \`${k}\` | ${typeOf(s, lang)} | ${cell(m ? (lang === 'en' ? m.description : m.fr) : '')} |`);
  }
  out.push('', `### ${t.classes}`, '', t.classIntro, '');
  for (const [title, table] of [
    [t.game, FIELD_CLASSES.game],
    [t.room, FIELD_CLASSES.room],
  ] as const) {
    const by = new Map<FieldClass, string[]>();
    for (const [k, c] of Object.entries(table)) by.set(c, [...(by.get(c) ?? []), `\`${k}\``]);
    const colon = lang === 'en' ? ':' : ' :';
    out.push(`${title}${colon}`, '');
    for (const c of ['logic', 'both', 'presentation', 'meta'] as const)
      if (by.get(c)?.length) out.push(`- **${t.counts[c]}**${colon} ${by.get(c)!.join(', ')}`);
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** The page with its generated block replaced (added at the end when the page has none). */
export function withDslBlock(page: string, block: string): string {
  const body = `${BEGIN}\n${block}\n${END}`;
  const i = page.indexOf(BEGIN);
  const j = page.indexOf(END);
  if (i >= 0 && j > i) return page.slice(0, i) + body + page.slice(j + END.length);
  return `${page.trimEnd()}\n\n${body}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  let behind = 0;
  for (const lang of ['en', 'fr'] as const) {
    const p = `docs/${lang}/DSL.md`;
    const file = resolve(ROOT, p);
    const page = readFileSync(file, 'utf8');
    const next = withDslBlock(page, dslBlock(lang));
    if (next === page) continue;
    if (process.argv.includes('--check')) {
      console.error(`✖  ${p} is behind the schemas: npx tsx tools/dsl-doc.ts`);
      behind++;
    } else {
      writeFileSync(file, next);
      console.log(`✔  ${p}: the reference written`);
    }
  }
  process.exit(behind ? 1 : 0);
}
