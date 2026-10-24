# Releasing

How a version of quest'n'click is made, for the maintainer: a candidate run on main, a signed tag that names it, a
release that publishes that run's files and nothing rebuilt, then a read-back. The commands are
`npm run ship -- …` ([`tools/release/ship.mjs`](../../tools/release/ship.mjs)); every one writes its PID to
`.cache/pids/ship-<command>.pid` (`SHIP_PIDS` chooses the folder): to stop one, stop that PID, not a pattern.

<a name="what-you-get"></a>

## What you get

A published, immutable GitHub release `v<version>` built from the commit CI and the candidate tested, carrying its
archives, manifests, SBOMs, sums and provenance attestations, read back by `ship verify`; from 4.5.0, its
documentation published after that read-back.

<a name="context-and-versions"></a>

## Context and versions

In the engine repository, by the maintainer (it needs write access, the signing key and the repository settings).
The chain is the one of 4.1.20 "Last Mile" (plan §11); tags are signed from 4.2.0. This page holds from 4.2.0.

<a name="prerequisites"></a>

## Prerequisites

- The GitHub CLI `gh`, signed in as the maintainer.
- The repository settings turned on once ([below](#maintainer-settings)): immutable releases and the tag ruleset.
- The signing key set up ([below](#signing)).
- The CHANGELOG section of the version assembled from the `changes/` fragments (the release branch's job,
  [Conventions](contribute.conventions.md)), and the people's passes sheet started ([Field passes](contribute.field-passes.md)).

<a name="where-to-run"></a>

## Where to run the commands

In the engine repository, on the maintainer's machine, on `main` up to date. The release itself runs on GitHub
Actions (`.github/workflows/release.yml`), started by the tag's `ci` run.

<a name="steps"></a>

## Steps

<a name="the-chain"></a>

### The chain

<!-- step: candidate -->
1. **A candidate on main.** Start it by hand on main for the full SHA:

   ```sh
   # in the engine repository
   gh workflow run candidate --ref main -f sha=<full sha>
   ```

   It runs every heavy family on that SHA, the full qualification profile on its own archives and image, the three
   loads and the signing rehearsal. Its gate (`candidate-gate`) writes and attests `candidate-manifest.json`, with
   every file the release will publish (`tools/release/artifacts.mjs`). Read the gate **and** its conclusion. Only a
   run started by hand (`workflow_dispatch`) on main may be named by a tag; a pull request labelled `full-ci` runs it
   too, as information only.

<!-- step: tag -->
2. **A tag that names it.**

   ```sh
   # in the engine repository
   npm run ship -- tag <version> <sha> --candidate=<run> --sign --now
   ```

   The previous stable tag must be an ancestor of the SHA. `--candidate=<run id>` is required from 4.1.17: the run must
   be green and its manifest must name this SHA and this run; the tag's annotation names it, and release.yml
   publishes that run's files. `--now` does not wait for main's own `ci` run (the tag's `ci` run, the same suite on the
   same commit, is what release.yml checks). `--sign` signs the tag with the SSH key ([below](#signing)). `ship tag`
   refuses to tag while immutable releases are off. It then waits as `ship watch` does.

<!-- step: release -->
3. **The release, from that run.** The tag's `ci` run, once green, starts `release.yml`. It checks that the tag is the
   commit ci tested, that the previous stable tag is an ancestor, and that the candidate named is a green run of
   `candidate` started by hand on main. It downloads the run's files and checks every SHA-256 against the manifest. It
   re-runs the release checks (`npm run release-check:ci`), proves the Remix catalogues, and copies what the candidate
   made: it builds nothing the candidate made (archives, image, SBOMs, the site, the surfaces). It then makes the
   release a **draft**, uploads every file, publishes it and reads it back (`ship verify`). From 4.1.20 it also needs
   the run's signing rehearsal, so a candidate made before that release's PR 3b cannot be released: start a new one.
   One release run per tag at a time: a second one waits, then finds the first's release.

<!-- step: verify -->
4. **Read back.**

   ```sh
   # in the engine repository
   npm run ship -- verify <version>
   ```

   It downloads the release and checks the sums, every provenance attestation and the list of files against the
   manifest; from 4.1.20 it also runs `gh release verify` and `gh release verify-asset` for each file. release.yml runs
   it as its last check.

> [!LIMIT id=published-never-changed]
> A published release is never changed. A run on a release already published stops before it makes anything. A draft
> left by a run that failed before publishing was never public: it is deleted (its tag stays) and made again from the
> same candidate. A failed RC is not fixed: it becomes an `rc.N+1`.

<a name="what-a-release-carries"></a>

### What a release carries

Each release is built from the commit CI tested, carries its licences inside the archive, and attaches: the built
game (`dist`), its assets manifest, the five npm package archives (`quest-n-click`, `create-quest-n-click`,
`quest-n-click-bridge`, `quest-n-click-connectors`, `quest-n-click-studio-server`; [npm packages](contribute.npm-packages.md)),
one CycloneDX SBOM per package and one for the Bridge's image (five SBOMs in 4.1.19, six since the Studio Server's
package in 4.2.1), the Bridge's image, the Remix catalogues' proofs, a complete speedrun of the reference chapter
verified by `speedrun:verify`, the candidate's runs, baseline, site files, surfaces and signing rehearsal, the
candidate's manifest, SHA-256 sums, and a build provenance attestation
(`gh attestation verify <file> -R Quest-n-Click/quest-n-click` from 4.5.2, see below for the releases before); from 4.5.0,
the documentation archive. It is never replaced
once published. What only people and real devices can check is reported in its notes ([Field passes](contribute.field-passes.md)).

A pre-release version (`4.1.8-rc.1`) is tagged the same way; release.yml marks it a pre-release on GitHub.

<a name="docs-publish"></a>
<!-- applies: 4.5.0.. -->

### The documentation, after the read-back

From 4.5.0, release.yml's `docs-publish` job `needs` the release job, so it starts only after `ship verify` passed. It
calls `.github/workflows/docs-publish.yml` with the tag, the SHA, the candidate run and the sha256 of the documentation
archive, promotes that archive (the candidate's, checked again), records it in `publication.json` and pushes the wiki;
an rc publishes `/docs/<v-rc>/` only. It is never started by `release: published`, which a release published with
`GITHUB_TOKEN` does not fire. Only the wiki's deploy key `WIKI_DEPLOY_KEY` is passed to it. See
[Writing documentation](contribute.writing-docs.md).

<a name="maintainer-settings"></a>

### What the maintainer turns on, once (after 4.1.20 PR 3b)

- **Immutable releases**: Settings → General → Releases. A published release then keeps its files and its tag.
- **A ruleset on the release tags**: target `tag`, `refs/tags/v*`, active. It restricts creation, refuses deletion and
  forbids force-push.
- `npm run ship -- preflight-stable --candidate=<run>` must then see both. **Before the first 4.1.20 tag**, `ship tag`
  refuses to tag while immutable releases are off: release.yml's token cannot read that setting (it needs admin read),
  so `ship tag` checks it with the maintainer's own access.

<a name="signing"></a>

### Signing the tags

4.1.x tags stay annotated (D30). From 4.2 they are signed with the maintainer's SSH key:

```sh
# in the engine repository
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
npm run ship -- tag 4.2.0-rc.2 <sha> --candidate=<run> --sign --now
```

- The key must also be registered on GitHub as a **signing** key (Settings → SSH and GPG keys).
- It must be in `.github/allowed_signers`, added in a commit signed by that key (8cebea2, made by Claude at the
  maintainer's request: D37). That file is also the trust root of carried passes (ADR 0024).
- `--key=<file>` gives another key file than `user.signingkey`.
- Each candidate rehearses the path with an ephemeral key (`signing-rehearsal`): it signs a tag of the commit that is
  never pushed, checks it with `git verify-tag`, then destroys the key.

> [!LIMIT id=signature-not-approval]
> With `id_ed25519`, the signature proves the key was used, not that the maintainer approved: an approval is recorded
> explicitly (D37).

<a name="preflight"></a>

### The stable preflight

```sh
# in the engine repository
npm run ship -- preflight-stable --candidate=<run> [--version=4.2.0]
```

It signs nothing, publishes nothing and changes no setting ([`tools/release/preflight.mjs`](../../tools/release/preflight.mjs)).
It says, one check at a time, `ok`, `missing` (a step still to take) or `blocked` (something wrong):

- the signing key, local and registered;
- `allowed_signers`;
- immutability and the tag ruleset;
- the candidate's provenance;
- for each npm package: the archive (`npm publish --dry-run`), the name, the bootstrap, the trusted publisher
  (stage-only), an OIDC publication proven, and the version not already published;
- the publishing step's exact Node and npm;
- GO / NO-GO against the people's reports ("GO for 4.2 on a reduced scope" is read with D38 written).

It exits 1 only on a `blocked`.

<a name="ship-commands"></a>

### Every `ship` command

| Command | What it does |
|---|---|
| `ship checks <pr>` | Waits for the pull request's checks; re-runs a failed job once; exit 1 if it fails again |
| `ship merge <pr>` | `checks`, then merges (a merge commit, the only method the ruleset allows); prints the SHA |
| `ship main <sha>` | Waits for main's `ci` run on that SHA to be green (re-run once) |
| `ship tag <version> <sha> --candidate=<run> [--now] [--sign [--key=<file>]]` | Tags (above), pushes, then `watch` |
| `ship watch <version>` | Waits for the tag's `ci` run, then the `release` run; exits by its conclusion |
| `ship verify <version>` | The read-back (above) |
| `ship preflight-stable --candidate=<run> [--version=<x.y.z>]` | The stable preflight (above) |
| `ship chain <pr> <version>` | merge → tag → watch → verify; refused from 4.1.17, whose tags need a candidate run of the merge commit (merge, candidate, then tag) |

Each command is idempotent and says what it waits for.

<a name="expected-result"></a>

## Expected result, and how to check it

`ship watch` exits 0 with the release run's success; `ship verify <version>` prints every file checked and exits 0;
the release page shows the files and "Immutable"; `gh attestation verify <file> -R Quest-n-Click/quest-n-click` passes for any
of its files, from 4.5.2. A release made before the transfer to the organization (D51) keeps its attestations under the
user wanoo: `gh attestation verify <file> --owner wanoo --signer-workflow wanoo/quest-n-click/.github/workflows/release.yml`
from 4.2.5 to 4.5.1, `gh attestation verify <file> --owner wanoo --signer-repo wanoo/web-scumm` up to 4.2.4 (`ship
verify` asks each release that way, and says that GitHub's own release attestation of those releases is not checked).

<a name="common-errors"></a>

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| release.yml: "names no candidate run" | The tag was made without `--candidate` | Tag the next version (or `rc.N+1`) with `--candidate`: the tag ruleset refuses deleting a tag |
| release.yml: "run … is not a green candidate started on main" | The run is a pull request's, another branch's, or red | Start `candidate` by hand on main for that SHA |
| release.yml: "has no candidate-site" (or `-surfaces`, `-signing`, `-pack`, `-sbom`, `-image`) | A candidate made before the step existed | Start a new candidate |
| "is published: a published release is never changed" | A rerun on a published tag | Nothing to do; a new version is a new tag |
| `ship tag` refuses: immutable releases off | The setting is not on | Turn it on (above), then tag |
| A failed RC | — | Tag `rc.N+1` from a new candidate |

<a name="files-changed"></a>

## Files or data changed

A tag `v<version>` (signed), a GitHub release with its files and attestations, `.cache/pids/ship-*.pid` locally;
from 4.5.0, the wiki and `publication.json` (through `docs-publish`). The release branch before it edits `CHANGELOG.md`,
`docs/dev/LOG.md` and `docs/dev/passes/<version>.md`.

<a name="recovery"></a>

## Recovery or going back

A published release cannot be changed or removed: a defect is fixed in a new version. A draft is deleted by the next
release run. A tag not yet released can be left alone and a new candidate tagged under the next pre-release number.

<a name="references"></a>

## References

- [`tools/release/ship.mjs`](../../tools/release/ship.mjs), [`tools/release/candidate.mjs`](../../tools/release/candidate.mjs),
  [`tools/release/artifacts.mjs`](../../tools/release/artifacts.mjs), [`tools/release/preflight.mjs`](../../tools/release/preflight.mjs),
  [`tools/release/signing.mjs`](../../tools/release/signing.mjs).
- [`.github/workflows/release.yml`](../../.github/workflows/release.yml), [`.github/workflows/candidate.yml`](../../.github/workflows/candidate.yml).
- D30, D37, D38; ADR 0024. [Field passes](contribute.field-passes.md), [npm packages](contribute.npm-packages.md),
  [Stability and support](start.stability.md#releases).
