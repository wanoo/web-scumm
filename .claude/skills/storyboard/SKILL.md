---
name: storyboard
description: Write or revise the game's storyboard (games/<id>/storyboard.json), publish its review page, read the owner's notes back.
---
# Storyboard

The storyboard is the source of truth for every text in the game. Schema: `tools/pages/storyboard-schema.md`.

1. Write `games/<id>/storyboard.json`: one board per room (title, goal), panels in play order (title, the player
   action that triggers it, lines `{ who, text }`, sfx), the room's hints in puzzle order, talk topics per character,
   optional reactions. Short lines. Every puzzle has a hint chain that ends in the solution.
2. `npm run page:storyboard` → `dist-pages/storyboard.html`. Publish it as an artifact (Artifact tool). Give the link.
3. When the owner has annotated: read the `notes` collection with ArtifactData (`list`), apply the changes to the
   storyboard, write the rewrites into the `rewrites` collection (same panel ids), republish on the same URL.
4. Export `npm run page:storyboard -- --md` → `games/<id>/storyboard.md` for sub-agents.
5. Only then write or update the rooms (`/new-room`).
