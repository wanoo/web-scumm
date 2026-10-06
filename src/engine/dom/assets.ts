import { must } from '../core/must';

/** Catalogue of images and sounds prepared by `npm run assets`. */
export interface AssetManifest {
  images: Record<string, [number, number]>;
  audio?: { music?: Record<string, string>; sfx?: Record<string, string>; voices?: Record<string, string> };
  videos?: Record<string, number>;
}

/** What a background warm-up did: files now in the cache (fetched or already there), files that failed, or why it was skipped. */
export interface WarmResult {
  ok: number;
  failed: string[];
  skipped: 'save-data' | 'slow' | null;
}

export class AssetBank {
  private loaded = new Map<string, Promise<void>>();
  private warmed = new Set<string>();
  /** `version` is appended to every URL: a new assets build bypasses the browser's old cache. */
  constructor(
    readonly manifest: AssetManifest,
    readonly base = 'assets',
    readonly version = '',
  ) {}

  private v(url: string) {
    return this.version ? `${url}?v=${this.version}` : url;
  }
  img(id: string): string {
    return this.v(`${this.base}/img/${id}.webp`);
  }
  size(id: string): [number, number] {
    return this.manifest.images[id] ?? [100, 100];
  }
  /** Width for a given height, based on the image's proportions. */
  widthFor(id: string, h: number): number {
    const [w0, h0] = this.size(id);
    return (h * w0) / h0;
  }
  music(file: string) {
    return this.v(`${this.base}/audio/music/${file}`);
  }
  sfx(file: string) {
    return this.v(`${this.base}/audio/sfx/${file}`);
  }
  voice(file: string) {
    return this.v(`${this.base}/audio/voices/${file}`);
  }
  video(file: string) {
    return this.v(`${this.base}/video/${file}`);
  }

  /**
   * Downloads in the background (without disrupting the game) files the service worker keeps cached: those nearby
   * assets then show up without waiting and remain available to the service worker. Says what it did: a file already
   * in the cache counts as done without a fetch (that is how a warm-up resumes after a reload), a response that is not
   * `ok` or a network error is a failure (the file will be tried again), and nothing is fetched in "save data" mode or
   * on a 2G link (`skipped`). Music and video also wait for better than 3G.
   */
  async warm(urls: string[], parallel = 3, o: { heavy?: boolean } = {}): Promise<WarmResult> {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g')
      return { ok: 0, failed: [], skipped: 'save-data' };
    // Music and video wait for a decent link: a background download must never fight the room's own loads.
    if (o.heavy && conn?.effectiveType === '3g') return { ok: 0, failed: [], skipped: 'slow' };
    const result: WarmResult = { ok: urls.filter((u) => this.warmed.has(u)).length, failed: [], skipped: null };
    const todo = urls.filter((u) => !this.warmed.has(u));
    todo.forEach((u) => this.warmed.add(u));
    const idle = () =>
      new Promise<void>((r) =>
        typeof window.requestIdleCallback === 'function'
          ? window.requestIdleCallback(() => r(), { timeout: 1500 })
          : setTimeout(r, 50),
      );
    const cached = async (u: string) => {
      try {
        return 'caches' in globalThis && !!(await caches.match(u));
      } catch {
        return false;
      }
    };
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const u = must(todo[i++], 'warm-up url'); // i < todo.length, checked above
        await idle();
        if (await cached(u)) {
          result.ok++;
          continue;
        }
        try {
          const res = await fetch(u, { priority: 'low' } as RequestInit);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await res.arrayBuffer();
          result.ok++;
        } catch {
          /* network down or a missing file: tried again on the next warm-up */ this.warmed.delete(u);
          result.failed.push(u);
        }
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
    return result;
  }

  /** Preloads images (before entering a room), never failing. */
  preload(ids: Iterable<string>): Promise<void> {
    const all: Promise<void>[] = [];
    for (const id of ids) {
      if (!this.loaded.has(id)) {
        this.loaded.set(
          id,
          new Promise((res) => {
            const im = new Image();
            im.onload = im.onerror = () => res();
            im.src = this.img(id);
            // decode() avoids a display jump when the browser allows it
            im.decode?.().then(
              () => res(),
              () => res(),
            );
          }),
        );
      }
      all.push(this.loaded.get(id)!);
    }
    return Promise.all(all).then(() => undefined);
  }
}
