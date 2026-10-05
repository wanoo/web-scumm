// The Studio's backend, behind one interface: the dev server's /__studio/api/* (tools/studio/plugin.ts, the default)
// or, in demo mode, the browser backend (src/studio/api-browser.ts: a build-time snapshot plus edits in localStorage).
// Types are shared with the server.
import type { Layout } from '@engine/core/types';
import type {
  CoverageData,
  GraphData,
  LintData,
  PlaytestsData,
  PuzzleData,
  ReportData,
  AddEntity,
  AssetsListing,
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
  ValidateResult,
} from '../../tools/studio/types';

export type * from '../../tools/studio/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/__studio/api/${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new ApiError(data.error ?? `${r.status}`, r.status);
  return data as T;
}

type Storyboard = Record<string, unknown> & { boards: unknown[] };

export interface Api {
  /** 'server': files on disk through the dev server; 'demo': in this browser only. */
  readonly mode: 'server' | 'demo';
  game(): Promise<GameInfo>;
  room(id: string): Promise<RoomData>;
  setLayout(id: string, layout: Layout): Promise<{ ok: true }>;
  setText(id: string, path: string, value: string | null): Promise<EditResult>;
  add(id: string, e: AddEntity): Promise<EditResult>;
  /** The raw storyboard.json (unknown fields kept). */
  storyboardRaw(): Promise<Storyboard>;
  setStoryboard(sb: unknown): Promise<{ ok: true; changed: boolean }>;
  /** Server: writes storyboard.md. Demo: generates it and hands it to the browser as a download. */
  storyboardMarkdown(): Promise<MarkdownResult>;
  notes(): Promise<NotesFile>;
  addNote(n: NewNote): Promise<Note>;
  editNote(id: string, e: NoteEdit): Promise<Note>;
  deleteNote(id: string): Promise<{ ok: true }>;
  validate(): Promise<ValidateResult>;
  solve(from?: string, prove?: boolean): Promise<SolveData>;
  report(): Promise<ReportData>;
  graph(): Promise<GraphData>;
  puzzle(id?: string): Promise<PuzzleData>;
  /** The storyboard checked against the content. */
  coverage(): Promise<CoverageData>;
  /** The content lint after a solver run. */
  lint(prove?: boolean): Promise<LintData>;
  /** The playtests replayed and summed up (dev server only: the demo has no folder to read). */
  playtests?(): Promise<PlaytestsData>;
  screenshot(room: string, checkpoint?: string): Promise<Exclude<ScreenshotResult, { unavailable: true }>>;
  /** Every image and sound, where it is used, and the art prompts (the Assets tab; uploads: src/studio/assets.ts). */
  assets(): Promise<AssetsListing>;
  /** 3.4, dev server only: a structured value written at `path` of a room file (`dry`: the diff only), validated. */
  setValue?(
    id: string,
    path: string,
    value: unknown,
    dry?: boolean,
  ): Promise<EditResult & { diff: string; dry?: true }>;
  /** 3.4, dev server only: the last write taken back or done again (409 when the file changed since). */
  undo?(): Promise<{ ok: boolean; what?: string; reason?: string }>;
  redo?(): Promise<{ ok: boolean; what?: string; reason?: string }>;
  history?(): Promise<{ undo: string[]; redo: string[] }>;
  /** 3.4, dev server only: the voice production table. */
  voices?(lang?: string): Promise<VoicesData>;
  setVoice?(lang: string, id: string, patch: { status?: string; note?: string; actor?: string }): Promise<{ ok: true }>;
  voicesCsv?(lang: string): Promise<{ lang: string; csv: string }>;
}

export interface VoicesData {
  lang: string;
  langs: string[];
  statuses: string[];
  rows: { id: string; who: string; text: string; status: string; file?: string; note?: string; actor?: string }[];
}

export const serverApi: Api = {
  mode: 'server',
  game: () => call<GameInfo>('GET', 'game'),
  room: (id: string) => call<RoomData>('GET', `room/${id}`),
  setLayout: (id: string, layout: Layout) => call<{ ok: true }>('PUT', `room/${id}/layout`, layout),
  setText: (id: string, path: string, value: string | null) =>
    call<EditResult>('PUT', `room/${id}/text`, { path, value }),
  add: (id: string, e: AddEntity) => call<EditResult>('POST', `room/${id}/add`, e),
  storyboardRaw: () => call<Storyboard>('GET', 'storyboard'),
  setStoryboard: (sb: unknown) => call<{ ok: true; changed: boolean }>('PUT', 'storyboard', sb),
  storyboardMarkdown: () => call<MarkdownResult>('POST', 'storyboard/markdown'),
  notes: () => call<NotesFile>('GET', 'notes'),
  addNote: (n: NewNote) => call<Note>('POST', 'notes', n),
  editNote: (id: string, e: NoteEdit) => call<Note>('PUT', `notes/${encodeURIComponent(id)}`, e),
  deleteNote: (id: string) => call<{ ok: true }>('DELETE', `notes/${encodeURIComponent(id)}`),
  validate: () => call<ValidateResult>('POST', 'validate'),
  report: () => call<ReportData>('POST', 'report'),
  graph: () => call<GraphData>('GET', 'graph'),
  puzzle: (id?: string) => call<PuzzleData>('POST', 'puzzle', { id: id || undefined }),
  coverage: () => call<CoverageData>('POST', 'coverage'),
  lint: (prove?: boolean) => call<LintData>('POST', 'lint', { prove: prove || undefined }),
  playtests: () => call<PlaytestsData>('POST', 'playtests'),
  solve: (from?: string, prove?: boolean) =>
    call<SolveData>('POST', 'solve', { from: from || undefined, prove: prove || undefined }),
  screenshot: (room: string, checkpoint?: string) =>
    call<Exclude<ScreenshotResult, { unavailable: true }>>('POST', 'screenshot', {
      room,
      checkpoint: checkpoint || undefined,
    }),
  assets: () => call<AssetsListing>('GET', 'assets'),
  setValue: (id: string, path: string, value: unknown, dry?: boolean) =>
    call<EditResult & { diff: string; dry?: true }>('PUT', `room/${id}/value`, { path, value, dry: dry || undefined }),
  undo: () => call<{ ok: boolean; what?: string; reason?: string }>('POST', 'undo'),
  redo: () => call<{ ok: boolean; what?: string; reason?: string }>('POST', 'redo'),
  history: () => call<{ undo: string[]; redo: string[] }>('GET', 'history'),
  voices: (lang?: string) => call<VoicesData>('GET', lang ? `voices/${lang}` : 'voices'),
  setVoice: (lang: string, id: string, patch: { status?: string; note?: string; actor?: string }) =>
    call<{ ok: true }>('PUT', `voices/${lang}/${encodeURIComponent(id)}`, patch),
  voicesCsv: (lang: string) => call<{ lang: string; csv: string }>('GET', `voices/${lang}/csv`),
};

/** The backend in use (a live binding: the tabs read it at call time). Set once at start by main.ts. */
export let api: Api = serverApi;
export function useApi(a: Api) {
  api = a;
}

/** The game's root URL (the Vite base: `/` in dev, `/<repo>/` on GitHub Pages). */
export const BASE = import.meta.env.BASE_URL ?? '/';

/** Image URL of a manifest id (public/assets, prepared by npm run assets). */
export const imgUrl = (id: string) => `${BASE}assets/img/${id}.webp`;
