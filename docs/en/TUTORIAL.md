# A first room in fifteen minutes

The method, end to end, is [WORKFLOW](WORKFLOW.md); the format, field by field, is [CONTENT_GUIDE](CONTENT_GUIDE.md).
This page is the shortest path from nothing to a room you can play on your phone, with the files you touched named
at each step. Fifteen minutes with a checkout of this repository; the same steps hold in a game project made with
`web-scumm create` ([PACKAGE](PACKAGE.md)), where `games/<id>/` is `game/`.

## 1. A game from the template (one minute)

```bash
npm install
npm run new-game lamp "The Lamp"   # games/lamp from games/_template, set as the current game (.cache/game)
npm run assets                     # the placeholder art into public/assets
npm run dev                        # http://localhost:5173/: a garden, a bucket, a gate
```

The template is a complete game of one room: take the bucket, use it on the gate, the end. Everything you will write
is a variation of what is already there.

## 2. Read the room you are about to change (two minutes)

`games/lamp/rooms/start.ts` is the whole room. Read it top to bottom: `props` (things with an image), `hotspots`
(places on the backdrop), `look` (one line, or three that cycle, for each of them), `on` (the rules: a verb, a
target, a condition, what happens), `hints` (what the hero says when asked, until a flag is set), `onEnter`. Geometry
is not here: `games/lamp/layout/start.json` holds where things stand, and only the Studio or the placement editor
writes it.

## 3. Add a prop and its rule (five minutes)

Add a lamp to the garden. In `rooms/start.ts`:

```ts
props: {
  bucket: { name: 'bucket', img: 'starter/items/bucket' },
  lamp: { name: 'lamp', img: 'starter/items/bucket', states: { off: 'starter/items/bucket', on: 'starter/items/bucket' } },
},
look: {
  // …
  lamp: ['A garden lamp. Off.', 'Still off.', 'It is thinking about it.'],
},
on: [
  // …
  { id: 'start.light-lamp', verb: 'use', a: 'lamp', if: '!lamp_on',
    do: [{ set: 'lamp_on' }, { prop: ['lamp', 'on'] }, 'There. Light.'] },
],
```

The image is the bucket's for now (`npm run prompts` writes the prompt for a real one, and the Studio's Assets tab
cuts what you generate). A rule is a verb, a target, a condition and a list of commands; a string in `do` is a line
the hero says. `{ prop: ['lamp', 'on'] }` switches the prop's state, `{ set: 'lamp_on' }` remembers it in the save.

## 4. Place it (two minutes)

```bash
npm run studio                     # the Studio opens; Rooms tab, "start"
```

The lamp has no place yet, so the Studio shows it at the default spot. Drag it where you want, drag its height, save:
`layout/start.json` gains a `lamp` entry. Never type coordinates by hand; the editor and the Studio exist for that.

## 5. Tell the story first, then check (three minutes)

`games/lamp/storyboard.json` is the source of truth for the text: add a panel to the garden board (`"action": "Use
lamp"`, the line the hero says). The Storyboard tab shows what is implemented and what is not; the Check tab runs the
validator and the solver after every save. From the terminal:

```bash
npm run validate   # a prop without a look line, a flag nothing reads, a rule nobody can reach: said here
npm run solve      # a way from New Game to the end, printed step by step; "softlock" if the player can get stuck
npm test           # the engine's tests and your game's walkthrough (games/lamp/tests/game.test.ts)
```

A rule the solver never needs is not a bug (the lamp is decoration), but `npm run lint` tells you it is decoration.

## 6. Play it on your phone (two minutes)

```bash
npm run dev:lan                    # the dev server on your network; open the printed URL on the phone, landscape
```

Tap the lamp with Use. The line shows, the prop changes, the save remembers it when you reload. That is the loop:
write a rule, place it, check, play. From here: [CONTENT_GUIDE](CONTENT_GUIDE.md) for every field, [CLASSICS](CLASSICS.md)
for twenty famous mechanics written with them, [STUDIO](STUDIO.md) for the tool, [WORKFLOW](WORKFLOW.md) for a whole
game from the first idea to the release.
