# Outside review of 4.1.0 "Clarity"

A human gate (D12): reported in the release notes, never blocking. From `docs/dev/PLAN-4.1.1-CLARITY.md` §13.

**Who.** One person who did not build the engine: a developer comfortable with TypeScript, new to web-scumm.

**Protocol.**

1. Clone the repository at the release tag, `npm ci`, `npm test`.
2. Follow `docs/en/CODE_TOUR.md` from step 1 to step 7, with the code open, timing it.
3. Pick one small change from the list below and make it, then open a pull request (or send the diff):
   - a validator message that names the file and the field more precisely;
   - a missing invalid case in one of the parsers' tables (`tests/diagnostics-parity.test.ts`,
     `tests/untrusted-tools.test.ts`);
   - a new example command in `tests/cmds.test.ts` and its behaviour test, following `CONTRIBUTING.md`.
4. Answer the questions below, with concrete observations (a file, a name, a moment), not a grade.

**Questions.**

- Where does the state of a game live, and who may change it?
- Where is the test of a given command (pick one: `shake`, `transfer`, `waitEvent`)?
- How does a replay stay deterministic, and how does it say where it diverged?
- Could you add a validation or fix a diagnostic without reading the whole repository? What did you have to read?
- Which names, files or boundaries slowed you down?

**Record.** Copy the block below to `docs/dev/passes/field/clarity-review-<name>.md`:

```text
Reviewer: <name>             Date: <yyyy-mm-dd>        Tag: v4.1.0
Tour: <minutes>              Change made: <which, link>
Answers: <one paragraph per question>
Blockers (understanding stopped): <list, or none>
Slowed down by: <list>
```

Each blocker is fixed or explicitly deferred in `docs/dev/LOG.md` before the next release.

**Status at the 4.1.0 tag: 0 of 1 done.**
