// The qualification profile's promises that a file can be checked for (4.1.18, ops/qualify/README.md), without Docker:
// every image pinned by digest, Postgres and the Bridges never published, the store and Bridge networks internal, the
// Bridges read-only, unprivileged, their tenants mounted read-only, the secrets as files. The `qualify` workflow
// brings it up and drives it (scripts/ops-qualify.mjs). And `BRIDGE_STORE_FILE`, the store URL read from a file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { storeSpec } from '../bridge/src/cli-store';

const compose = readFileSync('ops/qualify/compose.yml', 'utf8');
const dockerfile = readFileSync('ops/qualify/Dockerfile.bridge', 'utf8');

describe('the qualification profile', () => {
  it('pins every image by digest, the Bridge built from the tarball', () => {
    const images = [...compose.matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]!).filter((i) => !i.endsWith(':qualify'));
    expect(images).toHaveLength(2);
    for (const i of [...images, ...[...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]!)])
      expect(i).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(dockerfile).toContain('COPY web-scumm-bridge.tgz');
    expect(dockerfile).not.toMatch(/COPY \.\s|COPY bridge\//);
  });

  it('publishes only the proxy, on 127.0.0.1, and keeps the store and the Bridges on internal networks', () => {
    const published = [...compose.matchAll(/^\s+- '([^']*:\d+)'$/gm)].map((m) => m[1]!).filter((p) => p.split(':').length > 2);
    expect(published.length).toBe(4);
    for (const p of published) expect(p.startsWith('127.0.0.1:')).toBe(true);
    expect(compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  bridge-1:'))).not.toContain('ports:');
    expect(compose).toMatch(/edge:\n\s+internal: true/);
    expect(compose).toMatch(/store:\n\s+internal: true/);
  });

  it('runs the Bridges read-only, unprivileged, with their tenants read-only and their secrets as files', () => {
    const bridge = compose.slice(compose.indexOf('x-bridge:'), compose.indexOf('services:'));
    for (const want of ['read_only: true', 'cap_drop: [ALL]', 'no-new-privileges:true', 'pids_limit:', 'mem_limit:', '/srv/bridge/a:ro', '/srv/bridge/b:ro', 'BRIDGE_STORE_FILE: /run/secrets/store_url'])
      expect(bridge).toContain(want);
    expect(bridge).not.toMatch(/BRIDGE_STORE:|postgres:\/\//);
    expect(compose).toContain('POSTGRES_PASSWORD_FILE: /run/secrets/pg_password');
    expect(compose).not.toMatch(/POSTGRES_PASSWORD:/);
  });
});

describe('BRIDGE_STORE_FILE', () => {
  it('names the store from a file, after --store= and BRIDGE_STORE, before the configuration', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-file-'));
    try {
      const f = join(dir, 'url');
      writeFileSync(f, 'postgres://bridge:secret@db:5432/bridge\n');
      const file = { journal: 'journal.jsonl', store: 'sqlite' };
      expect(storeSpec(file, [], { BRIDGE_STORE_FILE: f })).toBe('postgres://bridge:secret@db:5432/bridge');
      expect(storeSpec(file, [], { BRIDGE_STORE: 'sqlite:x.sqlite', BRIDGE_STORE_FILE: f })).toBe('sqlite:x.sqlite');
      expect(storeSpec(file, ['--store=jsonl'], { BRIDGE_STORE_FILE: f })).toBe('jsonl');
      writeFileSync(f, '  \n');
      expect(storeSpec(file, [], { BRIDGE_STORE_FILE: f })).toBe('sqlite');
      expect(storeSpec(file, [], {})).toBe('sqlite');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
