// npx tsx tools/api-doc.ts [--check]: the signatures of the public API, read from the sources with the TypeScript
// compiler (4.1.7), written as the "Signatures" section of docs/en/API.md and docs/fr/API.md (the same block: a
// signature has no language). `--check` exits 1 when a page is behind the code; tests/api-doc.test.ts runs it.
//
// Stability (4.1.8). Every symbol the five entries of src/engine/api re-export carries, on the JSDoc of its original
// declaration, exactly one of two tags and a first sentence that says what it is:
// - `@public`: a name a game or a host calls or reads (a function, a constant, a class, a type its content or its
//   options are written with). A change is announced in the CHANGELOG; a removal waits for the next major
//   (docs/en/SUPPORT.md).
// - `@extension`: a contract a game or a host IMPLEMENTS, or is handed while implementing it (a Presenter, a save
//   store, a painter and the specs it is given, a minigame and its context, a custom command, a signal port). The same
//   promise, and one more: a member added to it is a breaking change for whoever implemented it, so it waits too.
// What src/engine exports without an entry re-exporting it is internal by construction and carries no tag (`@internal`
// marks the members of Engine the modules of core/ read). tests/api-doc.test.ts fails on a row with no description or
// no stability.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from '@typescript/typescript6';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRIES = ['content', 'player', 'minigames', 'testing', 'reality'];
const BEGIN = '<!-- api-doc:begin -->';
const END = '<!-- api-doc:end -->';
/** The widest signature printed (a wider one is cut: the page is a map, the source is the territory). */
const SIG_MAX = 160;

/** One export of an entry, as the generated table shows it. */
export interface ApiRow {
  entry: string;
  name: string;
  signature: string;
  doc: string;
  /** The declared stability, or '' when the declaration carries neither tag. */
  stability: 'public' | 'extension' | '';
}

/** The first sentence of a symbol's doc comment, one line. */
const doc = (sym: ts.Symbol, checker: ts.TypeChecker): string =>
  ts
    .displayPartsToString(sym.getDocumentationComment(checker))
    .split(/\n\s*\n/)[0]!
    .replace(/\s+/g, ' ')
    .trim();

/** The stability a symbol's JSDoc declares, '' when it declares none. */
const stability = (sym: ts.Symbol, checker: ts.TypeChecker): ApiRow['stability'] => {
  const tags = new Set(sym.getJsDocTags(checker).map((t) => t.name));
  return tags.has('public') ? 'public' : tags.has('extension') ? 'extension' : '';
};

/** The members of a type, summarised: a union by its size, an object by its first names. */
function summary(t: ts.Type, decl: ts.Node | undefined, checker: ts.TypeChecker): string {
  const props = t.getProperties();
  if (t.isUnion()) return `union of ${t.types.length}`;
  if (props.length)
    return `{ ${props
      .slice(0, 6)
      .map((p) => p.name)
      .join(', ')}${props.length > 6 ? `, … ${props.length - 6} more` : ''} }`;
  return checker.typeToString(t, decl, ts.TypeFormatFlags.NoTruncation);
}

/** The signature of one export: a call, a value's type, `class`, `interface { … }` or `type Name = …`. */
function signatureOf(sym: ts.Symbol, real: ts.Symbol, sf: ts.SourceFile, checker: ts.TypeChecker): string {
  const decl = real.declarations?.[0];
  if (real.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.Class)) {
    const t = checker.getTypeOfSymbolAtLocation(real, decl ?? sf);
    const calls = t.getCallSignatures();
    if (calls.length)
      return calls.map((c) => checker.signatureToString(c, decl, ts.TypeFormatFlags.NoTruncation)).join(' · ');
    if (real.flags & ts.SymbolFlags.Class) return `class ${sym.name}`;
    return checker.typeToString(t, decl, ts.TypeFormatFlags.NoTruncation);
  }
  const t = checker.getDeclaredTypeOfSymbol(real);
  if (real.flags & ts.SymbolFlags.TypeAlias) {
    // The alias's right-hand side as the source writes it (`type Id = string`, `type Point = [number, number]`,
    // `type Keyring = BridgeKey[]`, `type WalkTarget = Id | Point`): the checker would print the alias's own name, or
    // expand `Record` and the other aliases it is written with. A side too wide to read (`Cond`, `Cmd`) is summarised.
    const head = `type ${sym.name} = `;
    const rhs =
      decl && ts.isTypeAliasDeclaration(decl)
        ? decl.type.getText(decl.getSourceFile()).replace(/\s+/g, ' ')
        : checker.typeToString(t, decl, ts.TypeFormatFlags.NoTruncation);
    return head + (head.length + rhs.length <= SIG_MAX ? rhs : summary(t, decl, checker));
  }
  return `interface ${summary(t, decl, checker)}`;
}

/** The rows of the five entries, in the order of the page (entries as listed, names sorted). */
export function apiRows(): ApiRow[] {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  const files = ENTRIES.map((e) => resolve(ROOT, 'src/engine/api', `${e}.ts`));
  const program = ts.createProgram(files, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const rows: ApiRow[] = [];
  for (const [i, file] of files.entries()) {
    const sf = program.getSourceFile(file)!;
    const mod = checker.getSymbolAtLocation(sf)!;
    for (const sym of checker.getExportsOfModule(mod).sort((a, b) => a.name.localeCompare(b.name))) {
      const real = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      rows.push({
        entry: ENTRIES[i]!,
        name: sym.name,
        signature: signatureOf(sym, real, sf, checker).replace(/\s+/g, ' ').slice(0, SIG_MAX),
        doc: doc(real, checker) || doc(sym, checker),
        stability: stability(real, checker) || stability(sym, checker),
      });
    }
  }
  return rows;
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** The generated block: one table per entry, one line per export. */
export function signatures(rows = apiRows()): string {
  const out: string[] = [];
  for (const entry of ENTRIES) {
    out.push(`### web-scumm/${entry}`, '', '| Name | Signature | Stability | Doc |', '|---|---|---|---|');
    for (const r of rows.filter((r) => r.entry === entry))
      out.push(`| \`${r.name}\` | \`${cell(r.signature)}\` | ${r.stability} | ${cell(r.doc).slice(0, 140)} |`);
    out.push('');
  }
  return out.join('\n');
}

/** The page with its generated block replaced (added at the end when the page has none). */
export function withBlock(page: string, block: string): string {
  const body = `${BEGIN}\n${block.trimEnd()}\n${END}`;
  const i = page.indexOf(BEGIN);
  const j = page.indexOf(END);
  if (i >= 0 && j > i) return page.slice(0, i) + body + page.slice(j + END.length);
  return `${page.trimEnd()}\n\n${body}\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const rows = apiRows();
  const block = signatures(rows);
  let behind = 0;
  for (const r of rows) {
    if (!r.doc) console.error(`✖  ${r.entry}: ${r.name} has no description`);
    if (!r.stability) console.error(`✖  ${r.entry}: ${r.name} declares no stability (@public or @extension)`);
  }
  for (const p of ['docs/en/API.md', 'docs/fr/API.md']) {
    const file = resolve(ROOT, p);
    const page = readFileSync(file, 'utf8');
    const next = withBlock(page, block);
    if (next === page) continue;
    if (process.argv.includes('--check')) {
      console.error(`✖  ${p} is behind the code: npx tsx tools/api-doc.ts`);
      behind++;
    } else {
      writeFileSync(file, next);
      console.log(`✔  ${p}: the signatures written`);
    }
  }
  process.exit(behind ? 1 : 0);
}
