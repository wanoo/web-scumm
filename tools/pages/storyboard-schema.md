# storyboard.json

The script of a game, in `games/<id>/storyboard.json`. It is the source of truth for every text; rooms are written
from it. `npm run page:storyboard` renders it for review, `npm run page:storyboard -- --md` exports
`games/<id>/storyboard.md` for agents.

```jsonc
{
  "title": "Optional, defaults to the game title",
  "intro": "Optional paragraph shown at the top of the page",
  "boards": [                                   // one board per room (or per sequence), in play order
    {
      "id": "kitchen",                          // unique; used in note ids
      "title": "The kitchen",
      "room": "kitchen",                        // room id in the game: its decor is shown (optional)
      "goal": "Get the key.",                   // what the player must achieve here
      "music": "kitchen_theme",                 // optional, informative
      "arrival": [ Line ],                      // optional, lines played on entering
      "panels": [                               // one panel per beat, in play order
        {
          "id": "kitchen-1",                    // unique across the storyboard: the notes doc id
          "title": "The drawer",
          "action": "Open drawer",              // optional: the player action that triggers the beat
          "lines": [ Line ],
          "sfx": ["drawer_open"]                // optional: ids of game.audio.sfx (playable on the page if the file exists)
        }
      ],
      "talks": {                                // optional: talk topics per character id
        "grandma": [ { "topic": "Where is the key?", "lines": [ Line ] } ]
      },
      "reactions": [ { "action": "Push fridge", "lines": [ Line ] } ],   // optional reactions, not needed to finish
      "hints": ["Vague hint.", "Precise hint.", "The solution."],         // in puzzle order, vague to precise
      "exit": "Through the garden door."        // optional: how the board ends
    }
  ]
}
```

`Line` is `{ "who": "<speaker>", "text": "…" }`:

- `who` is a character id from `game.characters` (name, colour and portrait come from there);
- `"hero"` is always the hero, whatever its id;
- `"action"` renders as a player action, `"stage"` as a stage direction (italic);
- an unknown id is shown as is, in grey (handy while a character does not exist yet).

Tolerated for convenience (normalised when read): `talk` for `talks`; `talks` as a list
`[{ "who": "grandma", "topics": [...] }]`; topics written `{ "q": …, "answer": [...] }`; `optional` for `reactions`;
a line written as a plain string (the hero says it) or as `["who", "text"]`.

## Annotations (artifact database)

| collection | doc id | content | written by |
| --- | --- | --- | --- |
| `notes` | panel id, `general`, `<board>__talk__<character>`, `<board>__reactions`, `<board>__hints` | `{ text, updatedAt }` | the page (the author's notes) |
| `rewrites` | same ids as `notes` | `{ text }` | Claude (ArtifactData `set`), shown in green under the note |

Ids are kept to letters, digits and `_ - . ~ : @ +` (other characters become `_`), so prefer such ids in the JSON.
