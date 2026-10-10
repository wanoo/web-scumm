## 4.1.18 PR 3 — the archives consumed outside the repository, on three systems, from the candidate

- `scripts/fresh-install.mjs` (3.9) packed and installed the archives on Linux, but finished the game with the
  repository's own `scripts/e2e.mjs`, moved folders with `mv`, polled with `curl`, stopped servers by process group,
  and built the Bridge's manifest with the repository's `tools/game.ts`: nothing of that runs on Windows, and part of
  it was the checkout, not the package. `scripts/external-consumer.mjs` does it with Node's own APIs and the packages'
  public faces only (`web-scumm/testing`, the binaries), and adds what the plan asks: the archives read, a game of the
  older release moved over them with its save, and a connector scenario through the installed Bridge.
- The connector scenario first failed with `player`: the Bridge knows a player only once paired. It now does what a
  player does: the game's `POST /v1/pairings`, the code mailed to the connector (`--pair` grant), then the letter.
- Tried on the maintainer's Mac against 4.1.16 → this checkout before the CI: every step green.
- The candidate packs once (`pack`), and `external-consumer` installs those archives on Ubuntu (22 with Postgres, 24),
  macOS and Windows; the manifest names them (`pack/…`), `release.yml` publishes them after checking their sums and
  attaches the connectors' archive, which it packed but never published until now.
- Windows found two bugs of the package itself: `scripts/pack.mjs` ran esbuild's `.bin` shim and `npm` without the
  shell (a `.cmd` there; now esbuild's API and npm through the shell, arguments quoted), and `web-scumm build` failed in
  a folder named by its 8.3 short form (`RUNNER~1`, Rolldown refused the page's name): the CLI and the Vite config take
  real paths. And Git's GNU tar, first on a bash PATH, read `D:\…` as a host: Windows' own tar is used.
- The second reading (an automated second context) found the harness would have failed every candidate job while it
  passed locally: the candidate's archives lie under the checkout, and npm writes the path it installed from into
  package.json, which the leak check refuses. The archives are copied beside the consumer first (tried locally with
  the archives under the checkout). Also: the Postgres and SQLite Bridges shared a port with a 1.5 s pause (now two
  ports, an early exit seen, every stop awaited), the connector was signalled through npx (now its bin by node).

→ next: Claude · 4.1.18 PR 4, the Bridge's qualification profile built from these archives
