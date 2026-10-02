---
name: new-character
description: Add a character to the current game, from the sheet prompt to the cast entry with mouths and poses.
---
# New character

1. Describe the character in words (age, hair, glasses, build, outfit, signature accessory, personality). Never use a
   real person's photo for likeness unless the owner explicitly consents and the repo is private. Put it in a first cast
   entry in `games/<id>/cast.ts`: `name`, `color`, `kind`, `portrait: '<name>/r1c2'`, `sprites: human('<name>')` (or
   `cat()`), and `description: '<the words>'`.
2. Run `npm run prompts -- --missing` (or the MCP tool `asset_prompts { missing: true }`) and hand the human the
   character's sections of `games/<id>/prompts.md` as-is: the base sheet, the special poses sheet if the rooms use poses
   beyond the standard ones, the mouth kit once `mouths` is set. Never write the prompt by hand. The human saves each image to
   `games/<id>/private/sheets/<sheet>.png`.
3. Cut with the checklist's command, e.g. `python3 tools/cut-sheet.py games/<id>/private/sheets/<name>.png <name>`
   → `games/<id>/art/<name>/r*c*.png` (`--cells` when only some cells are new: never recut a validated sheet).
4. Mouths: add the character to `games/<id>/talk-kits.json`, run `python3 tools/talk-kit.py <name>`, send each kit
   with the mouth-kit prompt, save the answer next to it, `python3 tools/talk-apply.py <name>_<pose>`.
5. Cast entry in `games/<id>/cast.ts`: `name`, `color` (speech colour, readable on dark), `height` (logical px),
   `kind`, `portrait`, `sprites` (use the `human()` / `cat()` helpers), `mouths`, `hug`, `refuse`, optional `variants`.
6. `npm run assets`, `npm run validate`, then a screenshot of a room where the character stands.
