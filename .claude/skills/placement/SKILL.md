---
name: placement
description: Place props, actors, hotspots and the walk area of a room, from a phone (artifact page) or in the browser editor.
---
# Placement

Geometry lives in `games/<id>/layout/<room>.json`, never typed by hand.

- In the browser: `npm run dev`, open `/?edit=<room>` (`&at=<checkpoint>` for a given state). Drag, then "Save layout".
- From a phone: `npm run page:placement` → `dist-pages/placement.html`, publish as an artifact, send the link.
  When the owner has placed things: ArtifactData `list` on `layouts`, save each doc to a JSON file, then
  `npm run import-layout <file-or-dir>`.
- Always finish with a screenshot of `?dev&at=<checkpoint>` at 844×390 and look at it. Feet on the floor, approach
  points reachable, walk area covering the floor band, scale lines matching the perspective.
