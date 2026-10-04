/** Catalogue of images and sounds prepared by `npm run assets`. */
export interface AssetManifest {
  images: Record<string, [number, number]>;
  audio?: { music?: Record<string, string>; sfx?: Record<string, string>; voices?: Record<string, string> };
  videos?: Record<string, number>;
}

export class AssetBank {
  private loaded = new Map<string, Promise<void>>();
  private warmed = new Set<string>();
  /** `version` is appended to every URL: a new assets build bypasses the browser's old cache. */
  constructor(readonly manifest: AssetManifest, readonly base = 'assets', readonly version = '') {}

  private v(url: string) { return this.version ? `${url}?v=${this.version}` : url; }
  img(id: string): string { return this.v(`${this.base}/img/${id}.webp`); }
  size(id: string): [number, number] { return this.manifest.images[id] ?? [100, 100]; }
  /** Width for a given height, based on the image's proportions. */
  widthFor(id: string, h: number): number { const [w0, h0] = this.size(id); return (h * w0) / h0; }
  music(file: string) { return this.v(`${this.base}/audio/music/${file}`); }
  sfx(file: string) { return this.v(`${this.base}/audio/sfx/${file}`); }
  voice(file: string) { return this.v(`${this.base}/audio/voices/${file}`); }
  video(file: string) { return this.v(`${this.base}/video/${file}`); }

  /**
   * Downloads in the background (without disrupting the game) files the service worker keeps cached:
   * those nearby assets then show up without waiting and remain available to the service worker. Does nothing in
   * "save data" mode.
   */
  async warm(urls: string[], parallel = 3, o: { heavy?: boolean } = {}): Promise<void> {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g') return;
    // Music and video wait for a decent link: a background download must never fight the room's own loads.
    if (o.heavy && conn?.effectiveType === '3g') return;
    const todo = urls.filter((u) => !this.warmed.has(u));
    todo.forEach((u) => this.warmed.add(u));
    const idle = () => new Promise<void>((r) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(() => r(), { timeout: 1500 }) : setTimeout(r, 50)));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const u = todo[i++];
        await idle();
        try { const res = await fetch(u, { priority: 'low' } as RequestInit); await res.arrayBuffer(); } catch { /* network down: we'll retry later */ this.warmed.delete(u); }
      }
    };
    await Promise.all(Array.from({ length: parallel }, worker));
  }

  /** Preloads images (before entering a room), never failing. */
  preload(ids: Iterable<string>): Promise<void> {
    const all: Promise<void>[] = [];
    for (const id of ids) {
      if (!this.loaded.has(id)) {
        this.loaded.set(id, new Promise((res) => {
          const im = new Image();
          im.onload = im.onerror = () => res();
          im.src = this.img(id);
          // decode() avoids a display jump when the browser allows it
          im.decode?.().then(() => res(), () => res());
        }));
      }
      all.push(this.loaded.get(id)!);
    }
    return Promise.all(all).then(() => undefined);
  }
}
