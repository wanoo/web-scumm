// The Bridge's stores (bridge/src/store.ts) driven directly, without a Bridge: what an event does to the state, the
// journal file (a pairing's secret, `forget`'s rewrite, `compact`'s retention, the lock), `inspectJournal`, and the
// one-process `JournalLock`. Each test says which mutant of the reality mutation set it kills.
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aboutPlayer,
  type BridgeEvent,
  inspectJournal,
  type JournalEntry,
  JournalLock,
  JsonlBridgeStore,
  MemoryBridgeStore,
  type Pairing,
  type Player,
} from '../bridge/src/store';

const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A fresh journal path in its own temp dir (removed in `afterAll`). */
function journalPath(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `bridge-store-${name}-`));
  temps.push(dir);
  return join(dir, 'journal.jsonl');
}

const HASH = 'ab'.repeat(32);
function player(playerId: string): Player {
  return { playerId, gameId: 'signals', capabilityHash: HASH, capabilityExpiresAt: 1_000 };
}
function pairing(code: string, playerId?: string, expiresAt = 1_000): Pairing {
  const p: Pairing = { code, gameId: 'signals', expiresAt };
  if (playerId) p.playerId = playerId;
  return p;
}
function entry(playerId: string, sequence: number, at = 0): JournalEntry {
  return { playerId, sequence, id: `${playerId}-${sequence}`, dedupeKey: `k-${sequence}`, jws: 'a.b.c', at };
}
const line = (e: BridgeEvent) => `${JSON.stringify(e)}\n`;
/** The events of a journal file, as written. */
function lines(file: string): BridgeEvent[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as BridgeEvent);
}
const sequences = (j: JournalEntry[]) => j.map((e) => e.sequence);

describe('MemoryBridgeStore', () => {
  it('a pairing written is read back by its code', () => {
    // kills store.ts:159 condition false
    const store = new MemoryBridgeStore();
    store.write({ t: 'pairing', p: { ...pairing('c-1'), capability: 'secret' } });
    expect(store.pairing('c-1')).toEqual({ ...pairing('c-1'), capability: 'secret' });
    expect(store.pairing('c-2')).toBeUndefined();
  });

  it('forget deletes the pairings of that player, and only those', () => {
    // kills store.ts:171 condition true, condition false, === → !==
    const store = new MemoryBridgeStore();
    store.write({ t: 'pairing', p: pairing('c-a', 'a') });
    store.write({ t: 'pairing', p: pairing('c-b', 'b') });
    store.write({ t: 'pairing', p: pairing('c-open') });
    store.write({ t: 'player', p: player('a') });
    store.write({ t: 'forget', playerId: 'a' });
    expect(store.pairing('c-a')).toBeUndefined();
    expect(store.pairing('c-b')).toEqual(pairing('c-b', 'b'));
    expect(store.pairing('c-open')).toEqual(pairing('c-open'));
    expect(store.player('a')).toBeUndefined();
  });
});

describe('aboutPlayer', () => {
  it('says which events a forget removes: the pairing, player, signals and acks of that player; never a revocation', () => {
    // kills store.ts:180 condition true; 181 condition true, === → !==, false → true; 182 === → !==
    expect(aboutPlayer({ t: 'pairing', p: pairing('c-a', 'a') }, 'a')).toBe(true);
    expect(aboutPlayer({ t: 'pairing', p: pairing('c-b', 'b') }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'pairing', p: pairing('c-open') }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'player', p: player('a') }, 'a')).toBe(true);
    expect(aboutPlayer({ t: 'player', p: player('b') }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'signal', e: entry('a', 1) }, 'a')).toBe(true);
    expect(aboutPlayer({ t: 'signal', e: entry('b', 1) }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'ack', playerId: 'a', through: 1 }, 'a')).toBe(true);
    expect(aboutPlayer({ t: 'ack', playerId: 'b', through: 1 }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'forget', playerId: 'a' }, 'a')).toBe(true);
    expect(aboutPlayer({ t: 'forget', playerId: 'b' }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'revoke-token', id: 'tok-1' }, 'a')).toBe(false);
    expect(aboutPlayer({ t: 'revoke-token', id: 'a' }, 'a')).toBe(false);
  });
});

describe('JsonlBridgeStore: the journal file', () => {
  it("a pairing's capability is held in memory and never written", () => {
    // kills store.ts:363 condition false
    const file = journalPath('capability');
    const store = new JsonlBridgeStore(file, { lock: false });
    store.write({ t: 'pairing', p: { ...pairing('c-1', 'a'), capability: 'the-secret-capability' } });
    expect(store.pairing('c-1')?.capability).toBe('the-secret-capability');
    expect(readFileSync(file, 'utf8')).not.toContain('the-secret-capability');
    expect(lines(file)).toEqual([{ t: 'pairing', p: pairing('c-1', 'a') }]);
    const reopened = new JsonlBridgeStore(file, { lock: false });
    expect(reopened.pairing('c-1')).toEqual(pairing('c-1', 'a'));
  });

  it('forget rewrites the journal without any line about the player: the others and the revocations stay, in order', () => {
    // kills store.ts:180 condition true; 181 condition true, === → !==, false → true; 182 === → !== (on the file)
    const file = journalPath('forget');
    const kept: BridgeEvent[] = [
      { t: 'pairing', p: pairing('c-b', 'b') },
      { t: 'pairing', p: pairing('c-open') },
      { t: 'player', p: player('b') },
      { t: 'signal', e: entry('b', 1) },
      { t: 'ack', playerId: 'b', through: 1 },
      { t: 'revoke-token', id: 'tok-1' },
    ];
    const gone: BridgeEvent[] = [
      { t: 'pairing', p: pairing('c-a', 'a') },
      { t: 'player', p: player('a') },
      { t: 'signal', e: entry('a', 1) },
      { t: 'signal', e: entry('a', 2) },
      { t: 'ack', playerId: 'a', through: 2 },
    ];
    writeFileSync(file, [...kept.slice(0, 3), ...gone, ...kept.slice(3)].map((e) => line(e)).join(''));
    const store = new JsonlBridgeStore(file, { lock: false });
    expect(store.acked('a')).toBe(2);
    store.write({ t: 'forget', playerId: 'a' });
    expect(lines(file)).toEqual(kept);
    expect(store.player('a')).toBeUndefined();
    expect(store.signals('a', 0)).toEqual([]);
    expect(store.acked('a')).toBe(0);
    expect(store.pairing('c-a')).toBeUndefined();
    expect(store.player('b')).toEqual(player('b'));
    expect(store.acked('b')).toBe(1);
    expect(store.tokenRevoked('tok-1')).toBe(true);
  });

  it('a line that does not parse while forgetting is named by its number', () => {
    // kills store.ts:359 + → -
    const file = journalPath('forget-corrupt');
    writeFileSync(file, line({ t: 'player', p: player('a') }));
    const store = new JsonlBridgeStore(file, { lock: false });
    appendFileSync(file, 'not an event\n');
    expect(() => store.write({ t: 'forget', playerId: 'b' })).toThrow(/^journal line 2 is not an event/);
  });

  it('a journal whose last line is complete, or followed by blanks only, is not repaired', () => {
    // kills store.ts:340 condition false; 308 condition true
    const repairs: string[] = [];
    const clean = journalPath('clean');
    writeFileSync(clean, line({ t: 'player', p: player('a') }));
    new JsonlBridgeStore(clean, { lock: false, onRepair: (w) => repairs.push(w) });
    expect(repairs).toEqual([]);
    const blanks = journalPath('blanks');
    const text = `${line({ t: 'player', p: player('a') })}  \n\n `;
    writeFileSync(blanks, text);
    const store = new JsonlBridgeStore(blanks, { lock: false, onRepair: (w) => repairs.push(w) });
    expect(repairs).toEqual([]);
    expect(readFileSync(blanks, 'utf8')).toBe(text);
    expect(store.player('a')).toEqual(player('a'));
  });

  it('a torn last line is dropped, its byte count said', () => {
    const repairs: string[] = [];
    const file = journalPath('torn');
    const whole = line({ t: 'player', p: player('a') });
    writeFileSync(file, `${whole}{"t":"sig`);
    new JsonlBridgeStore(file, { lock: false, onRepair: (w) => repairs.push(w) });
    expect(repairs).toEqual(['a last line cut short by a crash (9 bytes) was dropped']);
    expect(readFileSync(file, 'utf8')).toBe(whole);
  });

  it('`lock: false` takes no lock at all', () => {
    // kills store.ts:325 condition true, false → true
    const file = journalPath('nolock');
    new JsonlBridgeStore(file, { lock: false });
    expect(existsSync(`${file}.lock`)).toBe(false);
  });

  it('a JournalLock passed in is the one taken and released', () => {
    // kills store.ts:327 condition false
    const file = journalPath('ownlock');
    const lock = new JournalLock(file, { pid: 4242, alive: () => true });
    const store = new JsonlBridgeStore(file, { lock });
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe('4242');
    store.close();
    expect(existsSync(`${file}.lock`)).toBe(false);
  });
});

describe('JsonlBridgeStore.compact', () => {
  it('keeps a pairing until its expiry, inclusive', () => {
    // kills store.ts:385 condition true, condition false, >= → >
    const file = journalPath('compact-pairings');
    const store = new JsonlBridgeStore(file, { lock: false });
    store.write({ t: 'pairing', p: pairing('c-past', undefined, 9_999) });
    store.write({ t: 'pairing', p: pairing('c-now', undefined, 10_000) });
    store.write({ t: 'pairing', p: pairing('c-later', undefined, 10_001) });
    expect(store.compact({ now: 10_000, retentionMs: 1_000 })).toEqual({ before: 3, after: 2 });
    expect(lines(file)).toEqual([
      { t: 'pairing', p: pairing('c-now', undefined, 10_000) },
      { t: 'pairing', p: pairing('c-later', undefined, 10_001) },
    ]);
  });

  it('drops the signals acknowledged and older than the retention; the last one always stays', () => {
    // kills store.ts:390 first || → &&, second || → &&, === → !==, first - → +, > → >=
    const file = journalPath('compact-signals');
    const store = new JsonlBridgeStore(file, { lock: false });
    // Player a: one signal past the acknowledgement; player b: all acknowledged, the last one stays anyway.
    store.write({ t: 'player', p: player('a') });
    for (const s of [1, 2, 3]) store.write({ t: 'signal', e: entry('a', s, 0) });
    store.write({ t: 'ack', playerId: 'a', through: 2 });
    for (const s of [1, 2]) store.write({ t: 'signal', e: entry('b', s, 0) });
    store.write({ t: 'ack', playerId: 'b', through: 2 });
    expect(store.compact({ now: 10_000, retentionMs: 1_000 })).toEqual({ before: 8, after: 5 });
    expect(sequences(store.signals('a', 0))).toEqual([3]);
    expect(sequences(store.signals('b', 0))).toEqual([2]);
    expect(store.lastSequence('a')).toBe(3);
    expect(store.lastSequence('b')).toBe(2);
    expect(lines(file)).toEqual([
      { t: 'player', p: player('a') },
      { t: 'signal', e: entry('a', 3, 0) },
      { t: 'ack', playerId: 'a', through: 2 },
      { t: 'signal', e: entry('b', 2, 0) },
      { t: 'ack', playerId: 'b', through: 2 },
    ]);
    const reopened = new JsonlBridgeStore(file, { lock: false });
    expect(sequences(reopened.signals('a', 0))).toEqual([3]);
    expect(sequences(reopened.signals('b', 0))).toEqual([2]);
    expect(reopened.acked('a')).toBe(2);
  });

  it('a signal exactly at the retention boundary is kept, acknowledged or not', () => {
    // kills store.ts:390 >= → >, second - → +
    const file = journalPath('compact-boundary');
    const store = new JsonlBridgeStore(file, { lock: false });
    store.write({ t: 'signal', e: entry('a', 1, 9_000) });
    store.write({ t: 'signal', e: entry('a', 2, 10_000) });
    store.write({ t: 'ack', playerId: 'a', through: 2 });
    expect(store.compact({ now: 10_000, retentionMs: 1_000 })).toEqual({ before: 3, after: 3 });
    expect(sequences(store.signals('a', 0))).toEqual([1, 2]);
    expect(sequences(new JsonlBridgeStore(file, { lock: false }).signals('a', 0))).toEqual([1, 2]);
  });

  it('writes no ack line for a player who acknowledged nothing', () => {
    // kills store.ts:393 condition true
    const file = journalPath('compact-noack');
    const store = new JsonlBridgeStore(file, { lock: false });
    store.write({ t: 'player', p: player('a') });
    store.write({ t: 'signal', e: entry('a', 1, 0) });
    expect(store.compact({ now: 10_000, retentionMs: 1_000 })).toEqual({ before: 2, after: 2 });
    expect(lines(file).map((e) => e.t)).toEqual(['player', 'signal']);
  });
});

describe('inspectJournal', () => {
  it('counts the players still linked and the signals, and names the first corrupt line by its number', () => {
    // kills store.ts:284 + → -; 286 === → !==; 287 condition true, condition false, === → !==
    const file = journalPath('inspect');
    writeFileSync(
      file,
      [
        line({ t: 'player', p: player('a') }),
        line({ t: 'player', p: player('b') }),
        line({ t: 'player', p: player('c') }),
        'not an event\n',
        line({ t: 'signal', e: entry('a', 1) }),
        line({ t: 'signal', e: entry('b', 1) }),
        line({ t: 'ack', playerId: 'a', through: 1 }),
        line({ t: 'ack', playerId: 'c', through: 1 }),
        line({ t: 'revoke-token', id: 'tok-1' }),
        line({ t: 'forget', playerId: 'b' }),
        '{"t":"ack"\n',
      ].join(''),
    );
    const r = inspectJournal(file);
    expect(r.lines).toBe(11);
    expect(r.players).toBe(2);
    expect(r.signals).toBe(2);
    expect(r.torn).toBe(false);
    expect(r.corrupt).toMatch(/^journal line 4 is not an event/);
  });

  it('a last line without its newline is counted when it parses, torn when it does not', () => {
    // kills store.ts:293 condition false; 298 true → false
    const whole = journalPath('inspect-whole');
    writeFileSync(
      whole,
      `${line({ t: 'player', p: player('a') })}${JSON.stringify({ t: 'signal', e: entry('a', 1) })}`,
    );
    // A whole tail line is counted among the lines, not among what it holds (it is parsed, not applied).
    expect(inspectJournal(whole)).toEqual({ lines: 2, players: 1, signals: 0, torn: false });
    const torn = journalPath('inspect-torn');
    writeFileSync(torn, `${line({ t: 'player', p: player('a') })}{"t":"sig`);
    expect(inspectJournal(torn)).toEqual({ lines: 1, players: 1, signals: 0, torn: true });
  });

  it('blanks after the last newline are not a torn line', () => {
    // kills store.ts:308 condition true
    const file = journalPath('inspect-blanks');
    writeFileSync(file, `${line({ t: 'player', p: player('a') })}  `);
    expect(inspectJournal(file)).toEqual({ lines: 1, players: 1, signals: 0, torn: false });
  });
});

describe('JournalLock', () => {
  it('a lock never acquired releases nothing: another process’s lock file stays', () => {
    // kills store.ts:209 false → true; 254 condition false
    const file = journalPath('lock-unheld');
    new JournalLock(file, { pid: 1234, alive: () => true }).acquire();
    new JournalLock(file, { pid: 5678, alive: () => true }).release();
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe('1234');
  });

  it('a lock released once is released for good: it does not remove what another took since', () => {
    // kills store.ts:255 false → true
    const file = journalPath('lock-released');
    const first = new JournalLock(file, { pid: 1234, alive: () => true });
    first.acquire();
    first.release();
    new JournalLock(file, { pid: 5678, alive: () => true }).acquire();
    first.release();
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe('5678');
  });

  it('the default liveness check: this process is alive, a pid that does not exist is not', () => {
    // kills store.ts:223 true → false; 225 === → !==
    const file = journalPath('lock-alive');
    new JournalLock(file).acquire();
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe(String(process.pid));
    expect(() => new JournalLock(file, { pid: 4321 }).acquire()).toThrow(
      new RegExp(`journal in use by process ${process.pid} `),
    );
    const taken: number[] = [];
    writeFileSync(`${file}.lock`, '2147483647\n');
    new JournalLock(file, { pid: 4321, onTakeover: (pid) => taken.push(pid) }).acquire();
    expect(taken).toEqual([2147483647]);
    expect(readFileSync(`${file}.lock`, 'utf8').trim()).toBe('4321');
  });

  it.skipIf(process.platform === 'win32')(
    'the default liveness check: a process we may not signal (pid 1) is alive',
    () => {
      // kills store.ts:225 === → !== (EPERM, when not root); 223 true → false (as root)
      const file = journalPath('lock-eperm');
      writeFileSync(`${file}.lock`, '1\n');
      expect(() => new JournalLock(file, { pid: 4321 }).acquire()).toThrow(/journal in use by process 1 \(/);
    },
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'an error other than "the lock exists" is thrown as it is',
    () => {
      // kills store.ts:241 condition false
      const file = journalPath('lock-eacces');
      const dir = join(file, '..');
      chmodSync(dir, 0o500);
      try {
        expect(() => new JournalLock(file, { pid: 4321 }).acquire()).toThrow(/EACCES/);
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );
});
