-- The Reality Bridge's schema, version 1 (4.1.10, ADR 0009). One file for SQLite and Postgres: portable types only
-- (TEXT, INTEGER, BIGINT), booleans as 0/1, times in epoch milliseconds. Every table leads with tenant_id, and so does
-- every key and index: a query that forgets its tenant finds no index to use.
CREATE TABLE players (
  tenant_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  capability_expires_at BIGINT NOT NULL,
  issued_at BIGINT,
  revoked INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  origin TEXT,
  acked BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, player_id)
);
CREATE INDEX players_capability ON players (tenant_id, capability_hash);

CREATE TABLE pairings (
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  game_id TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  player_id TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  origin TEXT,
  PRIMARY KEY (tenant_id, code)
);
CREATE INDEX pairings_expiry ON pairings (tenant_id, expires_at);

-- The journal: a player's sequence is contiguous from 1, a dedupe key appears once per player.
CREATE TABLE signals (
  tenant_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  jws TEXT NOT NULL,
  at BIGINT NOT NULL,
  kid TEXT,
  payload TEXT,
  PRIMARY KEY (tenant_id, player_id, sequence),
  UNIQUE (tenant_id, player_id, dedupe_key)
);

CREATE TABLE revoked_tokens (
  tenant_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, token_id)
);

CREATE TABLE signing_keys (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  retire_after TEXT,
  PRIMARY KEY (tenant_id, key_id)
);

-- Rows the Bridge could not deliver (a JWS or payload that no longer reads): kept aside, listed by `bridge doctor`.
CREATE TABLE quarantine (
  tenant_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  sequence BIGINT NOT NULL,
  reason TEXT NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, player_id, sequence)
);
