# Screen-reader pass (manual, before a release)

Automation proves the keyboard and axe's rules (`npm run e2e:a11y`, `npm run e2e -- --keyboard --axe`); it does not
prove what a screen-reader user hears. Once per release, a person plays the production build with VoiceOver (iOS
Safari, landscape) or TalkBack (Android Chrome), and writes the result in `docs/dev/passes/<version>.md` (from
`docs/dev/passes/TEMPLATE.md`: device, OS and browser versions, reader, what failed). A release whose pass is not done
says so in its notes (D12).

Turn the reader on, open the game's URL, then check each line.

1. **Title.** The game's name is read; "New game" (and "Continue" when a save exists) are buttons with their names.
2. **A room.** Entering a room announces its name. Swiping reaches the verbs (the chosen one says "selected"), then
   the scene's targets by name, then the bag's items by name, then Map, Pause and Sound.
3. **An action.** Choose a verb and a target: the sentence and each line of dialogue are read once, with who speaks.
   The "tap to continue" marker is announced (`ui.advance`) and a double tap advances.
4. **An item gained.** Picking something up announces the item.
5. **A conversation.** The topics are read as a list of choices; a seen topic is distinguishable; "Bye" ends it.
6. **The map.** Opening it moves the reader into the map; each place is read by name; closing it returns to the
   room.
7. **The pause menu.** The reader stays inside the menu; Save, Load, the slots ("Slot 1 · <room> · <date>" or
   "empty") and the confirmations are read; Resume returns to the game.
8. **A minigame** (the demo's flowers at the market, or the pipes in the garden). The instruction is read; the
   options or tiles have names ("1 / 3", "row, column"); Skip is reachable and named.
9. **The ending.** The scratch ticket is reachable; once scratched, the revealed text is read.

Anything that fails is a bug with its screen, the reader, and what was heard instead.
