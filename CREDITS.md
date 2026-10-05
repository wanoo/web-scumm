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
- Music: the oboe theme of *Swan Lake* (Pyotr Ilyich Tchaikovsky, 1876, public domain), its notes, harmony and
  arrangement written for the project (`audio/projects/swan-theme/compose.py`, then `spec.json`) and rendered for
  YM2612 + SN76489. No third-party transcription: CC BY 4.0, attribution "Wano" (`audio/projects/swan-theme/SOURCE.md`).
  Since 3.7; the earlier theme, arranged from a CC BY-NC transcription, is gone.
- Sound effects: synthesised from `audio/sfx.json` and the shared palette (`tools/audio/palette.json`). CC BY 4.0,
  attribution "Wano".

## Fonts (public/fonts, src/engine/dom/fonts)
- DotGothic16, by Fontworks. SIL Open Font License 1.1 (no Reserved Font Name). The engine ships it whole
  (`public/fonts/`) and as a Latin subset made by `tools/subset-font.py` (`src/engine/dom/fonts/`).
- Press Start 2P, by CodeMan38. SIL Open Font License 1.1.
