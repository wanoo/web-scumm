// Assets tab, IO (4.1.8, programme §4.7: the Studio's biggest owners split into model / IO / view): what leaves the
// page. The uploads' POSTs to /__studio/api/assets/* on the dev server (tools/studio/assets.ts; the listing itself
// goes through `api.assets()`), a picked file read as a data URL, the system file picker, the clipboard.
import { h, toast } from './ui';

export class AssetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** POST /__studio/api/assets/<path> (dev server only). */
export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/__studio/api/assets/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new AssetsApiError(data.error ?? `${r.status}`, r.status, data);
  return data as T;
}

/** A picked file as base64 (a data URL). */
export function readFile(f: File): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(r.error ?? new Error('cannot read the file'));
    r.readAsDataURL(f);
  });
}

/** Opens the system file picker; resolves with the chosen file (never resolves if cancelled). */
export function pickFile(accept: string): Promise<File> {
  return new Promise((ok) => {
    const input = h('input', { type: 'file', accept, hidden: true });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.remove();
      if (f) ok(f);
    });
    document.body.append(input);
    input.click();
  });
}

/** Copies `text` to the clipboard (the textarea fallback when the API refuses), then says so in a toast. */
export async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
  toast(`${what} copied`, 'ok', 1600);
}
