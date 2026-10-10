### Fixed

- **Backspace in an SSH terminal erases a whole character** (4.1.18): on a pty, deleting after a multi-byte UTF-8
  character (`é`) left its lead byte behind (`aé` then backspace gave `a�`): the loop looked at the byte left in the
  buffer, not the one it had just removed. Found by the connectors' mutation reading.

### Changes

- **`connectors` and `reality-store` are gated mutation sets** (4.1.18, D32): their 322 survivors (204 and 118) read
  one by one, each killed by a short test (`tests/connectors-*-mutants.test.ts`, `tests/reality-store-*-mutants.test.ts`)
  or named in `docs/dev/mutants.json` with its reason. Every set is now a job of its own in ci, the nightly, the
  candidate and the release; `release.yml` asks the tag's own `GATED` which sets it gates.
