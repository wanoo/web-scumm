# Reality Bridge: a game that reacts to the world outside

Since 4.1.1 a game can react to a fact from outside: an email answered, a webhook called, later a badge shown or a
command typed in a terminal. The game never touches the network: a separate service, the **Reality Bridge**, turns
the fact into a short signed **signal**, and the game applies it like a player's input: once, saved, replayable.
This page is for authors; `docs/en/REALITY-OPS.md` is for whoever runs a Bridge; `docs/dev/THREAT-MODEL.md` and
`docs/dev/reality-spike.md` say why it is built this way.

## Declare the signals

A signal is an identifier from a finite list the game declares. It reaches the game as the event of the same name:

```ts
reality: {
  bridge: 'https://bridge.example/',          // the Bridge the pause menu links to (http://127.0.0.1 while developing)
  signals: [
    { id: 'mail.answer.correct', source: 'mail', availability: 'required', replay: 'record',
      fallback: { verb: 'use', a: 'radio' } },  // what a player does when the outside never answers
    { id: 'mail.answer.wrong', source: 'mail', availability: 'optional', replay: 'record' },
    { id: 'hook.bell', source: 'webhook', availability: 'optional', replay: 'record', once: false },
  ],
},
events: [
  { id: 'mail-opens-gate', on: 'mail.answer.correct', do: [{ set: 'gate_open' }, 'A letter: "Yes."'] },
],
```

- **`id`**: letters, digits and `. _ : -`. Nothing from outside but this identifier reaches the game: no text, no
  address, no payload, so nothing outside can inject a line, a flag or HTML.
- **`availability`**: `required` if the main ending needs it. A required signal names a `fallback`, a rule the player
  can use instead; `npm run validate` checks it matches a rule, and the game must be finishable without the outside.
- **`once`** (default `true`): the signal's effect runs once per game, however many times it arrives. `false`: each
  distinct signal from the Bridge runs it again (a repeated delivery of the same one never does).
- In a game with `reality`, an event listened to that nothing emits nor declares is an error: a typo would otherwise
  wait forever for a signal the Bridge refuses.

The sample game is `games/signals/`: a gate opened by an emailed answer, or by the radio if no answer comes.

## Prove it in every world

A proof never assumes the outside cooperates. `npm run solve:reality` (part of `prove:game` and `web-scumm release`)
proves the game in three kinds of world:

1. **closed**: no signal at all. The game must be finishable through its fallbacks.
2. **each scenario** of `games/<id>/reality/scenarios/*.json` (`{ "signals": ["mail.answer.wrong", "mail.answer.correct"] }`):
   those signals, in that order, each able to arrive at any point after the one before. A required signal needs a
   scenario that sends it.
3. **adversarial**: any declared signal, at any point, again and again.

Each must be solved with no softlock and never truncated. The solver hands the engine the signal itself: no service
is contacted. In the Studio's MCP, `solve` takes `reality` to try a world.

## Try it in the Studio

The Play tab shows a **Reality** panel for a game with `reality`: a button per signal, faults to add (a delay, a
duplicate, a bad signature, expired), the queue reversed, the connection cut and resumed, and what happened to each
delivery. It is a simulated Bridge with a development key: the signal goes through the same verification, session,
save and deduplication as a real one.

## In the player's hands

The pause menu has a **World link** row: "Link this game" shows an 8-character code the player gives to the game's
connector (answers the email with it, types it in the webhook's form); once confirmed, the game is linked. The link
is announced politely, never over a line being said. Signals that arrive while the game is busy (a dialogue, a
cutscene, a minigame) wait for it. Offline, the game plays on; back online, what arrived meanwhile is applied.

What the browser keeps: the Bridge's URL, a pseudonymous player id and a capability that can only read and
acknowledge this game's signals, under `<game>:reality-link` in localStorage. They are never written into a save or
a session. A new game on the same device keeps the link.

The interface texts are `realityLink`, `realityStart`, `realityCode`, `realityWaiting`, `realityOpen`,
`realityOffline`, `realityRevoked`, `realityNone`, `realitySimulated`, `realityUnlink` in the game's `ui`
(English defaults in `src/engine/dom/reality-ui.ts`).

## What the session and the save hold

A signal is an entry of the session (`{ external: { id, sequence, signal, source, receivedAt } }`): `npm run replay`
applies it offline, with no Bridge. The save keeps the last sequence received without a gap and the ids above it
(`GameState.reality`), so a signal delivered again (the Bridge delivers at least once) is recognised and not applied
twice.

## The API

`web-scumm/reality` (`docs/en/API.md`): the signed signal and its verification, the client and its HTTP transport,
the simulator, the manifest. A game with its own transport implements `WorldSignalPort`.
