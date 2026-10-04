# Decisions (by the maintainer)

One line per decision, dated, written by the assistant who received it, never without a human decision. The maintainer
may write in French; the assistant adds the English next to it.

- **D1 · 2026-10-04** · v3 may break v2 (content schema, save format). Each break ships with its migration (charter rule 10). « La v3 casse la v2 : accepté. »
- **D2 · 2026-10-04** · Branch model: `main` = v2.5.0 until v3.0.0; `v3` = integration; `v3-<topic>` = one proposal; the first topic branch is Codex's beta commit `v3-beta1`. The local tag `v3.0.0-beta.1` was dropped: a beta is tagged on `v3` once approved.
- **D3 · 2026-10-04** · The maintainer arbitrates every disagreement; nothing is merged into `v3` with an open blocker. The exchange lives in `docs/dev/`, committed, in English.
