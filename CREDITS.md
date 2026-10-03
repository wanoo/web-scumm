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
  from a MIDI transcription; the arrangement (`audio/projects/swan-lake/spec.json`) and the render are CC BY 4.0,
  attribution "Wano".
- Sound effects: synthesised from `audio/sfx.json` and the shared palette (`tools/audio/palette.json`). CC BY 4.0,
  attribution "Wano".

## Fonts (public/fonts)
- DotGothic16, by Fontworks. SIL Open Font License 1.1.
- Press Start 2P, by CodeMan38. SIL Open Font License 1.1.
- VT323, by Peter Hull. SIL Open Font License 1.1.
