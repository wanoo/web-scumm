### Changes

- **The four archives installed as a third party installs them** (4.1.18, plan §7): `npm run external-consumer` reads
  the archives (names, versions, licences, binaries, exports, no `file:` dependency, no checkout path), moves a game
  made on 4.1.17 to them (migrate, verify, build, its 4.1.17 save and a new game played to the end through
  `web-scumm/testing`), runs `create-web-scumm`, serves the Bridge from its archive (SQLite, and Postgres), and plays a
  connector scenario through it (a pairing code from the Bridge, a signed letter accepted, the same one a duplicate, a
  forged signature refused). Portable (Node's own APIs, npm through the shell on Windows); CI runs it on Ubuntu, macOS
  and Windows.
- **The candidate packs the packages once, and the release publishes those** (4.1.18): `candidate.yml` packs the four
  archives, installs them outside the repository on Ubuntu (Node 22 and 24), macOS and Windows, and names each in its
  manifest; `release.yml` publishes the candidate's archives after checking their SHA-256, never packs again, and
  attaches `web-scumm-connectors` too (until now it was packed but not published).
