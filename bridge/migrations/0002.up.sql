-- Version 2 (4.1.16, ADR 0019): the speedrun leaderboards and the daily challenge, durable. A run is unique per tenant
-- by its key (game, category, seed, world, inputs): two instances receiving the same run create one row. A run is
-- claimed by one worker at a time under a lease (`lease_owner`, `lease_until`); a lease that expired is claimed again.
CREATE TABLE runs (
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  player TEXT NOT NULL,
  submitted_at BIGINT NOT NULL,
  status TEXT NOT NULL,
  verdict TEXT,
  code TEXT,
  reason TEXT,
  trust TEXT NOT NULL,
  ranked TEXT,
  seed_kind TEXT,
  world_hash TEXT,
  world_mode TEXT,
  world_seed TEXT,
  leaderboard_key TEXT,
  run_key TEXT NOT NULL,
  delete_token_hash TEXT NOT NULL,
  envelope TEXT NOT NULL,
  lease_owner TEXT,
  lease_until BIGINT,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, run_key)
);
CREATE INDEX runs_board ON runs (tenant_id, game_id, category_id, leaderboard_key);
CREATE INDEX runs_queue ON runs (status, submitted_at);

-- The daily challenge's tokens and Mystery commitments: written once (`ON CONFLICT DO NOTHING`), never changed.
CREATE TABLE daily_kv (
  k TEXT NOT NULL PRIMARY KEY,
  v TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
