---
name: new-character
description: Add a character to the current game, from the sheet prompt to the cast entry with mouths and poses.
---
# New character

1. Describe the character in words (age, hair, glasses, build, outfit, signature accessory, personality). Never use a
   real person's photo for likeness unless the owner explicitly consents and the repo is private.
2. Generate the base sheet with the character prompt of `docs/en/PROMPTS.md` (6 × 4 grid, flat `#2B2E45` background),
   attach the project's reference sheet for style. Save to `games/<id>/private/<name>_sheet.png`.
3. `python3 tools/cut-sheet.py games/<id>/private/<name>_sheet.png <name>` → `games/<id>/art/<name>/r*c*.png`.
4. Mouths: add the character to `games/<id>/talk-kits.json`, run `python3 tools/talk-kit.py <name>`, send each kit
   with the mouth-kit prompt, save the answer next to it, `python3 tools/talk-apply.py <name>_<pose>`.
5. Cast entry in `games/<id>/cast.ts`: `name`, `color` (speech colour, readable on dark), `height` (logical px),
   `kind`, `portrait`, `sprites` (use the `human()` / `cat()` helpers), `mouths`, `hug`, `refuse`, optional `variants`.
6. `npm run assets`, `npm run validate`, then a screenshot of a room where the character stands.
