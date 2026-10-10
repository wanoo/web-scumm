### Changes

- **A Bridge backup is one snapshot; a restore is all or nothing** (4.1.19, ADR 0021). `backup` writes schema 3: every
  tenant, run and daily record read in one read-only transaction, an envelope naming the backend, the Bridge and SQL
  schema versions, the counts and a SHA-256 of the payload, bounded (`--max-rows`, `--max-bytes`) and written to a
  temporary file then renamed. `restore` reads the file bounded, checks every row before opening the store (schemas 1,
  2 and 3), then writes tenants, runs and daily records in one transaction compared with the file before it commits:
  a failed restore leaves the store as it was and says "nothing restored". A daily record already held is now a
  conflict (refused without `--force`, replaced with it) instead of being kept silently.

### Breaking

- **`restore` into the JSON-lines journal is refused** (4.1.19): it could not be done all or nothing (`--force` used
  to delete then fail). Migrate the journal to SQLite (`migrate --from=jsonl --to=sqlite`), then restore.
