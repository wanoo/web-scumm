### Fixed

- **A Bridge on SQLite no longer exits on "database is locked" when several start at once (4.1.14)**: the opening's
  `PRAGMA journal_mode = WAL` ran outside the store's busy wait, so of several `serve` processes opening one fresh
  file the one that met another's lock exited (1). Every statement now waits (the opening's pragmas, the statements
  inside a transaction, the connection's own `timeout` too), and past its wait answers `StoreBusyError` (a 503), never
  a crash; a poll of the other instances' acceptances that stays busy is logged once (`store.poll.failed`) and tried
  again.
