import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbSaveStore } from '@engine/dom/save-store';
import { Engine } from '@engine/core/engine';
import { FakePresenter, MemoryStore } from '@engine/core/ports';
import { saveEnvelope } from '@engine/core/save';
import type { GameState } from '@engine/core/types';
import { mini, miniLayouts } from './fixtures/mini';

// A localStorage for node: the store imports v2 saves from it once.
const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memory.set(k, String(v));
  },
  removeItem: (k: string) => {
    memory.delete(k);
  },
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;

async function played(): Promise<{ game: ReturnType<typeof mini>; state: GameState }> {
  const game = mini();
  game.saves = { slots: 2 };
  const e = new Engine(game, miniLayouts, new FakePresenter(), new MemoryStore());
  await e.newGame();
  return { game, state: structuredClone(e.state) };
}

describe('IndexedDbSaveStore', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    memory.clear();
  });

  it('writes the autosave, verifies it, and reads it back after a reopen', async () => {
    const { game, state } = await played();
    const errors: Error[] = [];
    const store = await IndexedDbSaveStore.open(game, (e) => errors.push(e));
    expect(store.load()).toBeNull();
    store.save(state);
    await store.whenIdle();
    expect(errors).toEqual([]);
    const again = await IndexedDbSaveStore.open(game, (e) => errors.push(e));
    expect(again.load()).toEqual(state);
  });

  it('imports the v2 localStorage autosave and slots once, removing them only after the verified copy', async () => {
    const { game, state } = await played();
    memory.set(`${game.id}.save`, JSON.stringify(state));
    memory.set(
      `${game.id}.slot.2`,
      JSON.stringify({ meta: { at: 5, room: state.room, roomName: 'A', v: state.v }, state }),
    );
    const store = await IndexedDbSaveStore.open(game, (e) => {
      throw e;
    });
    expect(store.load()).toEqual(state);
    expect(memory.has(`${game.id}.save`)).toBe(false);
    expect(memory.has(`${game.id}.slot.2`)).toBe(false);
    expect(await store.listSlots(2)).toMatchObject([null, { at: 5, roomName: 'A' }]);
    expect(await store.getSlot(2)).toEqual(state);
  });

  it('round-trips a slot, lists it, clears it', async () => {
    const { game, state } = await played();
    const store = await IndexedDbSaveStore.open(game, (e) => {
      throw e;
    });
    expect(await store.putSlot(1, state, { at: 7, room: state.room, roomName: 'Room A', v: state.v })).toBe(true);
    expect(await store.listSlots(2)).toMatchObject([{ at: 7, roomName: 'Room A' }, null]);
    expect(await store.getSlot(1)).toEqual(state);
    await store.clearSlot(1);
    expect(await store.listSlots(2)).toEqual([null, null]);
    expect(await store.getSlot(1)).toBeNull();
  });

  it('reports a slot of another game instead of loading it', async () => {
    const { game, state } = await played();
    await IndexedDbSaveStore.open(game, () => undefined);
    // A record written by another game under this game's key (a corrupted or copied database).
    const foreign = {
      meta: { at: 1, room: state.room, roomName: 'x', v: state.v },
      envelope: { ...saveEnvelope(game, state), gameId: 'other' },
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('web-scumm-saves', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('slots', 'readwrite');
      tx.objectStore('slots').put(foreign, `${game.id}:slot:1`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const errors: Error[] = [];
    const reopened = await IndexedDbSaveStore.open(game, (e) => errors.push(e));
    expect(await reopened.getSlot(1)).toBeNull();
    expect(errors[0]?.message).toMatch(/belongs to game/);
  });

  it('whenIdle rejects when a write fails, and the failure is reported', async () => {
    const { game, state } = await played();
    const errors: Error[] = [];
    const store = await IndexedDbSaveStore.open(game, (e) => errors.push(e));
    store.save({ ...state, inventory: ['no_such_item'] } as GameState);
    await expect(store.whenIdle()).rejects.toThrow();
    expect(errors.length).toBe(1);
  });
});

describe('IndexedDbSaveStore: when the browser refuses', () => {
  const fails = () => {
    const out: Error[] = [];
    return { out, fail: (e: Error) => out.push(e) };
  };
  const quota = () =>
    Object.assign(new Error('QuotaExceededError: the quota has been exceeded'), { name: 'QuotaExceededError' });

  it('a write refused for quota: whenIdle rejects, the failure is reported, the cache keeps the state', async () => {
    const { out, fail } = fails();
    const store = await IndexedDbSaveStore.open(mini(), fail);
    const e = new Engine(mini(), miniLayouts, new FakePresenter(), store);
    await e.newGame();
    await store.whenIdle();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw quota();
    };
    try {
      e.state.flags.after_quota = true;
      store.save(e.state);
      await expect(store.whenIdle()).rejects.toThrow(/Quota/);
      expect(out.map((x) => x.name)).toEqual(['QuotaExceededError']);
      expect(store.load()?.flags.after_quota).toBe(true); // the in-page cache still answers; the durable copy is the previous one
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });

  it('a refused deletion: clear() is false, the save stays, clearSlot() is false', async () => {
    const { out, fail } = fails();
    const game = mini();
    game.saves = { slots: 1 };
    const store = await IndexedDbSaveStore.open(game, fail);
    const e = new Engine(game, miniLayouts, new FakePresenter(), store);
    await e.newGame();
    await store.whenIdle();
    expect(await store.putSlot(1, e.state, { at: 1, room: e.state.room, roomName: 'R', v: e.state.v })).toBe(true);
    const del = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () {
      throw new Error('read-only database');
    };
    try {
      expect(await store.clear()).toBe(false);
      expect(store.load()).not.toBeNull();
      await expect(store.whenIdle()).rejects.toThrow(/read-only/);
      expect(await store.clearSlot(1)).toBe(false);
      expect(await store.getSlot(1)).not.toBeNull();
      expect(out.length).toBe(2);
    } finally {
      IDBObjectStore.prototype.delete = del;
    }
    expect(await store.clear()).toBe(true);
    expect(store.load()).toBeNull();
  });
});
