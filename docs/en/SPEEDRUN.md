# Speedrun (4.1.14 "Time Attack")

A game made with web-scumm can declare speedrun categories as content. A player starts an attempt from the pause
menu, the engine times it, splits it on what happens in the game (never on pixels), and seals the run into a `.wsrun`
file that anyone can replay and verify. The design is in `docs/dev/adr/0016-run-clock-and-envelope.md` (the clock, the
seeded generator, the chained proof) and `docs/dev/adr/0017-speedrun-verdicts-and-trust.md` (verdicts and trust).
Nothing here promises to detect every cheat: a replay proves a run is possible and its in-game time exact; only a
server's or a human's observation raises the trust further.

## For players

- **Start**: pause menu › **Speedrun** (`ui.speedrun`) › a category. The game restarts with the category's seed; a
  small timer shows the category, the time it is ranked on and the last split.
- **During the run**: the pause menu shows **Abandon run** (`ui.abandonRun`). Opening it is recorded as a pause; the
  tab going to the background is recorded too. Neither stops the in-game time (the game does not run while it waits).
- **At the finish**: the run is sealed; the pause menu shows **Export run** (`ui.exportRun`): a `.wsrun` file, the
  proof to send to a leaderboard or a friend. The dev panel (`?dev`) has the same export.
- **Records** stay on the device (IndexedDB `web-scumm-runs`, offline): the personal best and its splits, the best
  segment of every split, the sum of best, attempts, finishes, abandons, notes. A run resumes after a crash or a closed
  tab from its last stored chunk (every 500 inputs); what was played after it is played again.
- **The ghost** is the personal best played beside you, on semantic targets: the room it is in, the action it does and
  what it holds, ahead or behind at each split. It is **off the first time** a category is played on this device (it
  would show the answers of the puzzles).

## Defining categories

`GameDef.speedrun` (types in `docs/en/API.md`, checked by `npm run validate`), content only: a new category needs no
change in the engine (`tests/speedrun-manifest.test.ts` proves it with a fixture game).

```ts
speedrun: {
  rulesVersion: 1,
  categories: [
    { id: 'any%', name: 'Any%', timing: 'igt',
      start: { event: 'sessionStarted', session: 'new' }, finish: { event: 'endingReached' },
      allowSaves: true, allowPauses: true, allowHints: true, reload: 'allowed', realityPolicy: 'forbidden',
      fingerprint: ['logic', 'trustedExtensions'],
      inputs: { mouse: true, touch: true, keyboard: true, gamepad: true, macros: 'forbidden' } },
  ],
  splits: [
    { id: 'ladder', name: 'Ladder', at: { event: 'objectiveCompleted', objective: 'ladder' } },
    { id: 'end', name: 'Festival', at: { event: 'endingReached' } },
  ],
},
```

A trigger names a semantic event (`roomEntered`, `itemAcquired`, `itemLost`, `flagChanged`, `objectiveCompleted`,
`endingReached`, `sessionStarted`, `playerSwitched`…) and the fields it must match (`room`, `item`, `flag` with
`value`, `objective`, `ending`, `player`). `reload` says what a load does: `invalidates` the run, or is `allowed` (a
state the run itself reached); `segment` (a load starting a timed segment) is reserved, not implemented in 4.1.14: the
validator refuses it. `seed: 'fixed'` makes every run draw from `fixed:<id>`; `seed` is the run's generator only.
Since 4.1.16 (D29, ADR 0019) the world a run is played in is `world`: `{ policy: 'story' }` (the default), `'fixed'`
with its published `fixedSeed`, `'random'` (any world of `mode`, ranked together), `'daily'` (the Bridge's signed seed
of the day) or `'mystery'` (a seed the Bridge commits to before the start), each with the Remix `mode` its worlds come
from. 4.1.15's `seed: 'daily' | 'mystery'` without `world` is read as that world (a random run in it) with a warning. The
rules carry their version: a change never requalifies an old run (`rulesVersion` differs: `unsupported-version`). The
validator refuses unknown events, ids that name nothing, a start equal to the finish, a category without an input, a
Reality policy without `reality`, a split that is its own ancestor; it warns about a flag never set and a category that
does not require `logic`. The reference chapter declares Any%, Any% No Hints and Real Time (`games/reference/game.ts`).

## Timing: RTA, IGT, Active IGT

- **RTA**: the page's monotonic clock from the start trigger to the finish. Never reproducible, never an authority: a
  run timed on `rta` replays as valid but stays unranked without a witness.
- **IGT** (`logicalTime`): the sum of the declared durations of what the engine ran (`core/timing.ts`,
  `TIMING_VERSION = 1`): a line 2.2 s whatever its text or language, a walk its distance over the walk speed between
  logical anchors, a `wait`, an animation, a camera pan, a motion their milliseconds; a skipped cutscene costs nothing.
  Think time is not in it. In microticks (1 ms = 1,000), a `bigint` written as a decimal string.
- **Active IGT**: IGT minus what ran inside a cutscene.
- **Logical steps**: one per input of the session.

The run clock (`Engine.runClock`) observes the engine and never writes the state (D24).

## Splits, routes, records and the ghost

Splits are automatic: each fires once, the first time its trigger matches after the start; a split that never fires
is marked missed and the run goes on. A `parent` makes a sub-split. Records compare a run to the personal best
(ahead or behind at each split), keep the best segment of each split and their sum.

A **route** is a `.wsroute` file (canonical JSON): the inputs of a run, optionally its splits. The Studio's Play tab
exports the session in its frame as a route, imports one, and compares two (first different input, splits' deltas).
The solver's witness becomes a **logical route** (`kind: 'logical'`): a reference for routing, never a record.

## The proof: `.wsrun`

Schema 2 since 4.1.16 (`SpeedrunEnvelopeV2`, ADR 0019): the game, its fingerprint (the game as written, before any
world), the engine's, generator's and durations' versions, the category and its rules' version, the run's generator
seed (`runSeed`), the exact world played (`variant`, assignments included, never regenerated from a seed) and, for a
Daily or Mystery world, the Bridge's signed tokens (`worldEvidence`), the timing (RTA, steps, IGT, active IGT, the declared pauses, menus,
background and loads), the splits, the entries in chunks of 500 chained by SHA-256 from `H0` (the rules) to `Hn`, the
loads, the inputs used, the Reality signals, the final state's hash and the final proof. `H0` seals the world too (its
hash, the category's world policy, the evidence's hash, the Remix algorithm's version): the same inputs in two worlds
are two runs. Every hash is over `canonicalJson`. The exported trust is always `local`. A schema 1 file (4.1.14,
4.1.15) is still read, as a Story run; offered to a Remix category it is refused (`legacy-world-missing`), never
requalified from its seed.

## Verifying a run

```
npm run speedrun:verify -- run.wsrun [--keys=bridge-keys.json] [--json]
web-scumm speedrun verify run.wsrun
```

The MCP tool `speedrun_verify` does the same for an assistant. The verifier reloads the category from the game,
checks the run's world against the game (`loadVariant`) and its category (`worldVerdict`, the day's token or the
Mystery commitment and reveal checked with the key `remix.daily` names), rebuilds that world, replays the entries with
the run's seed (the random draws are drawn again, never taken from the file), recomputes the
clock, the splits, the final state and the chain, then checks the rules, and names the leaderboard the run goes to
(`world.leaderboardKey`: the category, and for Fixed and Daily the seed). Exit 0 for `valid` and `valid-unranked`.

| Verdict | Codes |
|---|---|
| `valid` | `ok` |
| `valid-unranked` | `rta-unverifiable`, `mystery-unwitnessed` (a Mystery run: when it started is the client's word) |
| `invalid-category-rule` | `unknown-category`, `hints-forbidden`, `saves-forbidden`, `pauses-forbidden`, `reload-forbidden`, `foreign-load`, `input-forbidden`, `reality-forbidden`, `seed-policy`, `start-trigger`, `world-policy`, `legacy-world-missing`, `daily-proof-missing`, `daily-proof-invalid`, `mystery-commitment`, `mystery-reveal`, `mystery-start-window` |
| `invalid-replay` | `envelope-shape`, `chunk-order`, `chunk-hash`, `chain`, `replay-diverged`, `rnd-mismatch`, `time-mismatch`, `splits-mismatch`, `final-state`, `not-finished`, `world-missing`, `world-shape`, `world-hash`, `world-value`, `world-constraint`, `world-stale` |
| `modified-game` | `fingerprint` |
| `missing-reality-proof` | `signal-missing`, `signal-signature`, `signal-mismatch` |
| `unsupported-version` | `schema`, `engine-version`, `prng-version`, `timing-version`, `rules-version` |
| `inconclusive` | `timeout`, `crash`, `no-keyring`, `package-not-approved` (the Bridge's worker) |

`inconclusive` is never valid. A complete Any% run of the reference chapter is committed
(`tests/fixtures/speedrun/reference-any.wsrun`, schema 2, made by `tools/speedrun/reference-run.ts`), verified by a test
and by the release workflow, which attaches it to every release; 4.1.15's schema 1 file is kept as a golden fixture
(`reference-any.v1.wsrun`).

## Trust levels

`local` (timed by the player's machine) → `replay-valid` (a verifier other than the client replayed it) →
`server-witnessed` (the server dated the run's chunks as they were played: reserved, not in 4.1.14) →
`moderator-verified` (a human with the leaderboard's admin token looked at it). Only someone other than the client
raises a level; an envelope that claims more is read as `local`. The level shows in the records, the Studio and the
leaderboard.

## Reality policies

- `forbidden`: no signal from outside; a signal in the run is `reality-forbidden`.
- `recorded`: every signal applied is kept with its signed JWS, its key id and its hash; the verifier checks the
  signature with the Bridge's public keys (`--keys`, `GET /v1/keys`). No proof: `missing-reality-proof`.
- `live`: the same proof, in a category of its own (the latency and the availability of a live signal are not
  reproducible). Without the keys the verifier cannot conclude (`no-keyring`).

## Streaming: OBS and LiveSplit

Local tools on the player's machine (D23), never on the Bridge, never in the PWA. Open the game with
`?speedrunTool=<port>`: the page posts its run's events (category, split ids and names, times; nothing else) to
`127.0.0.1:<port>`. The tools accept events from the game's origin only (the dev server and the preview by default,
`--origin=<url>` for a deployed build): another page open in the browser cannot post fake splits.

- `npm run speedrun:overlay -- --port=7777`: an OBS Browser Source at `http://127.0.0.1:7777/?mode=full`
  (`compact`, `transparent`), Server-Sent Events.
- `npm run speedrun:livesplit -- serve --port=7778`: drives LiveSplit through its own WebSocket server (Control › Start
  WebSocket Server): start, in-game time, split, skip, pause, reset. `export run.wsrun` writes a LiveSplit `.lss`
  with the run's splits as the personal best.

## Leaderboards on the Bridge

`bridge/src/runs.ts`, mounted by `npm run bridge -- serve` when the configuration has a `runs` section (4.1.16;
`bridgeServer`'s `runs` option for a host of its own): `POST /v1/runs` with `{ player, envelope }` returns the run's id
and a deletion token. Runs are kept in the Bridge's SQL store (`sqlite:` for one machine, Postgres for several
instances; `bridge/migrations/0002`) and survive a restart. Every instance's workers share one queue: a run is
**created once** (its key is unique: two instances receiving the same run create one), **claimed by one worker** under
a lease, and **claimed again** when its worker died and the lease expired; a worker that lost its lease cannot store a
verdict. Each worker is an **isolated process** (`tools/speedrun/worker.ts`): a bounded heap, killed with its process
group at its time budget, an environment holding only `PATH`, the game package's folder and the heap size (no secret
of the Bridge), fetch, WebSocket, TCP, UDP and DNS refused in-process (defence in depth, not a sandbox: see
REALITY-OPS, "The speedrun worker"), the package checked against its approved fingerprint, its answer signed with a
one-time key. The HTTP process never replays. A run is identified by its game, category, run seed and inputs (their
RTA stamps aside), never by its world: the first submitter keeps it, a copy re-stamped or re-sealed in another world
is refused. A client may submit ten runs a minute (`perMinute`); the queue holds at most `maxQueued` runs, every
instance together; the envelope is dropped once the verdict is stored; old runs are purged hourly.
`GET /v1/runs?game=&category=[&key=]` is a leaderboard: valid runs only, each player's best, on the **verifier's key**
(`world.leaderboardKey`: the category, and for a Fixed or Daily world `<category>:<seed>`); equal times share a rank,
then the earlier submission comes first. A Daily run sent after its day is practice (valid, not ranked); a Mystery run
is `valid-unranked` without a server witness. `&seed=fixed|random` still filters 4.1.14's runs.
`GET /v1/runs/<id>` is one run, `DELETE /v1/runs/<id>` with `x-delete-token` deletes it, `POST /v1/runs/<id>/moderate`
with the admin token raises it to `moderator-verified`. Submissions, verdicts, moderations and deletions are audit lines
on the Bridge's log.

The daily challenge (`bridge/src/daily.ts`, a configuration's `daily` section): `GET /v1/daily?game=[&date=]` signs the
day's seed (a real UTC day, today or within `retentionDays`, 30 by default); `POST /v1/commit` and
`GET /v1/reveal/<id>` commit to a Mystery seed and reveal it, both signed. Tokens and commitments are written once
in the same SQL store, so every instance answers the same. The player keeps a Daily world's token beside the world and
a speedrun in it carries the token; the player has no Mystery flow yet (a Mystery category refuses to start there).

## Policies

- **Mods and extensions**: a category names the fingerprint components a run must match. `logic` alone admits a mod
  that changes the art or the music; `trustedExtensions` refuses one that changes the game's code; `presentation`
  refuses any change of art. A run whose components differ is `modified-game`.
- **Old engine versions**: a run is replayed by the engine it was recorded on. The worker is meant to replay an older
  run with that release's archive (pinned version); in 4.1.14 the verifier replays its own version only and says
  `unsupported-version` (`engine-version`) for another one.
- **Retention**: a leaderboard keeps a run 90 days by default (`retentionDays`), and deletes it on request with the
  token given at submission.
- **Anonymity**: a leaderboard shows a pseudonym (2 to 32 letters, digits, spaces, `_ . -`; an email is refused) and
  never anything else about the player. Pseudonyms are **not authenticated**: anyone may submit under any name, and
  anyone may submit a published run first under theirs.
- **Ghosts on semantic targets**: a ghost shows rooms, actions on ids and the inventory, never a pixel trail; it is
  off the first time a category is played.

## Accessibility and fairness

A category declares its inputs (mouse, touch, keyboard, gamepad, macros). An accessibility option is **never an
implicit cheat**: the text speed, the text size, reduced motion and the readable font change nothing in the in-game
time (a line costs the same logical time at every speed), and the keyboard's and the screen reader's targets are the
same actions. A category that forbids an input says so; the inputs a run used are declared by the client (the
client's word, like RTA).

## Limits

- **Integrity is not authenticity**: the chain proves a file was not altered after it was sealed, not that the client
  was honest; a client can recompute it. Pauses, menus, saves, RTA and the inputs used are the client's word.
- **`replay-valid` admits tool-assisted runs**: a run whose inputs a script or the solver chose replays valid (the
  committed reference run is the solver's route), and so does a run resumed after a crash (the inputs lost after its
  last chunk are not in its time). Only a witness or a moderator rules them out.
- **The seed of a random-seed category is the client's choice**: a player can search seeds offline for an easy one.
  Mystery and Daily seeds, given by a server, are 4.1.15's answer.
- Not in 4.1.14: the live witness (`server-witnessed`), the pinned-version replay in the worker, a SQL store for the
  runs, the `/v1/runs` mount in `bridge/src/server.ts`, the cross-browser e2e (`npm run e2e:speedrun`) in CI, real
  OBS and LiveSplit sessions and field tests by speedrunners (human passes).
