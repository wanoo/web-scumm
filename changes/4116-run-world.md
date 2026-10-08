### Breaking

- **A `.wsrun` is schema 2** (4.1.16, ADR 0019): it carries the run's generator seed (`runSeed`, was `seed`), the exact
  world it was played in (`variant`) and, for a Daily or Mystery world, the Bridge's signed tokens (`worldEvidence`),
  all sealed into `h0`. A schema 1 file (4.1.14, 4.1.15) is still read and verified, as a Story run; offered to a Remix
  category it is refused (`legacy-world-missing`). A tool that read `envelope.seed` reads `runSeed` on schema 2.

### Fixed

- **A speedrun in a Remix world verifies in that world** (4.1.16): 4.1.15's verifier and the Bridge's worker replayed
  the base game, so a run where the key lay under the oranges could not verify. The verifier now checks the stored
  world against the game (`loadVariant`) and the category (`worldVerdict`), rebuilds it (`applyVariant`), replays the
  run there and names its leaderboard (`world.leaderboardKey`); the same inputs in two worlds are two runs. The
  recorder no longer turns a Daily or Mystery category into a random seed, refuses to start a run its category could
  not rank (`RunStartRefused`), and keeps the world, the evidence and the run's seed in its checkpoint (a resume in
  another world is refused).
- **`canonicalJson` writes the same text in Firefox** (4.1.16): Firefox's `normalize('NFC')` turns a lone surrogate
  half into U+FFFD; such a half is now kept and the text around it normalized alone, as Node, Chromium and WebKit do
  (`e2e:canonical`, never run before, failed on it).
- **The Bridge keeps two runs in two worlds apart**: a run's key includes its world.
- **A Mystery reveal is signed** by the Bridge (its `token`), so the time of the reveal is the Bridge's word.

### Changes

- **`SpeedrunCategory.world`** (D29): `{ policy: 'story' | 'fixed' | 'random' | 'daily' | 'mystery', mode, fixedSeed?,
  codeWheel? }`; the validator refuses what it cannot give a meaning to and warns about 4.1.15's `seed: 'daily' |
  'mystery'` without `world`. API: `SpeedrunWorldPolicy` (content); `categoryWorld`, `runSeedPolicy`,
  `SpeedrunEnvelopeV1`, `SpeedrunEnvelopeV2`, `SpeedrunWorldEvidence` (testing); `SpeedrunVerifyResult.world`.
