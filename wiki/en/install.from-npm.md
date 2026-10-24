# Install from npm, once published

**The engine is not published on npm.** On 23 Oct 2026, `npm view` answers `404 Not Found` for `quest-n-click`,
`create-quest-n-click`, `quest-n-click-bridge`, `quest-n-click-connectors` and `quest-n-click-studio-server`. Until a
release's notes say otherwise, install from the release archive: [Install from the release archive](install.from-archive.md).
This page says how to tell when npm is ready, and what the commands will be then.

<a name="what-you-get"></a>

## What you get

Today: a way to check, in one command, whether a `quest-n-click` package on npm is the project's. Once the packages are
published: a game project created and upgraded with npm's usual commands, without an archive URL.

<a name="context-and-versions"></a>

## Context and versions

- A **created project**, on your machine.
- Nothing has ever been published to npm, up to and including 4.4.0. 4.2.0 went to GitHub Releases only (D38):
  publishing needs the maintainer's two-factor authentication at each step, and 4.2.0 did not wait for it. The README
  says npm publishing comes in a later release; no version is promised.
- Until the first publication, the names are only watched: a job of the nightly workflow (`npm-names`, never gating)
  checks that each name, the current ones and the former `web-scumm…` ones, is still free or published by the
  maintainer's npm user, and warns otherwise. Someone else taking a name first is a risk the project accepted (D34).

> [!LIMIT id=npm-not-published]
> No `npm install quest-n-click`, `npx create-quest-n-click` or `npm install quest-n-click@<version>` works today: npm
> answers 404. A package under one of these names that appears on npm before a release announces it is not the
> project's: do not install it.

<a name="prerequisites"></a>

## Prerequisites

- The [Requirements](install.requirements.md) of any game project: Node.js 22.12 or newer, Python 3 for the art.
- A release whose notes announce the npm publication.

<a name="where-to-run"></a>

## Where to run the commands

On your machine, from the folder that will contain the project; then inside the created project.

<a name="steps"></a>

## Steps

<!-- step: check-owner -->
1. Check that the package exists and is the project's. Its maintainer must be `wanoo` and its repository
   `github.com/Quest-n-Click/quest-n-click`:

   ```bash
   # anywhere
   npm view quest-n-click maintainers repository.url
   ```

   Today this prints `npm error 404 Not Found`: stop here and use the [release archive](install.from-archive.md).

<!-- step: create-from-npm -->
2. Create the project. Either command does the same thing (`create-quest-n-click` runs `quest-n-click create` from the
   engine it depends on):

   ```bash
   # in the folder that will contain the project
   npx create-quest-n-click my-game "My Game"     # or: npx quest-n-click create my-game "My Game"
   ```

   Without `--engine`, `create` writes the dependency `"quest-n-click": "^<version>"`, which npm resolves from the
   registry.

<!-- step: install-and-play -->
3. Install, prepare the art and play, as from the archive:

   ```bash
   # from the folder that contains the project, then inside it
   cd my-game
   npm install
   python3 -m pip install -r node_modules/quest-n-click/requirements.txt
   npm run assets && npm run dev
   ```

<a name="expected-result"></a>

## Expected result, and how to check it

Once published, step 1 prints the maintainer and the repository; step 2 ends with
`my-game: "My Game" created (quest-n-click ^<version>).` A project made from an archive moves to the registry with
`npm install quest-n-click@<version>`, which replaces the archive's URL in its `package.json` by a version range.

<a name="common-errors"></a>

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| `npm error 404 Not Found - GET https://registry.npmjs.org/quest-n-click` | Not published yet | [Install from the release archive](install.from-archive.md) |
| `npm view` shows a maintainer other than `wanoo` | A name taken by someone else | Do not install it; report it on the project's issues |

<a name="files-changed"></a>

## Files or data changed

Step 1 changes nothing. Steps 2 and 3 write the same project as [from the archive](install.from-archive.md#files-changed);
only the dependency in `package.json` differs (a range instead of a URL).

<a name="recovery"></a>

## Recovery or going back

A project created from npm goes back to an archive with `npm install <archive URL>`, as
[Upgrade](install.upgrade.md) describes.

<a name="how-it-will-be-published"></a>

## How the publication is prepared

The procedure was written in 4.1.20 and is played by the maintainer in a later release; the details are on
[npm packages](contribute.npm-packages.md). What a user can rely on:

- **Staged publishing with a person's approval.** The release run stages each package through GitHub's OIDC (trusted
  publishing, configured stage-only: CI may stage, never publish), and the maintainer promotes each one with
  two-factor authentication (`npm stage approve <id>`, or on npmjs.com). A version of the product never comes from a
  local publication, which would carry no OIDC provenance; only a reservation version `0.0.0-bootstrap.0` may, once per
  package, to create it.
- **Exact tools.** Staged publishing needs npm 11.15.0 and Node 22.14.0 at least. `release.yml` pins the publishing
  step's versions exactly, `NPM_PUBLISH_NODE: 22.23.3` and `NPM_PUBLISH_NPM: 11.21.0`, and a test refuses a range. Node
  22.23.3 ships npm 10.9.9, so the step will install npm 11.21.0 itself. At 4.4.0 only the pins exist: the publishing
  step itself is not written yet.
- **The connectors are not declared dual-use.** npm's dual-use policy covers tools that can resemble malicious
  software (penetration testing, security research, obfuscation); the connectors are servers a game runs (an SSH and a
  Telnet front, an email webhook and IMAP reader, an Open Badge verifier), scanning, attacking and hiding nothing.
  They go through the same staged publishing and two-factor promotion as the other packages. If npm's scan holds or
  flags the package, it gets `"contentPolicy": { "class": "dual-use" }` and a `DISCLOSURE` file.

<a name="references"></a>

## References

- [Install from the release archive](install.from-archive.md), [Package reference](install.package.md)
- [npm packages](contribute.npm-packages.md) (the maintainer's procedure), [Releasing](contribute.releasing.md)
- npm's documentation: [staged publishing](https://docs.npmjs.com/staged-publishing),
  [dual-use policy](https://docs.npmjs.com/policies/dual-use/)
- [`.github/workflows/nightly.yml`](../../.github/workflows/nightly.yml) (the `npm-names` job),
  [`.github/workflows/release.yml`](../../.github/workflows/release.yml) (the pins)
