// Where a game is saved in the browser without IndexedDB: the autosave and the slots in localStorage. (4.1.0 "Clarity", from dom/app.ts.)
import type { SaveStore, SlotMeta, SlotStore } from '../core/ports';
import type { GameDef, GameState } from '../core/types';
import { parseSave, parseSlot, SaveWorldMismatch, saveEnvelope, type SlotRecord } from '../core/save';

/** A state with the music's phase, as a save keeps it (3.6). */
export const withPhase = (s: GameState, phase: { id: string; at: number } | null): GameState => {
  if (!phase) {
    if (!s.music) return s;
    const { music: _, ...rest } = s;
    return rest as GameState;
  }
  return { ...s, music: { id: phase.id, at: Math.round(phase.at * 1000) / 1000 } };
};

export class LocalStore implements SaveStore {
  constructor(
    private key: string,
    private game: GameDef,
    private fail: (error: Error) => void,
    private warn: (message: string) => void,
  ) {}
  load(): GameState | null {
    try {
      const v = localStorage.getItem(this.key);
      return v ? parseSave(this.game, JSON.parse(v), { warn: this.warn }) : null;
    } catch (e) {
      if (e instanceof SaveWorldMismatch) this.warn(e.message);
      else this.fail(e as Error);
      return null;
    }
  }
  save(s: GameState) {
    try {
      // A save of another world (4.1.15) is kept: only `clear()` (the player's choice) makes room for this one.
      const before = localStorage.getItem(this.key);
      if (before)
        try {
          parseSave(this.game, JSON.parse(before), { warn: () => {} });
        } catch (e) {
          if (e instanceof SaveWorldMismatch) throw new Error(`${e.message}; it is kept, not overwritten`);
        }
      const raw = JSON.stringify(saveEnvelope(this.game, s));
      localStorage.setItem(this.key, raw);
      const check = localStorage.getItem(this.key);
      if (!check) throw new Error('the browser did not retain the autosave');
      parseSave(this.game, JSON.parse(check));
    } catch (e) {
      this.fail(e as Error);
    }
  }
  async clear() {
    try {
      localStorage.removeItem(this.key);
      return true;
    } catch (e) {
      this.fail(e as Error);
      return false;
    }
  }
}

/** Manual slots in localStorage (`<game>.slot.<n>`), the fallback when IndexedDB is unavailable; verified like the autosave. */
export class LocalSlotStore implements SlotStore {
  constructor(
    private prefix: string,
    private game: GameDef,
    private fail: (error: Error) => void,
    private warn: (message: string) => void,
  ) {}
  private key(n: number) {
    return `${this.prefix}.slot.${n}`;
  }
  private read(n: number): { meta: SlotMeta; state: GameState } | null {
    try {
      const v = localStorage.getItem(this.key(n));
      return v ? parseSlot(this.game, JSON.parse(v), { warn: this.warn }) : null;
    } catch (e) {
      this.fail(e as Error);
      return null;
    }
  }
  async listSlots(count: number) {
    return Array.from({ length: count }, (_, i) => this.read(i + 1)?.meta ?? null);
  }
  async getSlot(n: number) {
    return this.read(n)?.state ?? null;
  }
  async putSlot(n: number, state: GameState, meta: SlotMeta) {
    try {
      const record: SlotRecord = { meta, envelope: saveEnvelope(this.game, state) };
      const raw = JSON.stringify(record);
      localStorage.setItem(this.key(n), raw);
      if (localStorage.getItem(this.key(n)) !== raw) throw new Error('the browser did not retain the save slot');
      return true;
    } catch (e) {
      this.fail(e as Error);
      return false;
    }
  }
  async clearSlot(n: number) {
    try {
      localStorage.removeItem(this.key(n));
      return true;
    } catch (e) {
      this.fail(e as Error);
      return false;
    }
  }
}
