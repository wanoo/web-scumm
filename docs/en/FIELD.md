# Field proof: what only people and real devices can check

The machine checks a release on every push: the solver, the browsers in CI, the archive, the budgets. Seven checks
need a person or a real device. They are reported in each release's notes, not blocking (D12): a release says how
many were done (`docs/dev/passes/<version>.md`, from `docs/dev/passes/TEMPLATE.md`). This page is how to do each one
and what to bring back.

| # | Pass | How | Bring back |
|---|---|---|---|
| 1 | Screen reader | `docs/dev/SCREEN-READER.md`: VoiceOver on iOS or TalkBack on Android, a game from the title to the first puzzle solved | the sheet's row: device, OS, what could not be reached or was not read |
| 2 | Safari offline | `docs/dev/SAFARI-OFFLINE.md`: first visit online, airplane mode, a room never visited, a reload | the row: iOS and Safari versions, the step that failed |
| 3 | A real phone | the heaviest scene (the reference market, the demo's garden) on a mid-range phone, the frame rate overlay (`?fps`) | the lowest FPS seen (≥ 30 wanted), the phone |
| 4 | Playtesters | five people who do not know the puzzles, each on their own phone, no help given | their session files (below), then `npm run verify:field` |
| 5 | Recorded voices | `npm run voices -- check --release` after recording: lines approved out of lines with an id | the count, the lines left |
| 6 | Listening | each score on a phone speaker and on headphones: stems following the game, each bridge once, nothing cut short, nothing left playing after a save is loaded, a voice during a bridge | the row, and each fault with its room and what was heard |
| 7 | Signed tag | `git tag -s vX.Y.Z` with the maintainer's key, `git tag -v` shows it | the row |

## Playtesters (pass 4)

1. Send the game's URL. Say only: "play as you like; when you stop, finished or not, open the pause menu and tap
   *Share session*". Do not explain a puzzle, even when asked: write down the question.
2. *Share session* makes a file with the inputs since the game started (ids and indices only, no journal text, no
   name), the device family (`ios`, `android` or `desktop`, nothing finer), and the near misses (a tap on nothing
   next to a target, by room and target). The tester sends it the way they like.
3. Drop the files into `games/<id>/playtests/` (committed; `npm run audit` covers it), then:
   - `npm run playtests -- --out=.cache/playtests`: play time per room, where players stall, hints shown, where they
     stopped, near misses, a heat map on the puzzle graph;
   - `npm run verify:field`: `verify:commercial`, then five sessions that still replay, three played to the end, two
     device families. The numbers are the quotas of a release tested by players; a game can ask more with
     `npm run playtests -- --strict --require=N --require-completed=N --require-devices=N`.
4. What the report shows becomes work: a stall is a puzzle to clue better, a near miss a hotspot to widen, an abandon
   a place to look at. The sessions stay: once the content changes they may no longer replay, and `--strict` says
   which (re-record or delete them).

## The sheet

Copy `docs/dev/passes/TEMPLATE.md` to `docs/dev/passes/<version>.md` before tagging, fill what was done, leave
"not done" where nothing was. `scripts/release-notes.mjs` puts the table in the release notes with "n of 7 done".
