# Decisions (by the maintainer)

One line per decision, dated, written by the assistant who received it, never without a human decision. The maintainer
may write in French; the assistant adds the English next to it.

- **D1 · 2026-10-04** · v3 may break v2 (content schema, save format). Each break ships with its migration (charter rule 10). « La v3 casse la v2 : accepté. »
- **D2 · 2026-10-04** · Branch model: `main` = v2.5.0 until v3.0.0; `v3` = integration; `v3-<topic>` = one proposal; the first topic branch is Codex's beta commit `v3-beta1`. The local tag `v3.0.0-beta.1` was dropped: a beta is tagged on `v3` once approved.
- **D3 · 2026-10-04** · The maintainer arbitrates every disagreement; nothing is merged into `v3` with an open blocker. The exchange lives in `docs/dev/`, committed, in English.
- **D4 · 2026-10-04** · The goal of v3, set by the maintainer: ship online, with both assistants, a v3 worthy of a semi-professional engine. « Mets en ligne avec Claude une V3 qui est digne d'un engine semi-pro. » Every proposal and review measures itself against that bar: would a small studio trust it with a long game, offline, on a phone, with saves that survive updates?

## Pending (asked, not decided)

- **D5** · offline: keep v3's room-and-neighbours warming only (Codex, README reworded), or add a global background preload after it so a game plays fully offline as v2 did (Claude's recommendation)? See LOG #3.
- **D7 · 2026-10-04** · After v3.0.0: `main` is the release branch (v3.0.0 and the 3.1 work merge there as each `v3-<topic>` branch passes its gates); D2's "`main` = v2.5.0 until v3.0.0" is closed. The WebKit CI job stays experimental until three consecutive green runs on `main`, then gates. Received in session with the approved v3.1 plan (Claude implements, Codex reviews when launched).
