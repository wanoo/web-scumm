# Credits

## Code
web-scumm engine and tools: MIT License, (c) 2026 Wano. Built with Vite, Vitest, Howler, earcut, navmesh, Tweakpane, Playwright.

## Sample game artwork (games/demo/art)
Backgrounds, characters, objects and interface icons: generated for the project with an image model from written prompts
(see docs/en/PROMPTS.md), then cut and keyed with the tools in this repository. CC BY 4.0, attribution "Wano".
The four human characters are cartoon caricatures used with the consent of the people they are based on; they are
published under names that are not theirs.

## Music and sound effects (games/demo/audio)
Rendered for the project with the Mega Drive audio pipeline in `tools/audio` (docs/en/AUDIO.md), which drives
[Furnace](https://github.com/tildearrow/furnace) (GPL-2.0, downloaded by `npm run audio -- setup`, not bundled).
- Music: the opening of *Swan Lake*, Scene (Pyotr Ilyich Tchaikovsky, 1876, public domain), arranged for YM2612 + SN76489
  from the MIDI transcription published by [classicals.de](https://www.classicals.de) under CC BY-NC 4.0. The
  arrangement (`audio/projects/swan-lake/spec.json`) and the render are therefore **CC BY-NC 4.0** (non-commercial),
  attribution "classicals.de (transcription), Wano (arrangement)". A commercial game must replace this theme
  (`audio/projects/swan-lake/SOURCE.md`).
- Sound effects: synthesised from `audio/sfx.json` and the shared palette (`tools/audio/palette.json`). CC BY 4.0,
  attribution "Wano".

## Fonts (public/fonts, src/engine/dom/fonts)
- DotGothic16, by Fontworks. SIL Open Font License 1.1 (no Reserved Font Name). The engine ships it whole
  (`public/fonts/`) and as a Latin subset made by `tools/subset-font.py` (`src/engine/dom/fonts/`).
- Press Start 2P, by CodeMan38. SIL Open Font License 1.1.
