// The Studio's client for /__studio/api/* (tools/studio/plugin.ts). Types are shared with the server.
import type { Layout } from '@engine/core/types';
import type {
  AddEntity, EditResult, GameInfo, MarkdownResult, NewNote, Note, NoteEdit, NotesFile, RoomData, ScreenshotResult, SolveData, ValidateResult,
} from '../../tools/studio/types';

export type * from '../../tools/studio/types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
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

export const api = {
  game: () => call<GameInfo>('GET', 'game'),
  room: (id: string) => call<RoomData>('GET', `room/${id}`),
  setLayout: (id: string, layout: Layout) => call<{ ok: true }>('PUT', `room/${id}/layout`, layout),
  setText: (id: string, path: string, value: string | null) => call<EditResult>('PUT', `room/${id}/text`, { path, value }),
  add: (id: string, e: AddEntity) => call<EditResult>('POST', `room/${id}/add`, e),
  storyboard: () => call<{ title?: string; boards: { id: string; title: string; room?: string; panels?: unknown[] }[] }>('GET', 'storyboard'),
  /** The raw storyboard.json (unknown fields kept). */
  storyboardRaw: () => call<Record<string, unknown> & { boards: unknown[] }>('GET', 'storyboard'),
  setStoryboard: (sb: unknown) => call<{ ok: true; changed: boolean }>('PUT', 'storyboard', sb),
  storyboardMarkdown: () => call<MarkdownResult>('POST', 'storyboard/markdown'),
  notes: () => call<NotesFile>('GET', 'notes'),
  addNote: (n: NewNote) => call<Note>('POST', 'notes', n),
  editNote: (id: string, e: NoteEdit) => call<Note>('PUT', `notes/${encodeURIComponent(id)}`, e),
  deleteNote: (id: string) => call<{ ok: true }>('DELETE', `notes/${encodeURIComponent(id)}`),
  validate: () => call<ValidateResult>('POST', 'validate'),
  solve: (from?: string) => call<SolveData>('POST', 'solve', { from: from || undefined }),
  screenshot: (room: string, checkpoint?: string) => call<Exclude<ScreenshotResult, { unavailable: true }>>('POST', 'screenshot', { room, checkpoint: checkpoint || undefined }),
};

/** Image URL of a manifest id (public/assets, prepared by npm run assets). */
export const imgUrl = (id: string) => `/assets/img/${id}.webp`;
