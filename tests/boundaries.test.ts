// The engine's layers (3.9, src/engine/BOUNDARIES.md): what each folder may import, checked on the sources, so the
// player never carries the solver, the validator or the Studio, and the core runs anywhere (Node, a worker, tests).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve('src/engine');
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(e) ? [p] : [];
  });

/** Each import of a file: where it points (relative to src/engine, or the package name) and whether it is `import()`. */
function imports(file: string): { to: string; dynamic: boolean }[] {
  const code = readFileSync(file, 'utf8');
  const out: { to: string; dynamic: boolean }[] = [];
  for (const m of code.matchAll(
    /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g,
  )) {
    const spec = m[1] ?? m[2] ?? m[3];
    const to = spec.startsWith('.')
      ? relative(ROOT, resolve(dirname(file), spec))
          .split('\\')
          .join('/')
      : spec;
    out.push({ to, dynamic: !!m[3] });
  }
  return out;
}

const layer = (dir: string) => files(join(ROOT, dir)).map((f) => ({ file: relative(ROOT, f), deps: imports(f) }));
const offenders = (fs: ReturnType<typeof layer>, bad: (to: string, dynamic: boolean) => boolean) =>
  fs.flatMap((f) =>
    f.deps.filter((d) => bad(d.to, d.dynamic)).map((d) => `${f.file} → ${d.to}${d.dynamic ? ' (import())' : ''}`),
  );

describe("the engine's layers", () => {
  it('reads the imports it checks (a static one, a dynamic one)', () => {
    const app = imports(join(ROOT, 'dom/app.ts'));
    expect(app).toContainEqual({ to: 'core/engine', dynamic: false });
    expect(app).toContainEqual({ to: 'tools/replay', dynamic: true });
  });

  it('core imports nothing but core and plain packages: no DOM, no tools, no dev, no minigames', () => {
    expect(
      offenders(
        layer('core'),
        (to) => /^(dom|tools|dev|minigames|ending|studio)(\/|$)/.test(to) || to.includes('src/studio'),
      ),
    ).toEqual([]);
  });

  it('the player (dom, minigames, ending, boot) never imports the solver, the validator, the tools or the Studio statically', () => {
    const player = [
      ...layer('dom'),
      ...layer('minigames'),
      ...layer('ending'),
      { file: 'boot.ts', deps: imports(join(ROOT, 'boot.ts')) },
    ];
    // On demand is allowed: the dev panel, a session export. The locales' applier runs at boot (tools/i18n, small).
    const allowed = new Set(['tools/i18n']);
    expect(
      offenders(
        player,
        (to, dynamic) =>
          (/^(tools|dev)(\/|$)/.test(to) && !dynamic && !allowed.has(to)) ||
          /^tools\/(solve|validate|lint|audit)/.test(to) ||
          /studio/.test(to) ||
          /tweakpane/.test(to),
      ),
    ).toEqual([]);
  });

  it('the tools run without a browser: they never import the DOM layer', () => {
    expect(offenders(layer('tools'), (to) => /^dom(\/|$)/.test(to))).toEqual([]);
  });

  it('no module imports itself back through a cycle of static imports (4.1.0): a layer reads top to bottom', () => {
    // Types only (`import type`) are erased and not counted; `import()` is not static.
    const all = files(ROOT).map((f) => relative(ROOT, f).replace(/\.tsx?$/, ''));
    const known = new Set(all);
    const graph = new Map(
      all.map((f) => [
        f,
        imports(join(ROOT, `${f}.ts`))
          .filter((d) => !d.dynamic)
          .map((d) => (known.has(d.to) ? d.to : known.has(`${d.to}/index`) ? `${d.to}/index` : null))
          .filter((d): d is string => !!d),
      ]),
    );
    const cycles: string[] = [];
    const state = new Map<string, 'open' | 'done'>();
    const stack: string[] = [];
    const visit = (f: string) => {
      state.set(f, 'open');
      stack.push(f);
      for (const d of graph.get(f) ?? []) {
        if (state.get(d) === 'open') cycles.push([...stack.slice(stack.indexOf(d)), d].join(' → '));
        else if (!state.has(d)) visit(d);
      }
      stack.pop();
      state.set(f, 'done');
    };
    for (const f of all) if (!state.has(f)) visit(f);
    expect(cycles).toEqual([]);
  });
});
