// npm run import-layout -- <file.json|dir> [--dry]
// Merges layouts exported from the placement page (or read back from the artifact db) into games/<id>/layout/<room>.json.
// Accepted shapes, per file:
//   { "layouts": { "<room>": Layout, … } }         "Export JSON" of the placement page
//   { "room": "<room>", "layout": Layout }          one db document of the `layouts` collection
//   [ { "room", "layout" } | { "id", "data": { "room", "layout" } }, … ]   a list of db documents (ArtifactData list)
//   Layout                                           "Export room": the room is the file name (<room>.json)
// Merge rule: only keys present in the export change. `hotspots`, `props`, `actors` and `entries` merge id by id
// (each exported entity replaces the stored one; the page keeps the keys it does not edit, like `states`);
// `walk`, `scale` and `floor` are replaced when present. Prints what changed. --dry prints without writing.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Layout } from '../../src/engine/core/types';
import { GAME_DIR } from '../game';
import { isMain } from './lib';

type Obj = Record<string, unknown>;
const MAPS = ['hotspots', 'props', 'actors', 'entries'] as const;

/** Extracts (room, layout) pairs from one parsed export file. */
export function layoutsFromExport(json: unknown, fileName = ''): { room: string; layout: Layout }[] {
  const out: { room: string; layout: Layout }[] = [];
  const doc = (d: any) => {
    const v = d && typeof d === 'object' && d.data && typeof d.data === 'object' ? d.data : d;
    if (v && typeof v.room === 'string' && v.layout && typeof v.layout === 'object') out.push({ room: v.room, layout: v.layout });
  };
  if (Array.isArray(json)) json.forEach(doc);
  else if (json && typeof json === 'object') {
    const o = json as any;
    if (o.layouts && typeof o.layouts === 'object' && !Array.isArray(o.layouts)) {
      for (const [room, l] of Object.entries(o.layouts)) {
        const v = l as any;
        out.push(v && v.layout && typeof v.room === 'string' ? { room: v.room, layout: v.layout } : { room, layout: v as Layout });
      }
    } else if (Array.isArray(o.docs)) o.docs.forEach(doc);
    else if (typeof o.room === 'string' && o.layout) doc(o);
    else if (fileName) out.push({ room: basename(fileName, '.json'), layout: o as Layout });
  }
  return out;
}

const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as Obj).sort().map((k) => [k, canon((v as Obj)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const short = (v: unknown) => { const s = JSON.stringify(v) ?? '—'; return s.length > 60 ? s.slice(0, 57) + '…' : s; };

/** Merges `patch` into `base` (both untouched) and lists the changes as readable lines. */
export function mergeLayout(base: Layout, patch: Layout): { layout: Layout; changes: string[] } {
  const res = structuredClone(base ?? {}) as Obj;
  const changes: string[] = [];
  for (const [key, val] of Object.entries(patch ?? {})) {
    if (val === undefined) continue;
    if ((MAPS as readonly string[]).includes(key) && val && typeof val === 'object' && !Array.isArray(val)) {
      const map = (res[key] ??= {}) as Obj;
      for (const [id, v] of Object.entries(val as Obj)) {
        const before = map[id];
        // An entity exported by the placement page is complete (it keeps the keys it does not edit), so it replaces
        // the stored one: a flag or a `z` removed on the page is removed here too.
        const after = v;
        if (same(before, after)) continue;
        map[id] = after;
        if (before === undefined) changes.push(`+ ${key}.${id} ${short(after)}`);
        else if (typeof before === 'object' && !Array.isArray(before) && after && typeof after === 'object') {
          const diffs = Object.keys({ ...(before as Obj), ...(after as Obj) })
            .filter((k) => !same((before as Obj)[k], (after as Obj)[k]))
            .map((k) => `${k} ${short((before as Obj)[k])} → ${short((after as Obj)[k])}`);
          changes.push(`~ ${key}.${id}: ${diffs.join(', ')}`);
        } else changes.push(`~ ${key}.${id}: ${short(before)} → ${short(after)}`);
      }
    } else if (!same(res[key], val)) {
      changes.push(`${res[key] === undefined ? '+' : '~'} ${key} ${short(val)}`);
      res[key] = structuredClone(val);
    }
  }
  return { layout: res as Layout, changes };
}

function readExports(target: string): { room: string; layout: Layout; from: string }[] {
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => f.endsWith('.json')).sort().map((f) => join(target, f))
    : [target];
  return files.flatMap((f) => layoutsFromExport(JSON.parse(readFileSync(f, 'utf8')), basename(f)).map((x) => ({ ...x, from: f })));
}

/** Applies every export found in `target` to `<gameDir>/layout/`. Returns the number of rooms changed. */
export function importLayouts(target: string, gameDir: string, opts: { dry?: boolean; log?: (s: string) => void } = {}): number {
  const log = opts.log ?? console.log;
  const dir = join(gameDir, 'layout');
  const exports = readExports(target);
  if (!exports.length) { log(`nothing to import in ${target}`); return 0; }
  let changed = 0;
  for (const { room, layout, from } of exports) {
    if (!/^[A-Za-z0-9_-]+$/.test(room)) { log(`skipped "${room}" (${from}): not a room id`); continue; }
    const file = join(dir, `${room}.json`);
    const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Layout : {};
    const { layout: merged, changes } = mergeLayout(base, layout);
    if (!changes.length) { log(`${room}: unchanged`); continue; }
    changed++;
    log(`${room}: ${changes.length} change(s)${existsSync(file) ? '' : ' (new file)'}${opts.dry ? ' [dry run]' : ''}`);
    for (const c of changes) log(`   ${c}`);
    if (!opts.dry) { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(merged, null, 2) + '\n'); }
  }
  return changed;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--'));
  if (!target || !existsSync(target)) {
    console.error('usage: npm run import-layout -- <file.json|dir> [--dry]');
    process.exit(1);
  }
  const n = importLayouts(resolve(target), GAME_DIR, { dry: args.includes('--dry') });
  console.log(`${n} room(s) ${args.includes('--dry') ? 'would change' : 'updated'} in ${join(GAME_DIR, 'layout')}`);
}
