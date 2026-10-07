// npx tsx tools/api-doc.ts [--check]: the signatures of the public API, read from the sources with the TypeScript
// compiler (4.1.7), written as the "Signatures" section of docs/en/API.md and docs/fr/API.md (the same block: a
// signature has no language). `--check` exits 1 when a page is behind the code; tests/api-doc.test.ts runs it.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from '@typescript/typescript6';

const ROOT = resolve(import.meta.dirname, '..');
const ENTRIES = ['content', 'player', 'minigames', 'testing', 'reality'];
const BEGIN = '<!-- api-doc:begin -->';
const END = '<!-- api-doc:end -->';

/** The first sentence of a symbol's doc comment, one line. */
const doc = (sym: ts.Symbol, checker: ts.TypeChecker): string =>
  ts
    .displayPartsToString(sym.getDocumentationComment(checker))
    .split(/\n\s*\n/)[0]!
    .replace(/\s+/g, ' ')
    .trim();

/** One line per export: its kind, name and signature (a type's shape is summarised by its member count). */
export function signatures(): string {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  const files = ENTRIES.map((e) => resolve(ROOT, 'src/engine/api', `${e}.ts`));
  const program = ts.createProgram(files, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const out: string[] = [];
  for (const [i, file] of files.entries()) {
    const sf = program.getSourceFile(file)!;
    const mod = checker.getSymbolAtLocation(sf)!;
    out.push(`### web-scumm/${ENTRIES[i]}`, '', '| Name | Signature | Doc |', '|---|---|---|');
    for (const sym of checker.getExportsOfModule(mod).sort((a, b) => a.name.localeCompare(b.name))) {
      const real = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const decl = real.declarations?.[0];
      let sig: string;
      if (real.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.Class)) {
        const t = checker.getTypeOfSymbolAtLocation(real, decl ?? sf);
        const calls = t.getCallSignatures();
        sig = calls.length
          ? calls.map((c) => checker.signatureToString(c, decl, ts.TypeFormatFlags.NoTruncation)).join(' · ')
          : real.flags & ts.SymbolFlags.Class
            ? `class ${sym.name}`
            : checker.typeToString(t, decl, ts.TypeFormatFlags.NoTruncation);
      } else {
        const t = checker.getDeclaredTypeOfSymbol(real);
        const props = t.getProperties();
        const union = t.isUnion() ? t.types.length : 0;
        sig = union
          ? `union of ${union}`
          : props.length
            ? `{ ${props
                .slice(0, 6)
                .map((p) => p.name)
                .join(', ')}${props.length > 6 ? `, … ${props.length - 6} more` : ''} }`
            : checker.typeToString(t, decl, ts.TypeFormatFlags.NoTruncation);
        sig = `type ${sig}`;
      }
      const d = doc(real, checker) || doc(sym, checker);
      out.push(
        `| \`${sym.name}\` | \`${sig.replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 160)}\` | ${d.replace(/\|/g, '\\|').slice(0, 140)} |`,
      );
    }
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
  const block = signatures();
  let behind = 0;
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
