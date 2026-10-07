// Studio core: every operation of the Studio API (docs/en/STUDIO.md) as a plain function over a game folder.
// Used by the Vite plugin (tools/studio/plugin.ts), the tests and the MCP server. Never exits the process: errors
// are thrown as StudioError (with an HTTP-like status), results are plain JSON.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';
import type { Layout, Point } from '../../src/engine/core/types';
import { validate as validateGame } from '../../src/engine/tools/validate';
import { normalizeExits } from '../../src/engine/core/define';
import { solve as solveGame, type RealityPolicy } from '../../src/engine/tools/solve';
import { report as reportGame, reportMarkdown } from '../../src/engine/tools/report';
import { toDot, toSvg, worldGraph } from '../../src/engine/tools/graph';
import {
  extraReads,
  liveClasses,
  puzzleGraph,
  puzzleMarkdown,
  toPuzzleDot,
  toPuzzleSvg,
} from '../../src/engine/tools/puzzle';
import { coverageMarkdown, storyboardCoverage } from '../../src/engine/tools/coverage';
import { analyzePlaytests, playtestsMarkdown, type PlaytestFile } from '../../src/engine/tools/playtests';
import { parseSessionFile } from '../../src/engine/tools/replay';
import { lintContent, lintMarkdown } from '../../src/engine/tools/lint';
import { loadAssets, loadLayouts, loadLocales } from '../../src/engine/tools/load';
import { GAME_DIR, ROOT, type GameModule } from '../game';
import { normalizeStoryboard, storyboardMarkdown, storyboardProblems } from '../pages/storyboard-data';
import {
  addToSection,
  extractTexts,
  lineDiff,
  objectText,
  parseRoom,
  SourceError,
  setTextInSource,
  setValueInSource,
} from './source';
import { applyLocale } from '../../src/engine/tools/i18n';
import {
  mergeSheet,
  toCsv,
  voiceTable,
  VOICE_STATUSES,
  type VoiceSheet,
  type VoiceStatus,
} from '../../src/engine/tools/voices';
import { lineIds } from '../../src/engine/core/content-ids';
import type {
  CoverageData,
  LintData,
  PlaytestsData,
  AddEntity,
  EditResult,
  GameInfo,
  MarkdownResult,
  NewNote,
  Note,
  NoteEdit,
  NotesFile,
  RoomData,
  ScreenshotResult,
  SolveData,
  TextRef,
  ValidateResult,
  ReportData,
  GraphData,
  PuzzleData,
} from './types';

export class StudioError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface StudioOptions {
  /** The game folder (default: GAME_DIR, see tools/game.ts). */
  gameDir?: string;
  /** Repository root: room files are reported relative to it, screenshots go to <root>/.cache/studio. */
  root?: string;
  /** Imports a TypeScript module fresh (not from a cache): the game changes on disk between calls. */
  importFresh?: (file: string) => Promise<unknown>;
}

/** Default fresh import: tsx's scoped loader (a new namespace per call, so edited files are read again). */
async function tsxImport(file: string): Promise<unknown> {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(file).href, import.meta.url);
}

/**
 * Fresh import in a child process (node + tsx): slower (~0.3 s) but immune to any module cache, e.g. inside Vitest.
 * Only data crosses the process boundary (functions are dropped), which is all the Studio reads from a game.
 */
export function importInChild(file: string, cwd = ROOT): Promise<unknown> {
  const script =
    'const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m, (k, v) => typeof v === "function" ? undefined : v));';
  return new Promise((ok, fail) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, pathToFileURL(file).href],
      { cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          fail(new Error((stderr || err.message).trim().split('\n').slice(-3).join(' ')));
          return;
        }
        try {
          ok(JSON.parse(stdout));
        } catch (e) {
          fail(e as Error);
        }
      },
    );
  });
}

const ID = /^[A-Za-z_][\w-]*$/;

function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    throw new StudioError(`${basename(file)}: invalid JSON (${(e as Error).message})`, 500);
  }
}

/** Throws a StudioError for a bad `[x, y]`. */
function point(at: unknown): Point {
  if (!Array.isArray(at) || at.length !== 2 || !at.every((v) => typeof v === 'number' && Number.isFinite(v)))
    throw new StudioError('`at` must be [x, y]');
  return [Math.round(Math.max(0, Math.min(640, at[0]))), Math.round(Math.max(0, Math.min(400, at[1])))];
}

/** JSON written compactly: a value that fits on one line (within `width`) stays on one line, like a hand-kept file. */
export function formatJson(value: unknown, width = 120): string {
  const inline = (v: unknown): string => {
    if (Array.isArray(v)) return v.length ? `[${v.map(inline).join(', ')}]` : '[]';
    if (v && typeof v === 'object') {
      const e = Object.entries(v).filter(([, x]) => x !== undefined);
      return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
    }
    return JSON.stringify(v) ?? 'null';
  };
  const block = (v: unknown, ind: string, prefix: number): string => {
    const one = inline(v);
    if (ind.length + prefix + one.length <= width || !v || typeof v !== 'object') return one;
    const next = ind + '  ';
    if (Array.isArray(v)) return `[\n${v.map((x) => next + block(x, next, 0)).join(',\n')}\n${ind}]`;
    const e = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{\n${e.map(([k, x]) => `${next}${JSON.stringify(k)}: ${block(x, next, JSON.stringify(k).length + 2)}`).join(',\n')}\n${ind}}`;
  };
  return block(value, '', 0) + '\n';
}

/** The `id` set_value takes for the game file instead of a room (4.1.12): its objectives. */
export const GAME_FILE_ID = '@game';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createStudio(opts: StudioOptions = {}) {
  const dir = resolve(opts.gameDir ?? GAME_DIR);
  const root = resolve(opts.root ?? ROOT);
  const importFresh = opts.importFresh ?? tsxImport;
  const gameId = basename(dir);

  const rel = (file: string) => {
    const r = relative(root, file);
    return r.startsWith('..') || isAbsolute(r) ? file : r;
  };
  const layoutFile = (id: string) => join(dir, 'layout', `${id}.json`);

  // Writes are serialized: two quick edits of the same file never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  };

  async function loadModule(): Promise<GameModule> {
    try {
      return (await importFresh(join(dir, 'index.ts'))) as GameModule;
    } catch (e) {
      throw new StudioError(`the game does not load: ${(e as Error).message}`, 500);
    }
  }

  /** The file of `defineGame({...})`: game.ts, else the first .ts of the game folder that calls it. */
  function gameFile(): string {
    const files = ['game.ts', ...readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'game.ts')].map((f) =>
      join(dir, f),
    );
    const found = files.find((f) => existsSync(f) && /\bdefineGame\s*\(/.test(readFileSync(f, 'utf8')));
    if (!found) throw new StudioError('no defineGame({...}) in the game folder', 404);
    return found;
  }

  /** rooms/<id>.ts, or the room file whose `id` is this id. */
  function roomFile(id: string): string {
    if (!ID.test(id)) throw new StudioError(`invalid room id: "${id}"`);
    const direct = join(dir, 'rooms', `${id}.ts`);
    if (existsSync(direct)) return direct;
    const rooms = join(dir, 'rooms');
    if (existsSync(rooms)) {
      for (const f of readdirSync(rooms).filter((x) => x.endsWith('.ts'))) {
        const file = join(rooms, f);
        try {
          const { root: obj } = parseRoom(readFileSync(file, 'utf8'), file);
          const p = obj.properties.find(
            (q) => ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'id',
          ) as ts.PropertyAssignment | undefined;
          if (p && ts.isStringLiteral(p.initializer) && p.initializer.text === id) return file;
        } catch {
          /* not a room file */
        }
      }
    }
    throw new StudioError(`unknown room: "${id}"`, 404);
  }

  // ---- writes: atomic, recorded for undo / redo (3.4)
  /** What each write changed: undo puts `before` back, redo `after`, only while the file still holds the other. */
  type Change = { file: string; before: string | null; after: string | null; what: string };
  const undoStack: Change[] = [],
    redoStack: Change[] = [];
  /** Writes through a temporary file and a rename: a reader never sees half a file. `null` removes the file. */
  function writeAtomic(file: string, text: string | null) {
    if (text === null) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(join(file, '..'), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
  /** Writes and records the change (the redo history is dropped by a new edit). */
  function commit(file: string, after: string | null, what: string) {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (before === after) return;
    writeAtomic(file, after);
    undoStack.push({ file, before, after, what });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }

  function writeRoomCode(file: string, code: string, what = 'edit') {
    const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
    if (diags.length)
      throw new StudioError(
        `refused: the edit would break ${basename(file)} (${ts.flattenDiagnosticMessageText(diags[0].messageText, ' ')})`,
        500,
      );
    commit(file, code, what);
  }

  /** Undoes (or redoes) the last recorded write; 409 when the file changed since (an AI, an editor, git). */
  function step(
    from: Change[],
    to: Change[],
    dirn: 'undo' | 'redo',
  ): Promise<{ ok: true; file: string; what: string } | { ok: false; reason: string }> {
    return serial(() => {
      const c = from.pop();
      if (!c) return { ok: false as const, reason: `nothing to ${dirn}` };
      const now = existsSync(c.file) ? readFileSync(c.file, 'utf8') : null;
      const expect = dirn === 'undo' ? c.after : c.before;
      if (now !== expect) {
        throw new StudioError(`cannot ${dirn} "${c.what}": ${rel(c.file)} changed since`, 409);
      }
      writeAtomic(c.file, dirn === 'undo' ? c.before : c.after);
      to.push(c);
      return { ok: true as const, file: rel(c.file), what: c.what };
    });
  }
  const undo = () => step(undoStack, redoStack, 'undo');
  const redo = () => step(redoStack, undoStack, 'redo');
  const history = () => ({
    undo: undoStack.map((c) => c.what).reverse(),
    redo: redoStack.map((c) => c.what).reverse(),
  });

  /**
   * Writes a structured value (a stage, a condition, a command list, a renderer) at `path` in rooms/<id>.ts. `dry`:
   * only the diff. Otherwise the edit is written, the game reloaded and validated: an edit that adds a validation
   * error is taken back (422, with the errors). Recorded for undo.
   */
  function setValue(
    id: string,
    path: string,
    value: unknown,
    o: { dry?: boolean } = {},
  ): Promise<EditResult & { diff: string; dry?: true }> {
    return serial(async () => {
      if (typeof path !== 'string' || !path) throw new StudioError('`path` is required');
      // `@game` (4.1.12): the game file's `defineGame({...})`, for its objectives only (ADR 0014).
      const isGame = id === GAME_FILE_ID;
      if (isGame && !/^objectives(\.[\w.-]+)?(\.(title|done|optional|parent))?$/.test(path))
        throw new StudioError(
          `@game: only "objectives", "objectives.<id>" or "objectives.<id>.<field>" can be written`,
        );
      const file = isGame ? gameFile() : roomFile(id);
      const before = readFileSync(file, 'utf8');
      const r = wrap(() => setValueInSource(before, path, value, file, isGame ? 'defineGame' : 'defineRoom'));
      const diff = r.changed ? lineDiff(before, r.code) : '';
      if (!r.changed || o.dry)
        return { ok: true as const, line: r.line, changed: r.changed, diff, ...(o.dry ? { dry: true as const } : {}) };
      await guarded(() => writeRoomCode(file, r.code, `${id}: ${path}`), diff);
      return { ok: true as const, line: r.line, changed: true, diff };
    });
  }

  /**
   * Writes through `write`, validates the game as it is then on disk, and takes the write back (422, with the
   * errors) when it adds a validation error. `setValue` since 3.4; `setLayout` since 4.1.6, which wrote unchecked.
   */
  async function guarded(write: () => void, diff = ''): Promise<void> {
    const was = new Set((await validateNow()).errors);
    const depth = undoStack.length;
    write();
    const added = (await validateNow()).errors.filter((e) => !was.has(e));
    if (!added.length) return;
    if (undoStack.length > depth) {
      const c = undoStack.pop()!;
      writeAtomic(c.file, c.before);
    }
    throw Object.assign(
      new StudioError(
        `refused: the edit adds ${added.length} validation error(s): ${added.slice(0, 3).join('; ')}`,
        422,
      ),
      { body: { errors: added, diff } },
    );
  }

  const wrap = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof SourceError) throw new StudioError(e.message, e.status);
      throw e;
    }
  };

  // ------------------------------------------------------------------ reading

  async function gameInfo(): Promise<GameInfo> {
    const mod = await loadModule();
    const g = mod.game;
    const manifest = (mod.manifest ?? {}) as { images?: Record<string, [number, number]> };
    return {
      id: gameId,
      title: g.title,
      hero: g.hero,
      rooms: g.rooms.map((r) => ({ id: r.id, name: r.name, decor: r.decor })),
      characters: Object.fromEntries(
        Object.entries(g.characters).map(([k, c]) => [k, { name: c.name, color: c.color, portrait: c.portrait }]),
      ),
      items: Object.fromEntries(Object.entries(g.items).map(([k, i]) => [k, { name: i.name, icon: i.icon }])),
      verbs: g.verbs,
      checkpoints: g.checkpoints ?? {},
      objectives: g.objectives ?? {},
      images: manifest.images ?? {},
      sfx: Object.keys(g.audio?.sfx ?? {}),
      scores: g.audio?.scores ?? {},
    };
  }

  function texts(id: string): TextRef[] {
    const file = roomFile(id);
    return wrap(() => extractTexts(readFileSync(file, 'utf8'), file)).map(({ segs: _s, ...t }) => ({
      ...t,
      file: rel(file),
    }));
  }

  async function getRoom(id: string): Promise<RoomData> {
    const file = roomFile(id);
    const mod = await loadModule();
    // Declared exits are shown as what they become (a hotspot and rules at the end of `on`): the written paths hold.
    const def = normalizeExits(mod.game).rooms.find((r) => r.id === id);
    if (!def) throw new StudioError(`room "${id}" is not in the game (index.ts / game.ts)`, 404);
    return { def, layout: readJson<Layout>(layoutFile(id), {}), texts: texts(id), file: rel(file) };
  }

  function getLayout(id: string): Layout {
    roomFile(id);
    return readJson<Layout>(layoutFile(id), {});
  }

  // ------------------------------------------------------------------ writing

  function setLayout(id: string, layout: unknown): Promise<{ ok: true }> {
    return serial(async () => {
      roomFile(id);
      if (!layout || typeof layout !== 'object' || Array.isArray(layout))
        throw new StudioError('the layout must be an object');
      await guarded(() => commit(layoutFile(id), JSON.stringify(layout, null, 2) + '\n', `${id}: layout`));
      return { ok: true as const };
    });
  }

  /**
   * Replaces the text at `path` in rooms/<id>.ts. `value: null` deletes a list line (or a whole look entry);
   * a path ending in `[+]` appends a line. Writes nothing when the value is already there.
   */
  function setText(id: string, path: string, value: string | null): Promise<EditResult> {
    return serial(() => {
      if (typeof path !== 'string' || !path) throw new StudioError('`path` is required');
      if (value !== null && typeof value !== 'string') throw new StudioError('`value` must be a string or null');
      const file = roomFile(id);
      const code = readFileSync(file, 'utf8');
      const r = wrap(() => setTextInSource(code, path, value, file));
      if (r.changed) writeRoomCode(file, r.code, `${id}: ${path}`);
      return { ok: true as const, line: r.line, changed: r.changed };
    });
  }

  /** Adds a prop, hotspot or actor to the room file and gives it a place in the layout. */
  function addEntity(id: string, e: AddEntity): Promise<EditResult> {
    return serial(async () => {
      const file = roomFile(id);
      if (!e || !['prop', 'hotspot', 'actor'].includes(e.kind))
        throw new StudioError('`kind` must be prop, hotspot or actor');
      if (typeof e.id !== 'string' || !/^[A-Za-z_][\w]*$/.test(e.id))
        throw new StudioError('`id` must be letters, digits and _ (not starting with a digit)');
      const at = point(e.at);
      const name = typeof e.name === 'string' ? e.name.trim() : '';
      if (e.kind !== 'actor' && !name) throw new StudioError('`name` is required for a prop or a hotspot');
      const mod = await loadModule();
      const room = mod.game.rooms.find((r) => r.id === id);
      if (room && [room.props, room.hotspots, room.actors].some((o) => o && e.id in o))
        throw new StudioError(`"${e.id}" already exists in room "${id}"`, 409);
      if (e.kind === 'actor') {
        if (!e.char || !mod.game.characters[e.char]) throw new StudioError(`unknown character: "${e.char ?? ''}"`);
      }
      const images = (mod.manifest as { images?: Record<string, unknown> } | undefined)?.images;
      if (e.kind === 'prop' && e.img && images && Object.keys(images).length && !images[e.img])
        throw new StudioError(`image not in the manifest: "${e.img}"`);

      let code = readFileSync(file, 'utf8');
      const fields: Record<string, string | undefined> =
        e.kind === 'prop'
          ? { name, img: e.img || undefined }
          : e.kind === 'hotspot'
            ? { name }
            : { char: e.char, name: name && name !== mod.game.characters[e.char!].name ? name : undefined };
      const section = e.kind === 'prop' ? 'props' : e.kind === 'hotspot' ? 'hotspots' : 'actors';
      const r = wrap(() => addToSection(code, section, e.id, objectText(code, fields, file), file));
      code = r.code;
      if (typeof e.look === 'string' && e.look.trim())
        code = wrap(() => setTextInSource(code, `look.${e.id}[+]`, e.look!.trim(), file)).code;
      writeRoomCode(file, code);

      const L = readJson<Layout>(layoutFile(id), {});
      if (e.kind === 'prop') (L.props ??= {})[e.id] = { x: at[0], y: at[1], h: 60 };
      else if (e.kind === 'hotspot')
        (L.hotspots ??= {})[e.id] = { rect: [Math.max(0, at[0] - 30), Math.max(0, at[1] - 30), 60, 60] };
      else (L.actors ??= {})[e.id] = { x: at[0], y: at[1] };
      commit(layoutFile(id), JSON.stringify(L, null, 2) + '\n', `${id}: place ${e.id}`);
      return { ok: true as const, line: r.line, changed: true };
    });
  }

  // ------------------------------------------------------------------ storyboard and notes

  function getStoryboard(): Record<string, unknown> {
    return readJson<Record<string, unknown>>(join(dir, 'storyboard.json'), { boards: [] });
  }

  function setStoryboard(sb: unknown): Promise<{ ok: true; changed: boolean }> {
    return serial(() => {
      const problems = storyboardProblems(sb);
      if (problems.length) throw new StudioError(problems.join('; '));
      const file = join(dir, 'storyboard.json');
      if (existsSync(file) && sameJson(readJson(file, null), sb)) return { ok: true as const, changed: false };
      writeFileSync(file, formatJson(sb));
      return { ok: true as const, changed: true };
    });
  }

  const notesFile = () => join(dir, 'notes.json');

  function getNotes(): NotesFile {
    const n = readJson<NotesFile>(notesFile(), { entries: [] });
    return { entries: Array.isArray(n.entries) ? n.entries : [] };
  }

  function addNote(n: NewNote): Promise<Note> {
    return serial(() => {
      if (!n || typeof n.text !== 'string' || !n.text.trim()) throw new StudioError('`text` is required');
      const all = getNotes();
      const note: Note = {
        id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        about: typeof n.about === 'string' ? n.about.trim() : '',
        author: typeof n.author === 'string' && n.author.trim() ? n.author.trim() : 'you',
        text: n.text.trim(),
        at: new Date().toISOString(),
        ...(n.task === true ? { task: true as const } : {}),
      };
      all.entries.push(note);
      writeFileSync(notesFile(), JSON.stringify(all, null, 2) + '\n');
      return note;
    });
  }

  /** Replaces the text (and optionally the `about`) of a note. */
  function editNote(id: string, e: NoteEdit): Promise<Note> {
    return serial(() => {
      if (!e || typeof e.text !== 'string' || !e.text.trim()) throw new StudioError('`text` is required');
      if (e.about !== undefined && typeof e.about !== 'string') throw new StudioError('`about` must be a string');
      const all = getNotes();
      const note = all.entries.find((n) => n.id === id);
      if (!note) throw new StudioError(`no such note: "${id}"`, 404);
      note.text = e.text.trim();
      if (e.about !== undefined) note.about = e.about.trim();
      note.edited = new Date().toISOString();
      writeFileSync(notesFile(), JSON.stringify(all, null, 2) + '\n');
      return note;
    });
  }

  function deleteNote(id: string): Promise<{ ok: true }> {
    return serial(() => {
      const all = getNotes();
      const i = all.entries.findIndex((n) => n.id === id);
      if (i < 0) throw new StudioError(`no such note: "${id}"`, 404);
      all.entries.splice(i, 1);
      writeFileSync(notesFile(), JSON.stringify(all, null, 2) + '\n');
      return { ok: true as const };
    });
  }

  /** Writes games/<id>/storyboard.md from storyboard.json (same text as `npm run page:storyboard -- --md`). */
  async function exportStoryboardMarkdown(): Promise<MarkdownResult> {
    const mod = await loadModule();
    return serial(() => {
      const file = join(dir, 'storyboard.json');
      if (!existsSync(file)) throw new StudioError('no storyboard.json in this game', 404);
      const sb = normalizeStoryboard(readJson<unknown>(file, { boards: [] }));
      const md = storyboardMarkdown({ game: mod.game }, sb);
      const out = join(dir, 'storyboard.md');
      writeFileSync(out, md);
      return {
        ok: true as const,
        file: rel(out),
        bytes: Buffer.byteLength(md),
        boards: sb.boards.length,
        panels: sb.boards.reduce((n, b) => n + b.panels.length, 0),
      };
    });
  }

  /** The storyboard against the content: what each board, panel, line, topic and sound amounts to in the game. */
  async function coverage(): Promise<CoverageData> {
    const t0 = Date.now();
    const mod = await loadModule();
    const sb = normalizeStoryboard(readJson<unknown>(join(dir, 'storyboard.json'), { boards: [] }));
    const c = storyboardCoverage(mod.game, sb);
    return { coverage: c, markdown: coverageMarkdown(c), ms: Date.now() - t0 };
  }

  // ------------------------------------------------------------------ checks

  /** The validator's verdict on the game as it is on disk (setValue compares before and after). */
  const validateNow = () => validate();

  // ---- voices (3.4): the production table, per language
  const voicesFile = () => join(dir, 'voices.json');
  async function voices(
    lang?: string,
  ): Promise<{ lang: string; langs: string[]; statuses: readonly VoiceStatus[]; rows: ReturnType<typeof voiceTable> }> {
    const mod = await loadModule();
    const g = mod.game,
      base = g.lang ?? 'en';
    const locales = loadLocales(join(dir, 'locales'));
    const langs = [base, ...Object.keys(locales).filter((l) => l !== base)];
    const l = lang && langs.includes(lang) ? lang : base;
    const sheet = readJson<VoiceSheet>(voicesFile(), {});
    const localized = l === base ? g : applyLocale(structuredClone(g), locales[l]);
    return { lang: l, langs, statuses: VOICE_STATUSES, rows: voiceTable(g, sheet, l, localized) };
  }
  function setVoice(
    lang: string,
    id: string,
    patch: { status?: string; note?: string; actor?: string },
  ): Promise<{ ok: true }> {
    return serial(async () => {
      const mod = await loadModule();
      const sheet = readJson<VoiceSheet>(voicesFile(), {});
      const cur = sheet[lang]?.[id];
      const row = {
        id,
        status: patch.status ?? cur?.status ?? 'draft',
        note: patch.note ?? cur?.note ?? '',
        actor: patch.actor ?? cur?.actor ?? '',
      };
      const m = mergeSheet(sheet, lang, [row], new Set(lineIds(mod.game).map((x) => x.id)));
      if (m.unknown.length) throw new StudioError(`no line "${id}" in the game`, 404);
      if (m.bad.length) throw new StudioError(m.bad[0]);
      commit(voicesFile(), JSON.stringify(m.sheet, null, 2) + '\n', `voices ${lang}: ${id}`);
      return { ok: true as const };
    });
  }
  async function voicesCsv(lang?: string): Promise<{ lang: string; csv: string }> {
    const v = await voices(lang);
    return { lang: v.lang, csv: toCsv(v.rows) };
  }

  async function validate(): Promise<ValidateResult> {
    const t0 = Date.now();
    const mod = await loadModule();
    const layouts = loadLayouts(join(dir, 'layout'));
    const assets = loadAssets(join(dir, 'assets.gen.json'));
    let minigames: Record<string, { required?: string[] }> | undefined;
    try {
      const eng = (await importFresh(join(root, 'src/engine/minigames/index.ts'))) as {
        minigames: Record<string, { required?: string[] }>;
      };
      minigames = { ...eng.minigames, ...(mod.minigames ?? {}) };
    } catch {
      minigames = undefined;
    }
    const { errors, warnings } = validateGame(mod.game, layouts, {
      assets,
      commands: mod.commands,
      minigameIds: minigames ? Object.keys(minigames) : undefined,
      minigameParams: minigames
        ? Object.fromEntries(Object.entries(minigames).map(([k, m]) => [k, m.required ?? []]))
        : undefined,
      minigameBindings: minigames
        ? Object.fromEntries(
            Object.entries(minigames).map(([k, m]) => [
              k,
              (m as { bindings?: { images?: string[]; sfx?: string[] } }).bindings ?? {},
            ]),
          )
        : undefined,
    });
    return { ok: errors.length === 0, errors, warnings, ms: Date.now() - t0 };
  }

  /** The playtests of games/<id>/playtests/*.session.json replayed and summed up. */
  async function playtests(): Promise<PlaytestsData> {
    const t0 = Date.now();
    const mod = await loadModule();
    const layouts = loadLayouts(join(dir, 'layout'));
    const folder = join(dir, 'playtests');
    const files: PlaytestFile[] = existsSync(folder)
      ? readdirSync(folder)
          .filter((f) => f.endsWith('.session.json'))
          .sort()
          .map((name) => ({ name, file: parseSessionFile(readFileSync(join(folder, name), 'utf8')) }))
      : [];
    const report = await analyzePlaytests(mod.game, layouts, files, { commands: mod.commands });
    return { report, markdown: playtestsMarkdown(report, mod.game), files: files.length, ms: Date.now() - t0 };
  }

  /** The content lint after a witness (or, `prove`, exhaustive) solver run. */
  async function lint(prove = false): Promise<LintData> {
    const t0 = Date.now();
    const mod = await loadModule();
    const layouts = loadLayouts(join(dir, 'layout'));
    const s = await solveGame(mod.game, layouts, { commands: mod.commands, mode: prove ? 'prove' : 'witness' });
    const r = lintContent(mod.game, layouts, { solve: s, commands: mod.commands });
    return { lint: r, markdown: lintMarkdown(r, s.mode), mode: s.mode, ms: Date.now() - t0 };
  }

  async function solve(
    from?: string | null,
    maxStates = 20000,
    mode: 'witness' | 'prove' = 'witness',
    reality?: RealityPolicy,
  ): Promise<SolveData> {
    const t0 = Date.now();
    const mod = await loadModule();
    if (from && !mod.game.checkpoints?.[from]) throw new StudioError(`unknown checkpoint: "${from}"`);
    const layouts = loadLayouts(join(dir, 'layout'));
    const r = await solveGame(mod.game, layouts, {
      maxStates,
      start: from ? { checkpoint: from } : 'new',
      commands: mod.commands,
      mode,
      ...(reality ? { reality } : {}),
    });
    return {
      status: r.status,
      exit: r.exit,
      headline: r.headline,
      mode: r.mode,
      softlocks: r.softlocks,
      finished: r.finished,
      states: r.states,
      truncated: r.truncated,
      path: r.path,
      roomsReached: r.roomsReached,
      unlockedReached: r.unlockedReached,
      flagsReached: r.flagsReached,
      itemsNeverUsed: r.itemsNeverUsed,
      unusedItems: r.unusedItems,
      deadEnds: r.deadEnds.map((d) => ({ room: d.room, inventory: d.inventory, path: d.path })),
      errors: r.errors,
      broken: r.broken,
      from: from ?? null,
      ms: Date.now() - t0,
      profile: r.profile,
      ...(r.reality ? { reality: r.reality } : {}),
    };
  }

  /** The content profiler: what each room, item and character amounts to. */
  async function report(): Promise<ReportData> {
    const t0 = Date.now();
    const mod = await loadModule();
    const r = reportGame(mod.game, loadLayouts(join(dir, 'layout')), { locales: loadLocales(join(dir, 'locales')) });
    return { report: r, markdown: reportMarkdown(r), ms: Date.now() - t0 };
  }

  /** The puzzle graph: what every rule needs and changes; `id` = one item / flag / prop card. */
  async function puzzle(id?: string): Promise<PuzzleData> {
    const mod = await loadModule();
    const g = puzzleGraph(mod.game, { commands: mod.commands });
    const extra = extraReads(mod.game);
    return {
      graph: g,
      svg: toPuzzleSvg(g),
      dot: toPuzzleDot(g),
      markdown: puzzleMarkdown(g, id || undefined, { extra }),
      classes: Object.fromEntries(liveClasses(g, extra)),
      ...(id ? { id } : {}),
    };
  }

  /** The world's map: rooms and the ways between them. */
  async function graph(): Promise<GraphData> {
    const mod = await loadModule();
    const g = worldGraph(mod.game);
    return { graph: g, svg: toSvg(g), dot: toDot(g) };
  }

  // ------------------------------------------------------------------ screenshot

  const shotsDir = () => join(root, '.cache', 'studio');

  /** Renders a room (optionally at a checkpoint) with the running dev server at `baseUrl`, without the editor's overlays. */
  async function screenshot(
    room: string,
    checkpoint: string | null | undefined,
    baseUrl: string,
  ): Promise<ScreenshotResult> {
    roomFile(room);
    if (checkpoint && !ID.test(checkpoint)) throw new StudioError(`invalid checkpoint: "${checkpoint}"`);
    let pw: typeof import('playwright');
    try {
      pw = await import('playwright');
    } catch {
      return {
        unavailable: true,
        reason: 'Playwright is not installed (npm i -D playwright && npx playwright install chromium)',
      };
    }
    let browser: Awaited<ReturnType<typeof pw.chromium.launch>>;
    try {
      browser = await pw.chromium.launch();
    } catch (e) {
      return { unavailable: true, reason: `Chromium does not start: ${(e as Error).message.split('\n')[0]}` };
    }
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
      // baseUrl: the dev server's root, base path included (http://localhost:5173/ or …/<base>/).
      const url = new URL(baseUrl);
      url.search = '';
      url.hash = '';
      url.searchParams.set('edit', room);
      if (checkpoint) url.searchParams.set('at', checkpoint);
      await page.goto(url.toString());
      await page.waitForFunction(() => !!(window as unknown as { __editor?: unknown }).__editor, null, {
        timeout: 20000,
      });
      await page.evaluate(() => {
        document.querySelectorAll<HTMLElement>('.scene > svg, .tp-dfwv').forEach((e) => {
          e.style.display = 'none';
        });
      });
      await page.waitForTimeout(700);
      mkdirSync(shotsDir(), { recursive: true });
      const name = `${gameId}-${room}${checkpoint ? `-${checkpoint}` : ''}.png`;
      const file = join(shotsDir(), name);
      await page.screenshot({ path: file });
      return { file: rel(file), url: `/__studio/api/screenshots/${name}?t=${Date.now()}` };
    } finally {
      await browser.close();
    }
  }

  /** A screenshot written by `screenshot`, by its file name (null if absent or not a plain name). */
  function screenshotPath(name: string): string | null {
    if (!/^[\w.-]+\.png$/.test(name)) return null;
    const f = join(shotsDir(), name);
    return existsSync(f) ? f : null;
  }

  return {
    gameDir: dir,
    gameId,
    root,
    /** The game module, imported fresh (for tools that read the whole game, e.g. asset prompts). */
    loadGame: loadModule,
    gameInfo,
    getRoom,
    texts,
    getLayout,
    setLayout,
    setText,
    addEntity,
    report,
    graph,
    puzzle,
    coverage,
    lint,
    playtests,
    getStoryboard,
    setStoryboard,
    getNotes,
    addNote,
    editNote,
    deleteNote,
    exportStoryboardMarkdown,
    validate,
    solve,
    screenshot,
    screenshotPath,
    setValue,
    undo,
    redo,
    history,
    voices,
    setVoice,
    voicesCsv,
  };
}

export type Studio = ReturnType<typeof createStudio>;

// The current game (GAME / GAME_DIR), for callers that don't need another folder.
let current: Studio | undefined;
const cur = () => (current ??= createStudio());
export const gameInfo = () => cur().gameInfo();
export const getRoom = (id: string) => cur().getRoom(id);
export const setLayout = (id: string, layout: unknown) => cur().setLayout(id, layout);
export const setText = (id: string, path: string, value: string | null) => cur().setText(id, path, value);
export const addEntity = (id: string, e: AddEntity) => cur().addEntity(id, e);
export const getStoryboard = () => cur().getStoryboard();
export const setStoryboard = (sb: unknown) => cur().setStoryboard(sb);
export const getNotes = () => cur().getNotes();
export const addNote = (n: NewNote) => cur().addNote(n);
export const editNote = (id: string, e: NoteEdit) => cur().editNote(id, e);
export const deleteNote = (id: string) => cur().deleteNote(id);
export const exportStoryboardMarkdown = () => cur().exportStoryboardMarkdown();
export const validate = () => cur().validate();
export const solve = (from?: string | null, mode?: 'witness' | 'prove') => cur().solve(from, undefined, mode);
export const screenshot = (room: string, checkpoint: string | null | undefined, baseUrl: string) =>
  cur().screenshot(room, checkpoint, baseUrl);
