### Changes

- **A minigame's result can be proved** (4.1.17, D31, ADR 0020): the code wheel records its answers (by their place
  in the author's list, so a translation keeps them) and the wheel's hash beside its result (`SessionEntry.mgt`); a
  replay generates the wheel again from the world, judges the answers and stops on another result — the verifier
  says `invalid-replay`, `minigame-transcript`. A speedrun category asks for it with `codeWheel.proof: 'transcript'`
  (`code-wheel-proof`: the word `won` alone is refused). The reference chapter's new category `wheel-proved` wants the
  wheel won and proved; its other categories, and every 4.1.16 run, keep their meaning.
- **A printed wheel is not seen** (4.1.17): a category with `codeWheel.medium: 'physical'` whose run played the wheel
  is `valid-unranked` (`physical-wheel-unwitnessed`) until a moderator ranks it.
- **API** (4.1.17): `CodeWheelTranscript`, `MinigameTranscript`, `MinigameOutcome`; `Presenter.minigame` may resolve
  with `{ result, transcript }` (widened, an implementation returning a result alone is unchanged).
- SPEEDRUN en/fr says what `replay-valid` proves and what it does not (a person, a printed wheel, the RTA).
