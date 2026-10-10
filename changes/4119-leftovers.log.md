## 4.1.19 PR 4: the reviewers' leftovers and the RTA after a resume

- Plan §7. Each fault from the 4.1.18 handout §4 was reproduced first.
- **Connector SDK** (`connectors/src/sdk.ts`): only an object counts as an answer. A body `null` used to throw in
  `r.json.sequence`, so it was retried as a lost connection and refused `unreachable`. A 2xx whose sequence is not a
  positive safe integer is retried with the same key: the Bridge's `duplicate` gives the sequence, otherwise the
  refusal is `bridge`.
- **Terminal line editor** (`connectors/src/terminal/line.ts`): a stray continuation byte, and the bytes `0xC0`,
  `0xC1` and `0xF8`–`0xFF`, are dropped. The buffer itself is the state, so a character split across chunks stays
  whole. A backspace takes a column back only for a character that was shown.
- **Recorder** (`speedrun/recorder.ts`): `ResumePoint.started` was added. A run resumed before its start shows an RTA
  of 0 until the start. A chunk written before 4.1.19 counts as started when its `rtaMs` is above 0. This is display
  only; the logical clock is untouched.
- **Older engine**: `external-consumer` checks the older engine's tarball against `web-scumm-<tag>-SHA256SUMS`
  (`sumFor`, unit-tested). The candidate's matrix takes it from 4.1.17, 4.1.16 and 4.1.18-rc.1.
- The `livesplit-obs` pass (#81) stays open: this PR fixes what a machine sees, not what a person sees.

→ next: Claude · PR 2 (artefacts and Field Kit); the DSL checkpoint before PR 3
