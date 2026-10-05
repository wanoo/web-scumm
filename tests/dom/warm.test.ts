// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetBank } from '@engine/dom/assets';

const bank = () => new AssetBank({ images: {} }, 'assets', 'v1');
const response = (ok: boolean, status = ok ? 200 : 404) => ({
  ok,
  status,
  arrayBuffer: async () => new ArrayBuffer(1),
});

describe('AssetBank.warm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts a fetched file as done, a bad status or a network error as failed, and retries the failed ones', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        calls.push(u);
        if (u.includes('missing')) return response(false);
        if (u.includes('down')) throw new Error('offline');
        return response(true);
      }),
    );
    const b = bank();
    const r = await b.warm(['/a.webp', '/missing.webp', '/down.webp'], 2);
    expect(r).toEqual({ ok: 1, failed: ['/missing.webp', '/down.webp'], skipped: null });
    const again = await b.warm(['/a.webp', '/missing.webp'], 2);
    expect(again.ok).toBe(1); // /a.webp already warmed, not fetched again
    expect(calls.filter((u) => u === '/a.webp')).toHaveLength(1);
    expect(calls.filter((u) => u === '/missing.webp')).toHaveLength(2);
  });

  it('counts a file already in the Cache API as done without fetching it', async () => {
    const fetch = vi.fn(async () => response(true));
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('caches', { match: async (u: string) => (u === '/cached.webp' ? new Response('x') : undefined) });
    const r = await bank().warm(['/cached.webp', '/new.webp'], 1);
    expect(r).toEqual({ ok: 2, failed: [], skipped: null });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('skips on a save-data link, and the heavy batches on 3G', async () => {
    const fetch = vi.fn(async () => response(true));
    vi.stubGlobal('fetch', fetch);
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    expect(await bank().warm(['/a.webp'])).toEqual({ ok: 0, failed: [], skipped: 'save-data' });
    Object.defineProperty(navigator, 'connection', { value: { effectiveType: '3g' }, configurable: true });
    expect(await bank().warm(['/m.mp3'], 1, { heavy: true })).toEqual({ ok: 0, failed: [], skipped: 'slow' });
    expect((await bank().warm(['/a.webp'])).ok).toBe(1);
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });
});
