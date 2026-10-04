# Decisions (by the maintainer)

One line per decision, dated, written by the assistant who received it, never without a human decision. The maintainer
may write in French; the assistant adds the English next to it.

- **D1 · 2026-10-04** · v3 may break v2 (content schema, save format). Each break ships with its migration (charter rule 10). « La v3 casse la v2 : accepté. »
- **D2 · 2026-10-04** · Branch model: `main` = v2.5.0 until v3.0.0; `v3` = integration; `v3-<topic>` = one proposal; the first topic branch is Codex's beta commit `v3-beta1`. The local tag `v3.0.0-beta.1` was dropped: a beta is tagged on `v3` once approved.
- **D3 · 2026-10-04** · The maintainer arbitrates every disagreement; nothing is merged into `v3` with an open blocker. The exchange lives in `docs/dev/`, committed, in English.
- **D4 · 2026-10-04** · The goal of v3, set by the maintainer: ship online, with both assistants, a v3 worthy of a semi-professional engine. « Mets en ligne avec Claude une V3 qui est digne d'un engine semi-pro. » Every proposal and review measures itself against that bar: would a small studio trust it with a long game, offline, on a phone, with saves that survive updates?

- **D5 · 2026-10-04** · Offline: the whole game is cached after the first visit (`GameDef.offline: 'full'`, the default; `'nearby'` keeps the room-scoped warm-up only). Asked in LOG #3, decided with the 3.1 plan, shipped in `v3-offline` (3.1.0) and made truthful in `v3-offline-truth` (3.1.1). « Jeu complet hors ligne après la première visite. »
- **D7 · 2026-10-04** · After v3.0.0: `main` is the release branch (each `v3-<topic>` merges there as it passes its gates); D2's "`main` = v2.5.0 until v3.0.0" is closed. The WebKit CI job stayed experimental until three consecutive green runs on `main`, then gated (done in 3.1.0).
- **D8 · 2026-10-04** · The private reference game stays on engine 3.1.0 for good: no further sync, breakage accepted. It is no longer a gate (charter rule 7, AGENTS.md: amended by `v3-release-truth`). « Plus besoin de faire le jeu privé, tout le monde y a joué. »
- **D9 · 2026-10-04** · Cadence from 3.1.1 on: Claude implements one `v3-<topic>` / `v32-<topic>` branch at a time and merges it on green CI; Codex reviews afterwards (each release, or any branch it picks), and its findings open the next branch. The one-ball rule of the charter is kept for the exchange itself, not as a merge gate. Received with the approved 3.1.1 → 3.2 plan (LOG #26).

## Pending (asked, not decided)

- (none)
