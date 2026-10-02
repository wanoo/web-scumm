# Production plan — « <GAME TITLE> »

<One paragraph: what ships, when, for whom. The one priority everything else bends to, e.g. "a game that can be finished
without a bug, from the title screen to the ending, on the family's phones".>

This file is written to be handed as-is to an orchestrator that launches sub-agents in parallel: every work package
(WP) is autonomous, owns its files, and verifies itself.

**Suggested models per package**
| Package | Model | Why |
|---|---|---|
| Engine changes, shared rules, final QA | the strongest reasoning model available | engine logic and last-minute arbitration |
| Room transcription, assets, minigames | a fast model | large but guided word for word by the storyboard; validate + solve catch mistakes |

## 0. How the orchestrator runs this
1. Launch wave 1: the independent packages in parallel (engine, assets, minigames), then the content packages as soon as
   the engine has delivered the DSL additions they need.
2. Each agent receives this file, its package, and the prompt template of §7. It touches **only** the files its package
   owns. A need outside its package goes into its report; it does not do it.
3. Each agent ends with `npm run validate && npm test` (and `npm run solve` for content packages) and returns a short
   report: done / not done / for another package.
4. Wave 2: the QA package starts when everyone has delivered. It may fix any file, alone.
5. Order of truth when sources disagree: `games/<id>/storyboard.json` > the owner's notes > the current code.
   The storyboard is always right about text; the code is only right about technique.

## 1. Sources of truth (read in this order)
| File | Role |
|---|---|
| `games/<id>/storyboard.json` (+ its Markdown export) | the whole script: boards, panels, lines, optional reactions, hints, talk topics, look lines |
| `docs/en/CONTENT_GUIDE.md`, `ENGINE.md`, `TOOLS.md` | how to write content (DSL), the engine, the tools |
| `games/<id>/layout/*.json` | validated placement (never typed by hand) |
| `games/<id>/art/<sheet>/` | all cut sprites; never recut, never deleted |

## 2. Non-negotiable constraints
- <Private material stays out of the repo: list what.>
- Never delete an asset: rename to `_v1`, `_v2`, keep a backup.
- <Sensitivities of the subject: people who must stay silent, jokes that are refused, tone rules.>
- <Style rules: sentence length, rhythm (normal → normal → normal → absurd), no plain negation as a fallback.>

## 3. State of the project on <date>
**Working:** <engine features, rooms written, items, characters, minigames, tests green, deploy documented.>
**Missing, by importance:** <numbered list.>

## 4. Work packages
### WP-A · Engine (`src/engine/**`)
Owned files: … Deliverables: … Verification: `npm test`, a room screenshot per visual change.
### WP-B · Content (`games/<id>/rooms/**`, `game.ts`, `items.ts`, `cast.ts`)
Split by groups of rooms (B1, B2, B3). Owned files: … Deliverables: every panel of the storyboard transcribed; hints; checkpoints.
Verification: `npm run validate && npm run solve && npm test`.
### WP-C · Assets (`games/<id>/art/**`, `npm run assets`)
### WP-D · Minigames (`src/engine/minigames/**` or `games/<id>/minigames/**`)
### WP-E · QA, pre-production, deployment (wave 2, one agent)
Full e2e playthrough with screenshots, fixes, build, deploy, checklist of §6.

## 5. Ordering and merge rules
<Who waits for whom; one commit per package; commit message format.>

## 6. Final checklist before sending the link
- [ ] `npm run validate`, `npm run solve`, `npm test`, `npm run build` all green
- [ ] e2e playthrough green with screenshots reviewed
- [ ] played once on a real phone, in landscape, with sound
- [ ] nothing private in `dist/` (`npm run audit`)

## 7. Prompt template for a sub-agent
```
You work on the game « <GAME TITLE> » (repo: <path>). Read docs/PRODUCTION.md entirely, then your package: WP-<X>.
You own exclusively the files listed in your package; you change nothing else. A need outside your package goes into your report.
Sources of truth, in order: games/<id>/storyboard.json, the owner's notes, then the code.
Respect §2 without exception.
End with: npm run validate && npm test (and npm run solve for a content package).
Return a report of 15 lines maximum: done / not done and why / what another package must do / verification commands that passed.
```
