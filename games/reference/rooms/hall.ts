import { defineRoom } from '@engine/core/define';

// The festival office, behind the left blue door: Lou and his big map of the town. He gives the board once the lights
// are back.
export default defineRoom({
  id: 'hall',
  name: 'The festival office',
  decor: 'decor/map',
  description: 'A room papered with a huge old map; Lou\'s office for the festival',
  actors: { neighbor: { char: 'neighbor', facing: 'left' } },
  hotspots: { map: { name: 'big map' } },
  exits: { out: { name: 'back to the street', to: 'street', entry: 'from_hall' } },
  look: {
    map: 'A map of the whole world. Our street is not on it. Rude.',
    neighbor: 'Lou, festival organiser. He has a whistle and a clipboard.',
    out: 'Back to the street.',
  },
  talk: {
    neighbor: [
      { id: 'hall.neighbor.what-does-the-festival', topic: 'What does the festival need?', do: [
        { id: 'hall.neighbor.what-does-the-festival.l-three-things', say: ['neighbor', 'Three things. Lights: the fuse box wants a new cable. A board on the stage. And a lit lamp on the big lamp post.'] },
        { choice: [
          { id: 'hall.neighbor.what-does-the-festival.c-where-is-a-cable', text: 'Where is a cable?', do: [{ id: 'hall.neighbor.what-does-the-festival.c-where-is-a-cable.l-spares-in', say: ['neighbor', 'Spares in Grandma\'s cellar. If she finds the key.'] }] },
          { id: 'hall.neighbor.what-does-the-festival.c-where-is-the', text: 'Where is the board?', do: [{ id: 'hall.neighbor.what-does-the-festival.c-where-is-the.l-here-you-get-it', say: ['neighbor', 'Here. You get it when the lights work. No light, no board. Rules.'] }] },
          { id: 'hall.neighbor.what-does-the-festival.c-where-is-a-lamp', text: 'Where is a lamp?', do: [{ id: 'hall.neighbor.what-does-the-festival.c-where-is-a-lamp.l-there-was-an-old', say: ['neighbor', 'There was an old one on Grandma\'s garden wall.'] }] },
        ] },
      ] },
      { id: 'hall.neighbor.the-lights-are-back', topic: 'The lights are back!', if: { all: ['lights_on', '!board_given'] }, do: [
        { pose: ['neighbor', 'celebrate'] },
        { id: 'hall.neighbor.the-lights-are-back.l-i-saw-here-the', say: ['neighbor', 'I saw! Here, the board. Hang it on the stage, behind the tiled booth.'] },
        { gain: 'board' }, { set: 'board_given' }, { pose: ['neighbor', 'idle'] },
      ] },
    ],
  },
  hints: [{ id: 'hall.hint', until: 'board_given', lines: [{ id: 'hall.hint.l-lou-gives-the', text: 'Lou gives the board once the lights are back.' }] }],
});
