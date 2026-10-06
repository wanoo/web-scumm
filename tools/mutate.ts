// npm run test:mutation:core [-- --file=src/engine/core/cond.ts] [--json] (4.1.0 "Clarity", lot G): mutation testing
// of what a save, a session, a condition and a migration rest on. Each mutant changes one thing in the source (a
// comparison flipped, `&&` for `||`, a negation dropped, a condition forced, a boolean inverted), the tests that judge
// the critical core run against it (vitest.mutation.config.ts), and the mutant must make one of them fail. A mutant
// that survives is a missing test, or an equivalent mutant explained in docs/dev/MUTANTS.md. The source file is
// restored after each mutant, and on exit. (Stryker 10 does not activate its mutants under Vitest 5 here: 739 of 749
// survived, a block emptied included; this tool runs each mutant as plain source.)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { ROOT } from './game';

export const TARGETS = [
  'src/engine/core/cond.ts',
  'src/engine/core/save.ts',
  'src/engine/core/session-runtime.ts',
  'src/engine/core/migrate.ts',
];

export interface Mutant {
  file: string;
  line: number;
  operator: string;
  from: string;
  to: string;
  start: number;
  end: number;
}

const SWAP: Partial<Record<ts.SyntaxKind, [ts.SyntaxKind, string]>> = {
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: [ts.SyntaxKind.ExclamationEqualsEqualsToken, '!=='],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: [ts.SyntaxKind.EqualsEqualsEqualsToken, '==='],
  [ts.SyntaxKind.LessThanToken]: [ts.SyntaxKind.LessThanEqualsToken, '<='],
  [ts.SyntaxKind.LessThanEqualsToken]: [ts.SyntaxKind.LessThanToken, '<'],
  [ts.SyntaxKind.GreaterThanToken]: [ts.SyntaxKind.GreaterThanEqualsToken, '>='],
  [ts.SyntaxKind.GreaterThanEqualsToken]: [ts.SyntaxKind.GreaterThanToken, '>'],
  [ts.SyntaxKind.AmpersandAmpersandToken]: [ts.SyntaxKind.BarBarToken, '||'],
  [ts.SyntaxKind.BarBarToken]: [ts.SyntaxKind.AmpersandAmpersandToken, '&&'],
  [ts.SyntaxKind.PlusToken]: [ts.SyntaxKind.MinusToken, '-'],
  [ts.SyntaxKind.MinusToken]: [ts.SyntaxKind.PlusToken, '+'],
};

/** Every mutant of a source file, in order. Pure: reads the text, returns the edits. */
export function mutants(file: string, src: string): Mutant[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const out: Mutant[] = [];
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const add = (operator: string, node: ts.Node, to: string, start = node.getStart(sf), end = node.getEnd()) =>
    out.push({ file, line: line(start), operator, from: src.slice(start, end), to, start, end });
  const visit = (n: ts.Node) => {
    // Types, imports and comments carry no behaviour.
    if (ts.isTypeNode(n) || ts.isImportDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n))
      return;
    if (ts.isBinaryExpression(n)) {
      const swap = SWAP[n.operatorToken.kind];
      if (swap) add('operator', n.operatorToken, swap[1]);
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken)
      add('negation', n, n.operand.getText(sf));
    if (n.kind === ts.SyntaxKind.TrueKeyword) add('boolean', n, 'false');
    if (n.kind === ts.SyntaxKind.FalseKeyword) add('boolean', n, 'true');
    if (ts.isIfStatement(n) || ts.isConditionalExpression(n)) {
      const c = ts.isIfStatement(n) ? n.expression : n.condition;
      add('condition true', c, 'true');
      add('condition false', c, 'false');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

export const apply = (src: string, m: Mutant) => src.slice(0, m.start) + m.to + src.slice(m.end);

function runTests(): 'killed' | 'survived' | 'timeout' {
  try {
    execFileSync('npx', ['vitest', 'run', '--config', 'vitest.mutation.config.ts', '--bail', '1'], {
      cwd: ROOT,
      stdio: 'ignore',
      timeout: 120_000,
    });
    return 'survived';
  } catch (e) {
    return (e as { signal?: string }).signal === 'SIGTERM' ? 'timeout' : 'killed';
  }
}

if (process.argv[1]?.endsWith('mutate.ts')) {
  const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
  const files = only ? [only] : TARGETS;
  const originals = new Map(files.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]));
  const restore = () => {
    for (const [f, s] of originals) writeFileSync(resolve(ROOT, f), s);
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
  if (runTests() !== 'survived') {
    console.error('✖  the tests fail before any mutation: fix them first');
    process.exit(2);
  }
  const results: (Mutant & { status: string })[] = [];
  try {
    for (const f of files) {
      const src = originals.get(f)!;
      const ms = mutants(f, src);
      console.log(`${f}: ${ms.length} mutants`);
      for (const m of ms) {
        writeFileSync(resolve(ROOT, f), apply(src, m));
        const status = runTests();
        results.push({ ...m, status });
        if (status === 'survived') console.log(`  survived ${f}:${m.line} ${m.operator}: ${m.from} → ${m.to}`);
      }
      writeFileSync(resolve(ROOT, f), src);
    }
  } finally {
    restore();
  }
  const killed = results.filter((r) => r.status !== 'survived').length;
  const out = resolve(ROOT, '.cache/mutation');
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  writeFileSync(
    resolve(out, 'report.json'),
    JSON.stringify(
      results.map(({ start, end, ...r }) => r),
      null,
      1,
    ),
  );
  for (const f of files) {
    const rs = results.filter((r) => r.file === f);
    const k = rs.filter((r) => r.status !== 'survived').length;
    console.log(`  ${f}: ${k}/${rs.length} killed (${rs.length ? ((100 * k) / rs.length).toFixed(1) : '100'}%)`);
  }
  // The equivalent mutants, explained in docs/dev/MUTANTS.md: a survivor not listed there fails the run.
  const known = readFileSync(resolve(ROOT, 'docs/dev/MUTANTS.md'), 'utf8');
  const KILLED_AT_LAST_REVIEW = Number(
    /\*\*(\d+) of \d+\s+mutants killed\*\*/.exec(known.replace(/\n/g, ' '))?.[1] ?? 'NaN',
  );
  const expectedSurvivors = only ? undefined : results.length - KILLED_AT_LAST_REVIEW;
  const unexplained = expectedSurvivors !== undefined && results.length - killed > expectedSurvivors;
  console.log(
    `${unexplained ? '✖' : '✔'}  ${killed}/${results.length} mutants killed${expectedSurvivors !== undefined ? ` (docs/dev/MUTANTS.md explains ${expectedSurvivors})` : ''}; report in .cache/mutation/report.json`,
  );
  if (unexplained) process.exitCode = 1;
}
