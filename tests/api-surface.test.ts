// The public API (4.0): the names each entry of src/engine/api exports. A change to them is a change to the contract:
// update tests/api-surface.json, docs/en/API.md (every public name is documented there) and the CHANGELOG ("API"),
// and follow docs/en/SUPPORT.md (a removal waits for the next major).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../tools/studio/tools';

const API = resolve('src/engine/api');
const own = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^export (?:declare )?(?:async )?(?:interface|type|const|function|class|enum) (\w+)/gm)].map((m) => m[1]);

/** The names a module exports, following `export … from` and `export type * from`. */
function surface(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const names = new Set<string>(own(file));
  for (const m of code.matchAll(/export (?:type )?\{([^}]+)\} from '([^']+)'/g)) for (const n of m[1].split(',')) { const k = n.trim().replace(/^type /, '').split(/\s+as\s+/).pop()!; if (k) names.add(k); }
  for (const m of code.matchAll(/export (?:type )?\* from '([^']+)'/g)) for (const n of own(join(dirname(file), `${m[1]}.ts`))) names.add(n);
  return [...names].sort();
}

const entries = readdirSync(API).filter((f) => f.endsWith('.ts')).sort();
const now = Object.fromEntries(entries.map((f) => [f.replace(/\.ts$/, ''), surface(join(API, f))]));

describe('the public API', () => {
  it('exports what tests/api-surface.json says, entry by entry', () => {
    const { mcp: _, ...modules } = JSON.parse(readFileSync('tests/api-surface.json', 'utf8'));
    expect(now).toEqual(modules);
  });

  it('documents every public name in docs/en/API.md and docs/fr/API.md', () => {
    for (const doc of ['docs/en/API.md', 'docs/fr/API.md']) {
      const md = readFileSync(doc, 'utf8');
      const missing = Object.entries(now).flatMap(([e, names]) => names.filter((n) => !md.includes(`\`${n}\``)).map((n) => `${e}: ${n}`));
      expect(missing, doc).toEqual([]);
    }
  });

  it('the Studio/MCP tools: names, required and optional arguments (tests/api-surface.json → mcp)', () => {
    const mcp = Object.fromEntries(TOOLS.map((t) => {
      const args = Object.entries(t.input);
      const req = args.filter(([, z]) => !(z as unknown as { safeParse(v: unknown): { success: boolean } }).safeParse(undefined).success).map(([k]) => k).sort();
      return [t.name, { required: req, optional: args.map(([k]) => k).filter((k) => !req.includes(k)).sort() }];
    }));
    expect(mcp).toEqual(JSON.parse(readFileSync('tests/api-surface.json', 'utf8')).mcp);
  });

  it('the template uses the public API only', () => {
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? files(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : []);
    const internal = files('games/_template').filter((f) => /from '@engine\//.test(readFileSync(f, 'utf8')));
    expect(internal).toEqual([]);
  });
});
