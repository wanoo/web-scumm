### Fixed

- **The connector SDK no longer calls an answering Bridge unreachable** (4.1.19): a body `null` (or any JSON that is not
  an object) used to throw while it was read, and the proposal was retried then refused `unreachable`. It now reads
  as an empty answer. An acceptance without a valid sequence is sent again with the same key; if the Bridge never
  gives the sequence, the refusal is `bridge`. The log line is `signal.malformed-answer`.
- **The terminal connectors keep UTF-8 whole** (4.1.19): a continuation byte that continues nothing, or a byte that
  never begins a character, is dropped. A backspace after one no longer erased a column of the prompt. A character
  split between two network chunks stays whole.
- **The live RTA after a resume starts at 0 when the run had not started** (4.1.19): it used to count from the resume.
  The chunk's head now says whether the run had started; an older chunk is read by its `rtaMs`. Sealed times,
  `.wsrun` and `rulesVersion` are unchanged.

### Changes

- **`external-consumer` checks the older engine against its release's sums** (4.1.19). The candidate creates a game on
  4.1.17, on 4.1.16, and on the pre-release 4.1.18-rc.1, then moves it to the candidate.
