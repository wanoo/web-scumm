// The load reports are evidence only when they measured the backend they name (4.1.17, plan §4.1). The 4.1.16 nightly
// gave its SQLite row BRIDGE_STORE="" and `bridge-load` kept the empty string (`??`): SQLite was never opened, no
// report was written, and the missing file failed nothing.
import { describe, expect, it } from 'vitest';
import { checkLoadReport, loadSpec } from '../tools/load-report';

const good = {
  store: 'sqlite',
  commit: 'a'.repeat(40),
  instances: 3,
  players: 10,
  proposals: 20,
  seconds: 0.1,
  rows: 20,
  gaps: 0,
  statuses: { '202': 20 },
  streams: { followed: 2, complete: 2 },
  machine: { node: 'v22.14.0' },
};

describe('bridge:load', () => {
  it('reads an empty BRIDGE_STORE as no store, so SQLite is measured', () => {
    expect(loadSpec([], { BRIDGE_STORE: '' })).toBe('sqlite');
    expect(loadSpec([], {})).toBe('sqlite');
    expect(loadSpec(['--store='], { BRIDGE_STORE: '' })).toBe('sqlite');
    expect(loadSpec(['--store=postgres://u:p@h/db'], { BRIDGE_STORE: '' })).toBe('postgres://u:p@h/db');
    expect(loadSpec([], { BRIDGE_STORE: 'postgresql://h/db' })).toBe('postgresql://h/db');
    expect(() => loadSpec(['--store=jsonl'], {})).toThrow(/sqlite or postgres/);
  });

  it('accepts a complete report of the backend the job names, and nothing else', () => {
    expect(checkLoadReport(good, { store: 'sqlite', commit: 'a'.repeat(40) })).toEqual([]);
    expect(checkLoadReport(good, { store: 'postgres' })).toEqual(['the report measured sqlite, not postgres']);
    expect(checkLoadReport(good, { store: 'sqlite', commit: 'b'.repeat(40) })[0]).toMatch(/is of a+, not b+/);
    expect(checkLoadReport(null, { store: 'sqlite' })).toEqual(['not a report']);
  });

  it('refuses an incomplete or a failed measure', () => {
    const { rows: _, ...noRows } = good;
    expect(checkLoadReport(noRows, { store: 'sqlite' })).toContain('rows: missing');
    expect(checkLoadReport({ ...good, proposals: 0, rows: 0, statuses: { '202': 0 } }, { store: 'sqlite' })).toContain(
      'no proposal was sent',
    );
    expect(checkLoadReport({ ...good, rows: 19 }, { store: 'sqlite' })).toContain('19 rows for 20 proposals');
    expect(checkLoadReport({ ...good, gaps: 1 }, { store: 'sqlite' })).toContain(
      '1 players with a gap in their sequence',
    );
    expect(checkLoadReport({ ...good, statuses: { '202': 19, '429': 1 } }, { store: 'sqlite' })).toContain(
      '19 proposals accepted of 20',
    );
    expect(checkLoadReport({ ...good, streams: { followed: 2, complete: 1 } }, { store: 'sqlite' })).toContain(
      'a followed stream is incomplete',
    );
    expect(checkLoadReport({ ...good, machine: {} }, { store: 'sqlite' })).toContain('machine: missing');
  });
});
