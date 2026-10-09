-- Version 4 (4.1.17, plan §7.2): the submission quota of the speedrun queue, shared by every instance. One row per
-- tenant and client key (an HMAC of the client, never its address), the version of the key that made it, the tokens
-- left and when they were counted. Read and written in one transaction under the tenant's lock.
CREATE TABLE run_quota (
  tenant_id TEXT NOT NULL,
  client_key TEXT NOT NULL,
  key_version TEXT NOT NULL,
  tokens DOUBLE PRECISION NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, client_key)
);
CREATE INDEX run_quota_at ON run_quota (at);
