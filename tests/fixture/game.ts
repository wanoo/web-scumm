import { defineGame } from '@engine/core/define';

// Tiny game for engine tests: 2 rooms, 2 characters, 3 items, 1 minigame (hide).
// It depends on no asset: the manifest is empty.
export const game = defineGame({
  id: 'fixture',
  title: 'Fixture',
  saveVersion: 1,
  hero: 'hero',
  hintItem: 'talkie',
  verbs: [
    { id: 'give', label: 'Give', color: '#f88', join: 'to' },
    { id: 'open', label: 'Open', color: '#8ff' },
    { id: 'take', label: 'Take', color: '#ff8' },
    { id: 'look', label: 'Look', color: '#8cf' },
    { id: 'talk', label: 'Talk', color: '#8f8' },
    { id: 'use', label: 'Use', color: '#fa4', join: 'with' },
    { id: 'push', label: 'Push', color: '#c9f' },
  ],
  characters: {
    hero: { name: 'Hero', color: '#fff', height: 84, sprites: { idle: ['hero/idle'] } },
    grandma: { name: 'Grandma', color: '#f9c', kind: ['person'], refuse: 'No thanks, dear.', hug: 'Come here!', sprites: { idle: ['grandma/idle'] } },
  },
  items: {
    talkie: { name: 'talkie', icon: 'items/talkie', look: 'A walkie-talkie.' },
    coin: { name: 'coin', icon: 'items/coin', look: ['A shiny coin.', 'Still shiny.'] },
    key: { name: 'key', icon: 'items/key', look: 'The shed key!' },
  },
  rooms: [
    {
      id: 'house', name: 'House', decor: 'decor/house',
      props: { lamp: { name: 'lamp', states: { off: 'props/lamp_off', on: 'props/lamp_on' }, initial: 'off' } },
      actors: { grandma: { char: 'grandma' } },
      hotspots: { drawer: { name: 'drawer' }, door: { name: 'door' } },
      look: { lamp: 'A lamp.', drawer: ['An old drawer.', 'Still an old drawer.'], grandma: 'Grandma knits.', door: 'The garden door.' },
      on: [
        { verb: 'use', a: 'lamp', do: [{ prop: ['lamp', 'on'] }, 'Light!'] },
        { verb: 'open', a: 'drawer', if: '!coin_found', do: [{ gain: 'coin' }, { set: 'coin_found' }, 'A coin.'] },
        { verb: 'give', a: 'coin', b: 'grandma', do: [{ lose: 'coin' }, { say: ['grandma', 'Thanks! Here is the key.'] }, { gain: 'key' }, { unlock: 'garden' }] },
        { verb: 'use', a: 'door', if: { unlocked: 'garden' }, do: [{ goto: 'garden' }] },
      ],
      talk: {
        grandma: [
          { topic: 'Where is the key?', do: [{ say: ['grandma', 'Bring me a coin.'] }] },
          { topic: 'Nice weather.', do: [{ say: ['grandma', 'Lovely.'] }] },
        ],
      },
      hints: [
        { until: 'coin_found', lines: ['Look in the drawer.', 'The DRAWER.'] },
        { until: { has: 'key' }, lines: ['Grandma wants the coin.'] },
      ],
    },
    {
      id: 'garden', name: 'Garden', decor: 'decor/garden',
      hotspots: { shed: { name: 'shed' } },
      look: { shed: 'The shed.' },
      on: [
        { verb: 'use', a: 'key', b: 'shed', do: [
          { minigame: 'hide', params: { spots: [{ img: 'props/box', x: 200, y: 300, h: 60 }, { img: 'props/box', x: 400, y: 300, h: 60 }], answer: 1 } },
          'Found it!', { end: true },
        ] },
      ],
      hints: [{ until: 'never', lines: ['Use the key on the shed.'] }],
    },
  ],
  map: {
    start: 'world',
    regions: { world: { name: 'World', image: 'decor/map' } },
    places: {
      house: { name: 'House', room: 'house', region: 'world', pos: [30, 50] },
      garden: { name: 'Garden', room: 'garden', region: 'world', pos: [70, 50], vehicle: 'car' },
    },
  },
  rules: {
    fallbacks: {
      give: ['No.'], open: ['It does not open.', 'Still closed.'], take: ['I cannot take that.'], look: ['Nothing special.'],
      talk: ['No answer.'], use: ['Nothing happens.'], push: ['It does not move.', 'Nope.'], use2: ['These do not go together.'],
    },
    kinds: [{ verb: 'take', kind: 'person', say: 'I cannot carry {nom}.' }],
  },
  globalTalk: { hug: 'Hug?', bye: 'Bye', byeLine: 'See you!' },
  start: { room: 'house', inventory: ['talkie'], unlocked: ['house'], intro: [{ guide: { verb: 'look', target: 'lamp', say: 'Look at the lamp first.' } }] },
  checkpoints: { free: { room: 'house', inventory: ['talkie'], unlocked: ['house'] } },
  skin: { icons: { map: 'ui/map', pause: 'ui/pause', music: 'ui/music' } },
  ui: {
    walkTo: 'Walk to', newGame: 'New game', continue: 'Continue', confirmErase: 'Erase?', yes: 'Yes', no: 'No', pause: 'Pause',
    resume: 'Resume', music: 'Music', sfx: 'Sounds', autosave: 'Autosave', credits: 'Credits', restart: 'Restart', skip: 'Skip',
    rotate: 'Rotate', rotateSub: 'Landscape please', mapTitle: 'Where to?', mapBack: 'Back', world: 'World', zoomIn: 'Zoom',
    arrival: 'Arrival:', pickUp: 'Pick up', calling: 'calling…', loading: 'Loading…', on: 'on', off: 'off', giveWhat: 'Pick an item first.',
    replay: 'Replay', miniGame: 'Mini-game', tapToContinue: '▼ tap to continue', ok: 'OK',
  },
});
