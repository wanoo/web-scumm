// The Studio's Assets tab, server side (docs/en/STUDIO.md, "Assets tab"): every image and sound of the game with where
// it is used, the art prompts per sheet, and the uploads (a generated sheet cut by tools/cut-sheet.py, one cell, a
// decor, a sound), never deleting anything: a replaced file is first kept as `<name>_v<N>.<ext>` next to it.
// `assetsMiddleware` is mounted by the dev server at /__studio/api/assets (tools/studio/plugin.ts).
import { spawn } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { GameDef } from '../../src/engine/core/types';
import { imageSource } from '../pages/lib';
import { buildPrompts } from '../prompts';
import { collectRefs } from '../refs';
import { StudioError, type Studio } from './core';
import type {
  AssetCell, AssetDecor, AssetPrompt, AssetSheet, AssetSheetKind, AssetSound, AssetsListing, CellReplace, CellReplaceResult, DecorUpload,
  PrepareResult, SheetUpload, SheetUploadResult, SoundUpload, UploadResult,
} from './types';

const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const AUDIO_EXT = ['.ogg', '.mp3', '.wav', '.m4a', '.flac', '.aac', '.opus', '.webm'];
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.opus': 'audio/ogg', '.webm': 'audio/webm', '.mp4': 'video/mp4',
};
const BACKUP = /_v\d+$/;
const SHEET_ID = /^[A-Za-z0-9][\w-]*$/;
const CELL_ID = /^[\w-]+(\/[\w-]+)*$/;
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const uniq = <T>(a: T[]) => [...new Set(a)];
const stem = (f: string) => f.slice(0, f.length - extname(f).length);

// ------------------------------------------------------------------ small file helpers

/** Pixel size from the file header (PNG, JPEG, WebP, GIF); [0, 0] when unknown. */
export function imageSize(file: string): [number, number] {
  let b: Buffer;
  try { b = readFileSync(file); } catch { return [0, 0]; }
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return [0, 0];
}

/** The image type of uploaded bytes, from their magic number. */
function imageType(b: Buffer): '.png' | '.jpg' | '.webp' | null {
  if (b.length > 8 && b.readUInt32BE(0) === 0x89504e47) return '.png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

/** Base64 (a data URL is accepted) → bytes. */
function decode(data: unknown): Buffer {
  if (typeof data !== 'string' || !data) throw new StudioError('`data` (base64) is required');
  const b = Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64');
  if (!b.length) throw new StudioError('`data` is empty or not base64');
  return b;
}

const mtime = (f: string) => { try { return Math.round(statSync(f).mtimeMs); } catch { return 0; } };
const fresh = (src: string, dst: string) => existsSync(dst) && mtime(dst) >= mtime(src);

/** `<stem>_v1.<ext>`… next to a file, in version order. */
function backupsOf(file: string): string[] {
  const dir = dirname(file);
  if (!existsSync(dir)) return [];
  const base = stem(file.slice(dir.length + 1));
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_v(\\d+)\\.\\w+$`);
  return readdirSync(dir).filter((f) => re.test(f)).sort(natural).map((f) => join(dir, f));
}

/** Copies `file` to the next free `<stem>_v<N><ext>` and returns that path. */
function backup(file: string): string {
  const n = Math.max(0, ...backupsOf(file).map((f) => Number(/_v(\d+)\.\w+$/.exec(f)![1]))) + 1;
  const to = join(dirname(file), `${stem(file.slice(dirname(file).length + 1))}_v${n}${extname(file)}`);
  copyFileSync(file, to);
  return to;
}

/** Image files under a folder, relative (talk kits nest one folder per pose), without hidden, `_` and backup files. */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir).sort(natural)) {
    if (f.startsWith('.') || f.startsWith('_')) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, `${prefix}${f}/`));
    else if (IMG_EXT.includes(extname(f).toLowerCase()) && !BACKUP.test(stem(f))) out.push(prefix + f);
  }
  return out;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, onData?: (s: string) => void): Promise<{ code: number; output: string }> {
  return new Promise((ok) => {
    let output = '';
    const p = spawn(cmd, args, { cwd, env });
    const on = (c: Buffer) => { const s = c.toString('utf8'); output += s; onData?.(s); };
    p.stdout.on('data', on);
    p.stderr.on('data', on);
    p.on('error', (e) => { output += `${e.message}\n`; onData?.(`${e.message}\n`); ok({ code: 127, output }); });
    p.on('close', (code) => ok({ code: code ?? 1, output }));
  });
}

// ------------------------------------------------------------------ where each image and sound is used

type Seg = string | number;
/** Command-list keys, left out of a "where" (`rules.on`, not `rules.on.do`). */
const CMD_LISTS = new Set(['do', 'then', 'else', 'once', 'cutscene', 'after']);

/** A short "where": `cast.grandpa.walk`, `items.key`, `house.props.pantry`, `house.minigame.pipes`, `skin.map`… */
function where(game: GameDef, segs: Seg[], minigame?: string): string {
  const s = segs.filter((x): x is string => typeof x === 'string');
  if (segs[0] === 'rooms' && typeof segs[1] === 'number') {
    const room = game.rooms[segs[1]]?.id ?? String(segs[1]);
    const rest = segs.slice(2);
    if (rest[0] === 'props' || rest[0] === 'actors' || rest[0] === 'hotspots') return `${room}.${rest[0]}.${rest[1]}`;
    if (minigame) return `${room}.minigame.${minigame}`;
    return `${room}.${String(rest[0] ?? 'room')}`;
  }
  if (segs[0] === 'characters') {
    const [, cid, k, a, b] = segs;
    if (k === 'sprites') return `cast.${cid}.${a}`;
    if (k === 'mouths') return `cast.${cid}.mouths.${a}`;
    if (k === 'variants') return `cast.${cid}.variant${Number(a) + 1}.${b === 'sprites' || b === 'mouths' ? `${b === 'mouths' ? 'mouths.' : ''}${segs[5]}` : String(b)}`;
    return `cast.${cid}.${String(k)}`;
  }
  if (segs[0] === 'items') return `items.${segs[1]}`;
  if (segs[0] === 'skin') return `skin.${s[s.length - 1]}`;
  if (minigame) return `${s[0]}.minigame.${minigame}`;
  return s.filter((x) => !CMD_LISTS.has(x)).slice(0, segs[0] === 'map' ? 3 : 2).join('.');
}

/** Image id → where it is used; sound `<kind>:<id>` → the places that play it. One walk over the game's data. */
function usage(game: GameDef, images: Set<string>, extra: string[], sfx: Set<string>, music: Set<string>) {
  const img = new Map<string, string[]>();
  const snd = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, w: string) => { const l = m.get(k) ?? []; if (!l.includes(w)) l.push(w); m.set(k, l); };
  const visit = (v: unknown, segs: Seg[], mg: string | undefined, key: string | undefined) => {
    if (typeof v === 'string') {
      if (images.has(v)) add(img, v, where(game, segs, mg));
      if (key === 'sfx' && sfx.has(v)) add(snd, `sfx:${v}`, where(game, segs, mg));
      if (key === 'music' && music.has(v) && segs[0] !== 'skin') add(snd, `music:${v}`, where(game, segs, mg));
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => visit(x, [...segs, i], mg, key)); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const here = typeof o.minigame === 'string' ? o.minigame : mg;
    for (const [k, x] of Object.entries(o)) {
      if (segs.length === 0 && k === 'audio') continue;
      // { music: { push: id } } and { music: { once: id } } play `id` too.
      visit(x, [...segs, k], here, k === 'push' || k === 'once' ? key : k);
    }
  };
  visit(game, [], undefined, undefined);
  for (const id of extra) if (images.has(id)) add(img, id, 'extraImages');
  return { img, snd };
}

// ------------------------------------------------------------------ prompts, split per sheet

/** The section of `npm run prompts` whose heading names this sheet (`#### Base sheet \`hero\``, `### Objects \`items\``…). */
function section(md: string, id: string): string | undefined {
  const lines = md.split('\n');
  const tag = `\`${id}\``;
  let at = -1;
  let level = 0;
  for (const want of [4, 3]) {
    at = lines.findIndex((l) => l.startsWith(`${'#'.repeat(want)} `) && l.includes(tag));
    if (at >= 0) { level = want; break; }
  }
  if (at < 0) return undefined;
  let end = at + 1;
  const stop = new RegExp(`^#{1,${level}} `);
  while (end < lines.length && !stop.test(lines[end])) end++;
  return lines.slice(at, end).join('\n').trim();
}

function styleBlock(md: string): string {
  const i = md.indexOf('## Style block');
  if (i < 0) return '';
  const j = md.indexOf('\n## ', i + 3);
  return md.slice(i, j < 0 ? undefined : j).trim();
}

const gridOf = (markdown: string | undefined) => {
  const m = markdown && /\((\d+) × (\d+)/.exec(markdown.split('\n')[0]);
  return m ? `${m[1]}x${m[2]}` : undefined;
};

// ------------------------------------------------------------------ the assets of one game

export function createAssets(studio: Studio) {
  const dir = studio.gameDir;
  const root = studio.root;
  const artDir = join(dir, 'art');
  const audioDir = join(dir, 'audio');
  const pub = join(root, 'public', 'assets');
  const rel = (f: string) => relative(dir, f).split(sep).join('/');

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  };

  /** The source file of an image id (tools/pages/lib.ts rules, as tools/assets.py), never the prepared copy. */
  const sourceOf = (id: string) => {
    const f = imageSource(dir, id);
    return f && !resolve(f).startsWith(pub + sep) ? resolve(f) : undefined;
  };

  async function list(): Promise<AssetsListing> {
    const mod = await studio.loadGame();
    const game = mod.game;
    const refs = collectRefs(mod);
    const sfxIds = new Set(Object.keys(refs.audio.sfx));
    const musicIds = new Set(Object.keys(refs.audio.music));
    const { img, snd } = usage(game, new Set(refs.images), mod.extraImages ?? [], sfxIds, musicIds);

    const byFile = new Map<string, string[]>();
    const missing: string[] = [];
    for (const id of refs.images) {
      const f = sourceOf(id);
      if (!f) { missing.push(id); continue; }
      byFile.set(f, [...(byFile.get(f) ?? []), id]);
    }
    let unprepared = 0;
    const cellOf = (file: string, id: string): AssetCell => {
      const ids = byFile.get(file) ?? [];
      const used = uniq(ids.flatMap((x) => img.get(x) ?? ['content']));
      const asset = ids.map((x) => `img/${x}.webp`).find((x) => existsSync(join(pub, x)));
      const prepared = ids.length > 0 && ids.every((x) => fresh(file, join(pub, `img/${x}.webp`)));
      if (ids.length && !prepared) unprepared++;
      const [w, h] = imageSize(file);
      return { id, file: rel(file), w, h, used, ids, prepared, asset, backups: backupsOf(file).map(rel), mtime: mtime(file) };
    };
    const missingCell = (id: string, imageId: string): AssetCell =>
      ({ id, file: '', w: 0, h: 0, used: img.get(imageId) ?? [], ids: [imageId], prepared: false, backups: [], mtime: 0, missing: true });

    // Prompts: the whole document, and the missing-only one for the sheets that lack cells.
    const opts = { gameId: studio.gameId, gameDir: dir, root };
    const full = buildPrompts(mod, opts);
    const only = full.missing.length ? buildPrompts(mod, { ...opts, missing: true }) : null;
    const prompts = full.sheets.map((p): AssetPrompt | null => {
      const markdown = section(full.markdown, p.id);
      const missingMarkdown = p.missing.length && only ? section(only.markdown, p.id) : undefined;
      return markdown ? { id: p.id, kind: p.kind, markdown, ...(missingMarkdown ? { missingMarkdown } : {}) } : null;
    }).filter((x): x is AssetPrompt => !!x);
    const promptOf = new Map(full.sheets.map((p) => [p.id, p]));

    // Sheets: folders of art/ (decor apart), plus the ones only the game or the prompts know (nothing cut yet).
    const sheets = new Map<string, AssetSheet>();
    const kindOf = (id: string): AssetSheetKind => (id.startsWith('talk_') ? 'talk' : id.startsWith('furniture_') ? 'furniture' : 'sprites');
    const sheet = (id: string) => {
      let s = sheets.get(id);
      if (!s) { s = { id, kind: kindOf(id), grid: '', cells: [] }; sheets.set(id, s); }
      return s;
    };
    if (existsSync(artDir)) {
      for (const d of readdirSync(artDir).sort(natural)) {
        if (d.startsWith('.') || d.startsWith('_') || d === 'decor' || !statSync(join(artDir, d)).isDirectory()) continue;
        const s = sheet(d);
        for (const f of walk(join(artDir, d))) s.cells.push(cellOf(resolve(artDir, d, f), stem(f)));
      }
    }
    for (const id of missing) {
      if (id.startsWith('decor/')) continue;
      const i = id.indexOf('/');
      sheet(id.slice(0, i)).cells.push(missingCell(id.slice(i + 1), id));
    }
    for (const p of full.sheets) if (p.kind !== 'background' && p.kind !== 'other' && !p.id.startsWith('decor/')) sheet(p.id);
    for (const s of sheets.values()) {
      s.cells.sort((a, b) => natural(a.id, b.id));
      const p = promptOf.get(s.id);
      if (p) s.promptKind = p.kind;
      const owners = s.cells.flatMap((c) => c.used).map((u) => /^cast\.([^.]+)\./.exec(u)?.[1]).filter((x): x is string => !!x);
      const top = Object.entries(owners.reduce<Record<string, number>>((n, c) => ({ ...n, [c]: (n[c] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
      if (top) s.character = top[0];
      const md = prompts.find((x) => x.id === s.id)?.markdown;
      const rc = s.cells.map((c) => /^r(\d+)c(\d+)$/.exec(c.id)).filter((m): m is RegExpExecArray => !!m);
      s.grid = gridOf(md) ?? (rc.length ? `${Math.max(6, ...rc.map((m) => +m[2]))}x${Math.max(4, ...rc.map((m) => +m[1]))}` : '6x4');
    }
    // New pose sheets (`<base>_poses`) belong to the base sheet's character.
    for (const s of sheets.values()) if (!s.character && s.promptKind === 'poses') s.character = sheets.get(s.id.replace(/_poses$/, ''))?.character;

    // Decors: art/decor/<name>.{png,jpg} and the decor ids the game references.
    const decors: AssetDecor[] = [];
    const decorDir = join(artDir, 'decor');
    const roomsOf = (id: string) => game.rooms.filter((r) => r.decor === id).map((r) => r.id);
    const seen = new Set<string>();
    if (existsSync(decorDir)) {
      for (const f of readdirSync(decorDir).sort(natural)) {
        if (f.startsWith('.') || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(f).toLowerCase()) || BACKUP.test(stem(f))) continue;
        const name = `decor/${stem(f)}`;
        if (seen.has(name)) continue;
        // The file tools/assets.py takes (a .png before a .jpg) when both exist.
        const file = sourceOf(name) ?? resolve(decorDir, f);
        seen.add(name);
        const c = cellOf(file, stem(f));
        decors.push({ ...c, name, rooms: roomsOf(name) });
      }
    }
    for (const id of missing) if (id.startsWith('decor/') && !seen.has(id)) decors.push({ ...missingCell(id.slice(6), id), name: id, rooms: roomsOf(id) });

    // Sounds: files of audio/<kind>/ and the ids of audio.<kind> they provide (an .mp3 asked can come from an .ogg).
    const sounds: AssetsListing['sounds'] = { music: [], sfx: [] };
    for (const kind of ['music', 'sfx'] as const) {
      const table = refs.audio[kind];
      const kdir = join(audioDir, kind);
      const files = existsSync(kdir) ? readdirSync(kdir).filter((f) => !f.startsWith('.') && AUDIO_EXT.includes(extname(f).toLowerCase()) && !BACKUP.test(stem(f))).sort(natural) : [];
      const has = (f: string) => files.includes(f);
      const provider = (req: string) => (has(req) ? req : req.endsWith('.mp3') && has(`${req.slice(0, -4)}.ogg`) ? `${req.slice(0, -4)}.ogg` : undefined);
      for (const [id, req] of Object.entries(table)) if (!provider(req) && !existsSync(join(pub, 'audio', kind, req))) missing.push(`audio/${kind}/${req}`);
      for (const f of files) {
        const ids = Object.entries(table).filter(([, req]) => provider(req) === f);
        const src = join(kdir, f);
        const asset = ids.map(([, req]) => `audio/${kind}/${req}`).find((x) => existsSync(join(pub, x)));
        const prepared = ids.length > 0 && ids.every(([, req]) => fresh(src, join(pub, 'audio', kind, req)));
        if (ids.length && !prepared) unprepared++;
        sounds[kind].push({
          id: f, kind, file: rel(src), prepared, asset, mtime: mtime(src), backups: backupsOf(src).map(rel),
          used: uniq(ids.flatMap(([id]) => [`audio.${kind}.${id}`, ...(snd.get(`${kind}:${id}`) ?? [])])),
        });
      }
    }

    return {
      sheets: [...sheets.values()].sort((a, b) => natural(a.id, b.id)),
      decors, sounds, missing, unprepared,
      prompts: { sheets: prompts, style: styleBlock(full.markdown) },
    };
  }

  async function prompts(missing: boolean): Promise<{ markdown: string }> {
    const mod = await studio.loadGame();
    return { markdown: buildPrompts(mod, { gameId: studio.gameId, gameDir: dir, root, missing }).markdown };
  }

  /** A source file of art/ or audio/ by its path relative to the game folder, or null. */
  function filePath(path: string): string | null {
    let p: string;
    try { p = decodeURIComponent(path); } catch { return null; }
    if (!/^(art|audio)\/[\w./ -]+$/.test(p) || p.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
    const f = resolve(dir, p);
    if (!f.startsWith(artDir + sep) && !f.startsWith(audioDir + sep)) return null;
    try { return statSync(f).isFile() ? f : null; } catch { return null; }
  }

  async function cellEntry(sheetId: string, cell: string): Promise<AssetCell> {
    const l = await list();
    const c = l.sheets.find((s) => s.id === sheetId)?.cells.find((x) => x.id === cell);
    if (!c) throw new StudioError(`no cell "${sheetId}/${cell}" after the write`, 500);
    return c;
  }

  // ---------------------------------------------------------------- uploads

  function uploadSheet(b: SheetUpload): Promise<SheetUploadResult> {
    return serial(async () => {
      if (!b || typeof b.sheetId !== 'string' || !SHEET_ID.test(b.sheetId) || b.sheetId === 'decor') throw new StudioError('`sheetId` must be letters, digits, _ and - (not "decor")');
      const grid = b.grid ?? '6x4';
      const g = /^(\d{1,2})x(\d{1,2})$/i.exec(grid);
      if (!g || +g[1] < 1 || +g[2] < 1) throw new StudioError('`grid` must be COLSxROWS, e.g. 6x4');
      const [cols, rows] = [+g[1], +g[2]];
      let only: string[] | undefined;
      if (b.cells !== undefined && b.cells !== '') {
        if (typeof b.cells !== 'string') throw new StudioError('`cells` must be a list like r1c1,r2c3');
        only = uniq(b.cells.split(',').map((x) => x.trim()).filter(Boolean));
        for (const c of only) {
          const m = /^r(\d+)c(\d+)$/.exec(c);
          if (!m || +m[1] < 1 || +m[1] > rows || +m[2] < 1 || +m[2] > cols) throw new StudioError(`not a cell of a ${grid} grid: "${c}"`);
        }
        if (!only.length) throw new StudioError('`cells` is empty');
      }
      const data = decode(b.data);
      const type = imageType(data);
      if (!type) throw new StudioError('the sheet must be a PNG, JPEG or WebP image');
      const out = join(artDir, b.sheetId);
      const targets = only ?? Array.from({ length: rows * cols }, (_, i) => `r${Math.floor(i / cols) + 1}c${(i % cols) + 1}`);
      const existing = targets.filter((c) => existsSync(join(out, `${c}.png`)));
      // Validated sprites are never recut by accident: overwriting needs the cells named.
      if (!only && existing.length) {
        throw Object.assign(new StudioError(`${existing.length} cell(s) of "${b.sheetId}" already exist: name the cells to recut (cells), or upload into a new sheet id`, 409),
          { body: { conflicts: existing } });
      }
      const sheetsDir = join(dir, 'private', 'sheets');
      mkdirSync(sheetsDir, { recursive: true });
      const file = join(sheetsDir, `${b.sheetId}-${new Date().toISOString().replace(/[:.]/g, '-')}${type}`);
      writeFileSync(file, data);
      const backups = existing.map((c) => rel(backup(join(out, `${c}.png`))));
      const args = [join(root, 'tools', 'cut-sheet.py'), file, b.sheetId, '--grid', `${cols}x${rows}`, '--out', artDir, ...(only ? ['--cells', only.join(',')] : [])];
      const r = await run('python3', args, root, { ...process.env, GAME: studio.gameId });
      if (r.code !== 0) throw new StudioError(`cut-sheet.py failed (${r.code}): ${r.output.trim().split('\n').slice(-3).join(' ')}`, 500);
      const l = await list();
      return { ok: true as const, file: relative(root, file), output: r.output.trim(), written: targets, backups, cells: l.sheets.find((s) => s.id === b.sheetId)?.cells ?? [] };
    });
  }

  function replaceCell(b: CellReplace): Promise<CellReplaceResult> {
    return serial(async () => {
      if (!b || typeof b.sheetId !== 'string' || !SHEET_ID.test(b.sheetId) || b.sheetId === 'decor') throw new StudioError('`sheetId` must be a sheet of art/ (not decor)');
      if (typeof b.cell !== 'string' || !CELL_ID.test(b.cell)) throw new StudioError('`cell` must be like r1c2, or pose/t1 in a talk kit');
      const key = b.key ?? 'auto';
      if (!['auto', 'always', 'never'].includes(key)) throw new StudioError('`key` must be auto, always or never');
      const data = decode(b.data);
      const type = imageType(data);
      if (!type) throw new StudioError('the cell must be a PNG, JPEG or WebP image');
      const target = join(artDir, b.sheetId, `${b.cell}.png`);
      const tmpDir = join(root, '.cache', 'studio');
      mkdirSync(tmpDir, { recursive: true });
      const tmp = join(tmpDir, `upload-${process.pid}-${Date.now()}${type}`);
      writeFileSync(tmp, data);
      try {
        mkdirSync(dirname(target), { recursive: true });
        const kept = existsSync(target) ? rel(backup(target)) : undefined;
        const r = await run('python3', ['-c', KEY_PY, join(root, 'tools', 'cut-sheet.py'), tmp, target, key, artDir], root, { ...process.env, GAME: studio.gameId });
        const keyed = r.output.trim().split('\n').pop() as CellReplaceResult['keyed'];
        if (r.code !== 0 || !['keyed', 'kept', 'opaque'].includes(keyed)) throw new StudioError(`keying failed (${r.code}): ${r.output.trim().split('\n').slice(-3).join(' ')}`, 500);
        return { ok: true as const, file: rel(target), ...(kept ? { backup: kept } : {}), keyed, cell: await cellEntry(b.sheetId, b.cell) };
      } finally {
        try { unlinkSync(tmp); } catch { /* already gone */ }
      }
    });
  }

  function uploadSound(b: SoundUpload): Promise<UploadResult> {
    return serial(() => {
      if (!b || (b.kind !== 'music' && b.kind !== 'sfx')) throw new StudioError('`kind` must be music or sfx');
      if (typeof b.file !== 'string' || !/^[\w][\w.-]*$/.test(b.file) || !AUDIO_EXT.includes(extname(b.file).toLowerCase())) {
        throw new StudioError(`\`file\` must be a plain file name ending in ${AUDIO_EXT.join(', ')}`);
      }
      const data = decode(b.data);
      const target = join(audioDir, b.kind, b.file);
      mkdirSync(dirname(target), { recursive: true });
      const kept = existsSync(target) ? rel(backup(target)) : undefined;
      writeFileSync(target, data);
      return { ok: true as const, file: rel(target), ...(kept ? { backup: kept } : {}) };
    });
  }

  function uploadDecor(b: DecorUpload): Promise<UploadResult> {
    return serial(() => {
      if (!b || typeof b.name !== 'string' || !/^[\w-]+$/.test(b.name) || BACKUP.test(b.name)) throw new StudioError('`name` must be letters, digits, _ and -');
      const data = decode(b.data);
      const type = imageType(data);
      if (type !== '.png' && type !== '.jpg') throw new StudioError('a decor must be a PNG or a JPEG image');
      const decorDir = join(artDir, 'decor');
      mkdirSync(decorDir, { recursive: true });
      const target = join(decorDir, `${b.name}${type}`);
      // The previous picture is kept as a backup; one with another extension is moved away (tools/assets.py would take it first).
      let kept: string | undefined;
      for (const ext of ['.png', '.jpg', '.jpeg']) {
        const old = join(decorDir, `${b.name}${ext}`);
        if (!existsSync(old)) continue;
        kept = rel(backup(old));
        if (old !== target) unlinkSync(old);
      }
      writeFileSync(target, data);
      return { ok: true as const, file: rel(target), ...(kept ? { backup: kept } : {}) };
    });
  }

  /** `npm run assets` (tools/refs.ts + tools/assets.py) for this game; `onData` receives the output as it comes. */
  function prepare(onData?: (s: string) => void): Promise<PrepareResult> {
    return serial(async () => {
      if (resolve(dir) !== resolve(root, 'games', studio.gameId)) throw new StudioError('npm run assets only prepares a game under games/<id>/', 400);
      const r = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'assets'], root, { ...process.env, GAME: studio.gameId }, onData);
      return { ok: r.code === 0, code: r.code, output: r.output };
    });
  }

  return { list, prompts, filePath, uploadSheet, replaceCell, uploadSound, uploadDecor, prepare };
}

export type Assets = ReturnType<typeof createAssets>;

/**
 * Keys one uploaded cell with the cutter's own rule (tools/cut-sheet.py: background = the border's median colour,
 * flood-filled from the border, tolerance 30), then crops it to its figure. argv: cut-sheet.py, source, target, mode,
 * art folder. Prints `kept` (the image already has transparency), `opaque` (no flat background, or mode never) or `keyed`.
 * Pixel-art games (site.json `artStyle: "pixel"`, next to the art folder): the cell is then fixed like a cut sheet
 * (scaled down 4× when larger than 128 px, colours reduced and snapped to the sheet's existing ones, indexed PNG).
 */
const KEY_PY = String.raw`
import importlib.util, os, sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
spec = importlib.util.spec_from_file_location('cut_sheet', sys.argv[1])
cut = importlib.util.module_from_spec(spec); spec.loader.exec_module(cut)
src, dst, mode = sys.argv[2], sys.argv[3], sys.argv[4]
pixel = len(sys.argv) > 5 and cut.art_style(sys.argv[5]) == 'pixel'
def save(img, what):
    if pixel and what != 'opaque':
        a = np.asarray(img.convert('RGBA'))
        scale = cut.PIXEL_SCALE if max(a.shape[:2]) > 2 * cut.CELL // cut.PIXEL_SCALE else 1
        cut.pixelize(a, scale, cut.PIXEL_COLORS, shared=cut.existing_colors(os.path.dirname(dst))).save(dst, transparency=0)
    else:
        img.save(dst)
    print(what); sys.exit(0)
im = Image.open(src)
rgba = im.convert('RGBA')
alpha = np.asarray(rgba)[..., 3]
if (alpha < 250).mean() > 0.01 and mode != 'always':
    box = rgba.getbbox()
    save(rgba.crop(box) if box else rgba, 'kept')
a = np.asarray(im.convert('RGB')).astype(int)
edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
flat = (np.sqrt(((edge - np.median(edge, axis=0)) ** 2).sum(-1)) <= 30).mean() > 0.9
if mode == 'never' or (mode == 'auto' and not flat):
    save(rgba, 'opaque')
fg = ~cut.flood_from_border(cut.bg_mask(a))
out = Image.fromarray(np.dstack([a.astype(np.uint8), (fg * 255).astype(np.uint8)]), 'RGBA')
box = out.getbbox()
save(out.crop(box) if box else out, 'keyed')
`;

// ------------------------------------------------------------------ the HTTP side (/__studio/api/assets/*)

const MAX_BODY = 96 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { fail(new StudioError('body too large', 413)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(chunks).toString('utf8');
      if (!s.trim()) { ok({}); return; }
      try {
        const v = JSON.parse(s);
        if (!v || typeof v !== 'object' || Array.isArray(v)) fail(new StudioError('the body must be a JSON object'));
        else ok(v);
      } catch { fail(new StudioError('the body is not valid JSON')); }
    });
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(data));
}

/** Connect middleware for /__studio/api/assets (mounted by tools/studio/plugin.ts before the rest of the API). */
export function assetsMiddleware(studio: Studio, log?: { error: (msg: string) => void }) {
  const assets = createAssets(studio);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const [path, query = ''] = (req.url ?? '/').split('?');
    const q = new URLSearchParams(query);
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path.startsWith('/file/')) {
        const f = assets.filePath(path.slice(6));
        if (!f) { send(res, 404, { error: 'no such file' }); return; }
        res.setHeader('content-type', MIME[extname(f).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-cache');
        createReadStream(f).pipe(res);
        return;
      }
      if (method === 'POST' && path === '/prepare' && q.get('stream') === '1') {
        // Live output: plain text as it comes, then `[exit <code>]`.
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        try {
          const r = await assets.prepare((s) => res.write(s));
          res.end(`\n[exit ${r.code}]\n`);
        } catch (e) { res.end(`\n${(e as Error).message}\n[exit 1]\n`); }
        return;
      }
      const routes: [string, string, () => Promise<unknown>][] = [
        ['GET', '/', () => assets.list()],
        ['GET', '/prompts', () => assets.prompts(q.get('missing') === '1')],
        ['POST', '/sheet', async () => assets.uploadSheet(await readJson(req) as unknown as SheetUpload)],
        ['POST', '/cell', async () => assets.replaceCell(await readJson(req) as unknown as CellReplace)],
        ['POST', '/sound', async () => assets.uploadSound(await readJson(req) as unknown as SoundUpload)],
        ['POST', '/decor', async () => assets.uploadDecor(await readJson(req) as unknown as DecorUpload)],
        ['POST', '/prepare', () => assets.prepare()],
      ];
      const p = path === '' ? '/' : path;
      const hits = routes.filter(([, r]) => r === p);
      const hit = hits.find(([m]) => m === method);
      if (!hit) { send(res, hits.length ? 405 : 404, { error: hits.length ? `method ${method} not allowed on assets${p}` : `no such endpoint: assets${p}` }); return; }
      send(res, 200, await hit[2]());
    } catch (e) {
      const status = e instanceof StudioError ? e.status : 500;
      if (status >= 500) log?.error(`[studio] ${method} assets${path}: ${(e as Error).stack ?? e}`);
      send(res, status, { ...((e as { body?: object }).body ?? {}), error: (e as Error).message });
    }
  };
}
