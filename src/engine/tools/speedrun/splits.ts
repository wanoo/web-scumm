// Splits from the semantic journal (4.1.14 "Time Attack"): a run's start, its splits and its finish are triggers
// (tools/speedrun/triggers.ts) read in the links of the run's tape (core/run-tape.ts). A trigger that fires in a link
// is timed with the clock AFTER that link; the run's origin is the clock BEFORE the link its start fires in. Every
// split fires once; when one fires, the earlier ones that never did are marked missed, and the run goes on: a missed
// split never corrupts an attempt. Times are microticks as decimal strings (`bigint`), the same live and replayed.
import type { SemanticInput } from '../../core/journal';
import type { TapeLink } from '../../core/run-tape';
import type { SpeedrunCategory, SpeedrunManifest } from '../../core/types';
import { matches } from './triggers';

/**
 * A split as a run recorded it: the link it fired in (null: missed), its logical and active times since the run's
 * start, and the RTA milliseconds the player's clock read (null when not timed live).
 * @public
 */
export interface RecordedSplit {
  id: string;
  entry: number | null;
  logicalTime: string | null;
  activeTime: string | null;
  rtaMs: number | null;
}

/** The clock's readings before the first link (the run's origin when the start fires in link 0). */
const ZERO = { logicalTime: '0', activeTime: '0' };

/** What the tracker reports as links come in (the HUD, the overlay, the autosplitter). */
export type SplitSignal =
  | { kind: 'start'; entry: number }
  | { kind: 'split'; split: RecordedSplit }
  | { kind: 'missed'; id: string }
  | { kind: 'finish'; entry: number; logicalTime: string; activeTime: string; rtaMs: number | null };

/** Follows a category's start, splits and finish over the links of a run. */
export class SplitTracker {
  private origin: { logicalTime: bigint; activeTime: bigint; rtaMs: number | null } | null = null;
  private prev: { logicalTime: string; activeTime: string } = ZERO;
  readonly splits: RecordedSplit[];
  private next = 0;
  finish: Extract<SplitSignal, { kind: 'finish' }> | null = null;
  startEntry: number | null = null;

  constructor(
    readonly manifest: SpeedrunManifest,
    readonly category: SpeedrunCategory,
  ) {
    this.splits = manifest.splits.map((s) => ({
      id: s.id,
      entry: null,
      logicalTime: null,
      activeTime: null,
      rtaMs: null,
    }));
  }

  get started(): boolean {
    return this.origin !== null;
  }
  get finished(): boolean {
    return this.finish !== null;
  }

  /** Reads one link (in order): what started, split, was missed or finished in it. `rtaMs`: the live clock now. */
  feed(link: TapeLink, rtaMs: number | null = null): SplitSignal[] {
    const out: SplitSignal[] = [];
    const before = this.prev;
    this.prev = { logicalTime: link.logicalTime, activeTime: link.activeTime };
    if (this.finish) return out;
    for (const e of link.events) {
      if (!this.origin) {
        if (!matches(this.category.start, e)) continue;
        this.origin = { logicalTime: BigInt(before.logicalTime), activeTime: BigInt(before.activeTime), rtaMs };
        this.startEntry = link.index;
        out.push({ kind: 'start', entry: link.index });
        continue;
      }
      this.split(e, link, rtaMs, out);
      if (matches(this.category.finish, e)) {
        const t = this.since(link, rtaMs);
        for (; this.next < this.splits.length; this.next++)
          if (this.splits[this.next]!.entry === null) out.push({ kind: 'missed', id: this.splits[this.next]!.id });
        this.finish = { kind: 'finish', entry: link.index, ...t };
        out.push(this.finish);
        return out;
      }
    }
    return out;
  }

  private since(link: TapeLink, rtaMs: number | null) {
    const o = this.origin!;
    return {
      logicalTime: (BigInt(link.logicalTime) - o.logicalTime).toString(),
      activeTime: (BigInt(link.activeTime) - o.activeTime).toString(),
      rtaMs: rtaMs !== null && o.rtaMs !== null ? Math.round(rtaMs - o.rtaMs) : null,
    };
  }

  private split(e: SemanticInput, link: TapeLink, rtaMs: number | null, out: SplitSignal[]) {
    const defs = this.manifest.splits;
    for (let i = this.next; i < defs.length; i++) {
      if (!matches(defs[i]!.at, e)) continue;
      for (let k = this.next; k < i; k++) out.push({ kind: 'missed', id: defs[k]!.id });
      const s = this.splits[i]!;
      Object.assign(s, { entry: link.index, ...this.since(link, rtaMs) });
      this.next = i + 1;
      out.push({ kind: 'split', split: { ...s } });
      return;
    }
  }
}

/** The time a category is ranked on, from a split or a finish (microticks; RTA milliseconds become microticks). */
export function rankedTime(
  category: Pick<SpeedrunCategory, 'timing'>,
  t: { logicalTime: string | null; activeTime: string | null; rtaMs: number | null },
): bigint | null {
  if (category.timing === 'rta') return t.rtaMs === null ? null : BigInt(t.rtaMs) * 1000n;
  const v = category.timing === 'igt' ? t.logicalTime : t.activeTime;
  return v === null ? null : BigInt(v);
}

/** A time in microticks as `m:ss.mmm` (`h:mm:ss.mmm` past an hour). */
export function formatTime(us: bigint | null): string {
  if (us === null) return '—';
  const neg = us < 0n;
  const ms = Number((neg ? -us : us) / 1000n);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = String(ms % 1000).padStart(3, '0');
  const body = h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${f}`
    : `${m}:${String(s).padStart(2, '0')}.${f}`;
  return `${neg ? '−' : ''}${body}`;
}

/** A difference against a comparison, signed (`+1.234` behind, `−0.500` ahead), in seconds. */
export function formatDelta(us: bigint | null): string {
  if (us === null) return '';
  const ms = Number(us / 1000n);
  return `${ms > 0 ? '+' : ms < 0 ? '−' : '±'}${(Math.abs(ms) / 1000).toFixed(3)}`;
}
