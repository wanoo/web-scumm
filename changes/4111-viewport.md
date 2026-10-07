### Changes

- **The semantic journal (4.1.11).** `Engine.journal` numbers what happened in the game, in ids: a session started, a
  room entered (and from where), an item acquired or lost, a flag changed (only when its value changes), an ending
  reached, a load, and the autosave that follows something semantic. The command handlers, a room's entry and the
  engine's lifecycle emit it, nothing in the DOM does, and a kind it does not know is refused. Replaying a session yields
  the same journal (the sample game, the reference chapter, 200 generated games). A session file carries it;
  `npm run replay` prints it and exits 1 when the replay's differs; the dev panel lists the latest events.
- **The scene frame (4.1.11, ADR 0011).** The room view makes an immutable `SceneFrame` (camera, layers, characters,
  targets with their hit polygons precomputed, effects, a hash) with a pure function, then paints it. Taps are tested
  against the frame and the accessible buttons follow its targets, whatever paints the room. Every room of the sample
  game and of the reference chapter, in three states, paints the same DOM and answers the same taps as before.
- **The player's input is an intention (4.1.11, D21).** `App` composes the engine, a `Presenter` (`dom/presenter.ts`:
  the scene's calls, lines, overlays, minigames, the ending) and the room view's `Renderer`; a verb on a target, a
  walk, a choice, a skip or a screen opened goes through the presenter's `intent()`. The same clicks on the DOM and on
  the Canvas painter record the same session and journal, at device pixel ratios 1, 2 and 3, on a phone and a desktop
  screen, with and without reduced motion. The busy state (runs, the tutorial step, a skip) is `core/busy.ts`; a skip
  left pending no longer outlives a new game or a load. The page's test hook moved with it:
  `window.__game.presenter.inventory(…)` where e2e scripts called `window.__game.inventory(…)`.
- **The Canvas painter survives a lost context (4.1.11).** Nothing is painted while the browser has reclaimed the
  canvas; once restored, the background, the masks and the occluders are rebuilt from their images and the room is
  painted again. The route between walk zones is the core's (`core/motion.ts` `zoneRoute`), the walker walks it.
- **The Studio edits a room's layers, masks, zones and portals (4.1.11).** Under the room sheet of the Rooms tab: each
  layer's depth, parallax, opacity and blend; occlusion masks and walk zones drawn as polygons on the backdrop; links
  between zones placed by two clicks; **Save stage** writes the geometry over the room's layout.
- **The validator refuses a mask polygon that closes no surface and, in a room of several walk zones, a zone no link
  joins (4.1.11).** A layout that validated in 4.1.10 with a degenerate mask polygon (collinear points, crossing edges)
  now fails `npm run validate`; the bundled games pass.
- **API (4.1.11), additive.** `web-scumm/player`: `SceneFrame`, `Renderer`, `Intent` (`@extension`).
  `web-scumm/testing`: `SemanticEvent`, `SemanticJournal` (`@public`). `Engine.journal` and `Engine.sessionSeq` are new
  members of `Engine`.
