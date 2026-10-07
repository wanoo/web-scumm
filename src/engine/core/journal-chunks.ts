// The chunked, chained journal of a run (4.1.14 "Time Attack", ADR 0016): the tape's links (core/run-tape.ts) go into
// chunks of `CHUNK_SIZE` (= SESSION_MAX) entries, each link hashed onto the one before it
// (`Hn = sha256(Hn-1 ‖ canonicalJson(payload))`), each chunk carrying the hash before its first link (`prevHash`) and
// after its last (`hash`). Only the current chunk is kept in memory; a closed chunk is written with the run's head in
// one transaction of a `ChunkStore` (IndexedDB in the browser, `dom/run-store.ts`; memory in tests and Node), and read
// back by recomputing its chain: the last chunk that checks is where a run resumes after a crash.
import { canonicalJson } from './canonical';
import { SESSION_MAX } from './engine-shared';
import { sha256Hex } from './fingerprint';
import type { TapeLink } from './run-tape';

/** Entries per chunk: the session's own limit (ADR 0016). */
export const CHUNK_SIZE = SESSION_MAX;

/** A closed chunk as a store keeps it: its links in full, so its hashes can be recomputed on read. */
export interface StoredChunk {
  index: number;
  prevHash: string;
  hash: string;
  links: TapeLink[];
}

/** What a run's head records at each chunk's close (plain data, structured-clonable). */
export interface RunHead<R = unknown> {
  runId: string;
  /** How many chunks are closed and stored. */
  chunks: number;
  /** The chain's hash after the last stored chunk (H0 when none). */
  lastHash: string;
  h0: string;
  /** What the host needs to resume at the end of the last stored chunk (state, clock, draws…). */
  resume?: R;
  /** Set when the run was sealed (finished or abandoned): never resumed. */
  sealed?: 'finished' | 'abandoned';
  updatedAt: number;
}

/** Where chunks go: one atomic write per close (the chunk and the head together, or neither). */
export interface ChunkStore {
  putChunk(chunk: StoredChunk, head: RunHead): Promise<void>;
  putHead(head: RunHead): Promise<void>;
  head(runId: string): Promise<RunHead | undefined>;
  chunks(runId: string): Promise<StoredChunk[]>;
  /** The runs with a head, latest first. */
  runs(): Promise<RunHead[]>;
  deleteRun(runId: string): Promise<void>;
}

/** What one link's hash covers: the entry without its digest, its draws, its events, the clock after it. */
export function linkPayload(l: TapeLink): unknown {
  const { digest: _d, rnd, ...entry } = l.entry;
  return { entry, rnd: rnd ?? [], events: l.events, logicalSteps: l.logicalSteps, logicalTime: l.logicalTime };
}

/** One step of the chain: `sha256(prev ‖ canonicalJson(payload))`. */
export function chainStep(prev: string, l: TapeLink): Promise<string> {
  return sha256Hex(prev + canonicalJson(linkPayload(l)));
}

/** Recomputes a chunk's chain from `prevHash`: the hash it ends on, or null when it does not end on `hash`. */
export async function checkChunk(c: StoredChunk): Promise<string | null> {
  let h = c.prevHash;
  for (const l of c.links) h = await chainStep(h, l);
  return h === c.hash ? h : null;
}

/** A run's journal being written: links in, chunks out, the chain kept. Writes are queued, one at a time. */
export class ChunkedJournal<R = unknown> {
  private buffer: TapeLink[] = [];
  private chunkPrev: string;
  private hash: string;
  private closed: number;
  private queue: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  /** Every hash of the chain computed so far is in order: the last one is `lastHash` once the queue is idle. */
  private hashing: Promise<void> = Promise.resolve();

  constructor(
    private store: ChunkStore,
    readonly runId: string,
    readonly h0: string,
    /** Resuming: the chunks already stored and the hash they end on. */
    from: { chunks: number; lastHash: string } = { chunks: 0, lastHash: h0 },
    /** What the head records at each close, so the run can resume there (taken when the chunk closes). */
    private resume: () => R | undefined = () => undefined,
    private now: () => number = () => Date.now(),
  ) {
    this.closed = from.chunks;
    this.chunkPrev = from.lastHash;
    this.hash = from.lastHash;
  }

  /** The links of the chunk in progress (never more than `CHUNK_SIZE`). */
  get current(): readonly TapeLink[] {
    return this.buffer;
  }
  /** Chunks closed so far. */
  get chunks(): number {
    return this.closed;
  }
  /** The last write that failed, if any (the run's head stays at the chunk before it). */
  get error(): Error | null {
    return this.failure;
  }

  /** Adds a link: hashed onto the chain; the chunk closes (and is written) when it is full. */
  push(l: TapeLink): void {
    this.buffer.push(l);
    this.hashing = this.hashing.then(async () => {
      this.hash = await chainStep(this.hash, l);
    });
    if (this.buffer.length >= CHUNK_SIZE) this.close();
  }

  /** Closes the chunk in progress now (a full chunk; the run's end). */
  private close(sealed?: RunHead['sealed']): Promise<void> {
    const links = this.buffer;
    this.buffer = [];
    const index = this.closed;
    if (links.length) this.closed++;
    const resume = links.length && !sealed ? this.resume() : undefined;
    // Read when the hashes before it are done (closes run in order): the previous chunk's end.
    const done = this.hashing.then(async () => {
      const prevHash = this.chunkPrev;
      const hash = this.hash;
      this.chunkPrev = hash;
      const head: RunHead = {
        runId: this.runId,
        chunks: links.length ? index + 1 : index,
        lastHash: hash,
        h0: this.h0,
        ...(resume !== undefined ? { resume } : {}),
        ...(sealed ? { sealed } : {}),
        updatedAt: this.now(),
      };
      if (links.length) await this.store.putChunk({ index, prevHash, hash, links }, head);
      else await this.store.putHead(head);
    });
    this.queue = this.queue.then(
      () => done,
      () => done,
    );
    this.queue = this.queue.catch((e) => {
      this.failure = e instanceof Error ? e : new Error(String(e));
    });
    return this.queue;
  }

  /** The hash after every link pushed so far. */
  async lastHash(): Promise<string> {
    await this.hashing;
    return this.hash;
  }

  /** Writes the last (partial) chunk and marks the run sealed. */
  async seal(how: NonNullable<RunHead['sealed']>): Promise<void> {
    await this.close(how);
    if (this.failure) throw this.failure;
  }

  /** Waits for every write queued so far. */
  async idle(): Promise<void> {
    await this.queue;
  }
}

/**
 * Reads a run back: its chunks checked in order from H0, kept up to the first that does not chain (a write cut short,
 * a chunk altered). `ok` is false when one was dropped.
 */
export async function readRun(
  store: ChunkStore,
  runId: string,
): Promise<{ head: RunHead; chunks: StoredChunk[]; lastHash: string; ok: boolean } | null> {
  const head = await store.head(runId);
  if (!head) return null;
  const all = (await store.chunks(runId)).sort((a, b) => a.index - b.index);
  const chunks: StoredChunk[] = [];
  let prev = head.h0;
  for (const c of all) {
    if (c.index !== chunks.length || c.prevHash !== prev) break;
    const h = await checkChunk(c);
    if (!h) break;
    chunks.push(c);
    prev = h;
  }
  return { head, chunks, lastHash: prev, ok: chunks.length === all.length && chunks.length === head.chunks };
}

/** A store in memory (Node, the tests, a host without IndexedDB). Each write is atomic by construction. */
export class MemoryChunkStore implements ChunkStore {
  private heads = new Map<string, RunHead>();
  private data = new Map<string, StoredChunk[]>();

  async putChunk(chunk: StoredChunk, head: RunHead): Promise<void> {
    const list = this.data.get(head.runId) ?? [];
    list[chunk.index] = structuredClone(chunk);
    this.data.set(head.runId, list);
    this.heads.set(head.runId, structuredClone(head));
  }
  async putHead(head: RunHead): Promise<void> {
    this.heads.set(head.runId, structuredClone(head));
  }
  async head(runId: string): Promise<RunHead | undefined> {
    const h = this.heads.get(runId);
    return h ? structuredClone(h) : undefined;
  }
  async chunks(runId: string): Promise<StoredChunk[]> {
    return structuredClone((this.data.get(runId) ?? []).filter(Boolean));
  }
  async runs(): Promise<RunHead[]> {
    return [...this.heads.values()].sort((a, b) => b.updatedAt - a.updatedAt).map((h) => structuredClone(h));
  }
  async deleteRun(runId: string): Promise<void> {
    this.heads.delete(runId);
    this.data.delete(runId);
  }
}
