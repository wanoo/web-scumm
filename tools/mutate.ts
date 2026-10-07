// npm run test:mutation:core [-- --set=core|reality|all] [--file=src/engine/core/cond.ts] [--json] (4.1.0 "Clarity",
// lot G; the sets and the gate by identity since 4.1.2): mutation testing of what a save, a session, a condition and
// a migration rest on (`core`), and of what a signal from the world outside rests on (`reality`: the engine's
// receive, the protocol, the client, the Bridge, its store, its lock and its policy). Each mutant changes one thing
// in the source (a comparison flipped, `&&` for `||`, a negation dropped, a condition forced, a boolean inverted),
// the tests that judge that set run against it (vitest.mutation.config.ts, `MUTATION_SET`), and the mutant must
// make one of them fail. A mutant that survives is a missing test, or an equivalent mutant: docs/dev/mutants.json
// names each one (file, operator, from, to) with its reason, docs/dev/MUTANTS.md explains them, and any survivor
// not named there fails the run, whatever the count. The source file is restored after each mutant, and on exit. (Stryker 10 does not activate its mutants under Vitest 5 here: 739 of 749
// survived, a block emptied included; this tool runs each mutant as plain source.)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { ROOT } from './game';

export const SETS = {
  core: [
    'src/engine/core/cond.ts',
    'src/engine/core/save.ts',
    'src/engine/core/session-runtime.ts',
    'src/engine/core/migrate.ts',
  ],
  reality: [
    'src/engine/core/reality-runtime.ts',
    'src/engine/reality/protocol.ts',
    'src/engine/reality/client.ts',
    'bridge/src/bridge.ts',
    'bridge/src/store.ts',
    'bridge/src/lock.ts',
    'bridge/src/policy.ts',
  ],
};
export type MutationSet = keyof typeof SETS;
export const TARGETS = SETS.core;

/** An equivalent mutant, as docs/dev/mutants.json names it: the line may move, the edit itself may not. */
export interface KnownSurvivor {
  file: string;
  operator: string;
  from: string;
  to: string;
  why: string;
}
export const sameMutant = (a: Pick<Mutant, 'file' | 'operator' | 'from' | 'to'>, b: KnownSurvivor) =>
  a.file === b.file && a.operator === b.operator && a.from === b.from && a.to === b.to;

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

function runTests(set: MutationSet | 'all'): 'killed' | 'survived' | 'timeout' {
  try {
    execFileSync('npx', ['vitest', 'run', '--config', 'vitest.mutation.config.ts', '--bail', '1'], {
      cwd: ROOT,
      stdio: 'ignore',
      timeout: 180_000,
      env: { ...process.env, MUTATION_SET: set },
    });
    return 'survived';
  } catch (e) {
    return (e as { signal?: string }).signal === 'SIGTERM' ? 'timeout' : 'killed';
  }
}

if (process.argv[1]?.endsWith('mutate.ts')) {
  const only = process.argv.find((a) => a.startsWith('--file='))?.split('=')[1];
  const setArg = (process.argv.find((a) => a.startsWith('--set='))?.split('=')[1] ?? 'core') as MutationSet | 'all';
  const setOf = (f: string): MutationSet | 'all' =>
    (Object.keys(SETS) as MutationSet[]).find((k) => SETS[k].includes(f)) ?? 'all';
  const set: MutationSet | 'all' = only ? setOf(only) : setArg;
  const files = only ? [only] : set === 'all' ? [...SETS.core, ...SETS.reality] : SETS[set];
  const originals = new Map(files.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]));
  const restore = () => {
    for (const [f, s] of originals) writeFileSync(resolve(ROOT, f), s);
  };
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
  if (runTests(set) !== 'survived') {
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
        const status = runTests(set);
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
    resolve(out, `report-${only ? 'file' : set}.json`),
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
  // The equivalent mutants, each named in docs/dev/mutants.json (and explained in MUTANTS.md): a survivor not named
  // there fails the run, in every mode, whatever the count; a name whose mutant no longer exists is reported too.
  const known = JSON.parse(readFileSync(resolve(ROOT, 'docs/dev/mutants.json'), 'utf8')) as KnownSurvivor[];
  const survivors = results.filter((r) => r.status === 'survived');
  const unexplained = survivors.filter((r) => !known.some((k) => sameMutant(r, k)));
  const stale = known.filter((k) => files.includes(k.file) && !survivors.some((r) => sameMutant(r, k)));
  for (const r of unexplained)
    console.log(`  ✖ not in docs/dev/mutants.json: ${r.file}:${r.line} ${r.operator}: ${r.from} → ${r.to}`);
  for (const k of stale)
    console.log(`  ⚠ named in docs/dev/mutants.json but killed or gone: ${k.file} ${k.operator}: ${k.from} → ${k.to}`);
  console.log(
    `${unexplained.length ? '✖' : '✔'}  ${killed}/${results.length} mutants killed, ${survivors.length - unexplained.length} survivors explained, ${unexplained.length} not; report in .cache/mutation/report-${only ? 'file' : set}.json`,
  );
  if (unexplained.length) process.exitCode = 1;
}
