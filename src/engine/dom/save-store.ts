import type { SaveStore } from '../core/ports';
import type { GameDef, GameState } from '../core/types';
import { parseSave, saveEnvelope } from '../core/save';

const DB = 'web-scumm-saves';
const STORE = 'slots';

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
});
const transaction = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
});
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;

/**
 * IndexedDB-backed autosave with a synchronously readable cache for the deterministic core.
 * Writes are serialised and verified by reading the committed envelope back. Errors are never swallowed.
 */
export class IndexedDbSaveStore implements SaveStore {
  private value: GameState | null = null;
  private pending: Promise<void> = Promise.resolve();
  private lastError: Error | null = null;
  private constructor(private db: IDBDatabase, private game: GameDef, private fail: (error: Error) => void) {}

  static async open(game: GameDef, fail: (error: Error) => void, warn: (message: string) => void = console.warn): Promise<IndexedDbSaveStore> {
    if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable');
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    const db = await request(open);
    const out = new IndexedDbSaveStore(db, game, fail);
    const tx = db.transaction(STORE, 'readonly');
    const saved = await request(tx.objectStore(STORE).get(`${game.id}:auto`));
    await transaction(tx);
    if (saved !== undefined) out.value = parseSave(game, saved, { warn });
    else {
      // One-time import of the v2 localStorage autosave. It is removed only after IndexedDB verifies the copy.
      let legacy: string | null = null;
      try { legacy = localStorage.getItem(`${game.id}.save`); } catch { /* unavailable localStorage is fine */ }
      if (legacy) {
        out.value = parseSave(game, JSON.parse(legacy), { warn });
        await out.write(out.value);
        try { localStorage.removeItem(`${game.id}.save`); } catch { /* the durable copy already exists */ }
      }
    }
    return out;
  }

  load(): GameState | null { return this.value ? structuredClone(this.value) : null; }

  save(state: GameState): void {
    this.value = structuredClone(state);
    const snapshot = structuredClone(state);
    this.lastError = null;
    this.pending = this.pending.then(() => this.write(snapshot)).catch((e) => {
      this.lastError = e instanceof Error ? e : new Error(String(e));
      this.fail(this.lastError);
    });
  }

  clear(): void {
    this.value = null;
    this.pending = this.pending.then(async () => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(`${this.game.id}:auto`);
      await transaction(tx);
    }).catch((e) => this.fail(e instanceof Error ? e : new Error(String(e))));
  }

  /** Tests and shutdown flows can await the latest verified write. */
  async whenIdle(): Promise<void> {
    await this.pending;
    if (this.lastError) throw this.lastError;
  }

  private async write(state: GameState) {
    const envelope = saveEnvelope(this.game, state);
    const tx = this.db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(envelope, `${this.game.id}:auto`);
    await transaction(tx);
    const checkTx = this.db.transaction(STORE, 'readonly');
    const committed = await request(checkTx.objectStore(STORE).get(`${this.game.id}:auto`));
    await transaction(checkTx);
    const verified = parseSave(this.game, committed);
    if (JSON.stringify(canonical(verified)) !== JSON.stringify(canonical(state))) throw new Error('IndexedDB autosave verification failed');
  }
}
