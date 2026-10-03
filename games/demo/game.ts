import { defineGame } from '@engine/core/define';
import { characters } from './cast';
import { items } from './items';
import { rules } from './rules';
import house from './rooms/house';
import garden from './rooms/garden';
import market from './rooms/market';

// "The Pantry Key": the sample game. Pixel the cat wants the sardines; Grandma lost the pantry key.
// Design: STORY.md. Every line: storyboard.json.
const ALL = ['house', 'garden', 'market'];

export const game = defineGame({
  id: 'demo',
  title: 'The Pantry Key',
  saveVersion: 1,
  hero: 'hero',
  // Talking to the shell phone gives the room's hints, in Grandma's voice (an offscreen character).
  hintItem: 'shell_phone',
  hintVoice: 'grandma_voice',
  verbs: [
    { id: 'give', label: 'Give', color: '#ff8fa3', join: 'to' },
    { id: 'open', label: 'Open', color: '#8fd3ff' },
    { id: 'close', label: 'Close', color: '#8fd3ff' },
    { id: 'take', label: 'Pick up', color: '#ffe08f' },
    { id: 'look', label: 'Look at', color: '#b8ff8f' },
    { id: 'talk', label: 'Talk to', color: '#c9a3ff' },
    { id: 'use', label: 'Use', color: '#ffb36b', join: 'with' },
    { id: 'push', label: 'Push', color: '#9ff' },
    { id: 'pull', label: 'Pull', color: '#9ff' },
  ],
  characters,
  items,
  rooms: [house, garden, market],
  map: {
    start: 'world',
    regions: { world: { name: 'World', image: 'decor/map' } },
    places: {
      house: { name: 'Grandma\'s house', room: 'house', region: 'world', pos: [13, 70], portrait: 'grandma/r1c2', news: { all: [{ has: 'key' }, '!pantry_open'] } },
      garden: { name: 'The garden', room: 'garden', region: 'world', pos: [21, 79], portrait: 'grandpa/r1c2', vehicle: 'car', news: '!tank_drained' },
      market: { name: 'The market', room: 'market', region: 'world', pos: [47, 41], portrait: 'seller/r1c2', vehicle: 'plane', news: { not: { has: 'key' } } },
    },
    vehicles: { car: 'ui/r2c2', plane: 'ui/r2c1', pin: 'ui/r1c6', news: 'ui/r2c4' },
  },
  rules,
  // The world reacts on its own: when the key is found (market), Grandpa goes home for the finale.
  events: [
    { on: 'key_found', once: true, do: [{ moveActor: ['grandpa', 'house'] }, { toast: 'Grandpa went home. With the armchair.' }] },
  ],
  globalTalk: { hug: 'Can I have a cuddle?', bye: 'Bye!', byeLine: 'Bye bye.' },
  start: {
    room: 'house',
    unlocked: ['house'],
    // Opening: the player's guess (judged on the sealed ending's card), then the guided tutorial.
    intro: [
      { say: ['grandma', 'Pixel! Bad news. The sardines are locked in the pantry...'] },
      { say: ['grandma', '...and I lost the key.'] },
      'Wait. What is really in that pantry?',
      { choice: [
        { text: 'Sardines. Obviously.', do: [{ set: ['guess', 'sardines'] }] },
        { text: 'A mouse. A big one.', do: [{ set: ['guess', 'mouse'] }] },
        { text: 'Nothing at all. It is a trap.', do: [{ set: ['guess', 'nothing'] }] },
      ] },
      { say: ['grandma', 'We will see when it is open, fluffball.'] },
      { guide: { verb: 'look', target: 'pantry', say: 'First, LOOK AT the pantry cupboard.' } },
      { guide: { verb: 'talk', target: 'grandma', say: 'Now TALK TO Grandma. Ask about the key.' } },
      { if: { not: { unlocked: 'garden' } }, then: [
        { say: ['grandma', 'Oh, and the key: Grandpa had it last. He is in the garden.'] }, { unlock: 'garden' },
      ] },
      { say: ['grandma', 'Take my shell phone. Talk into it if you get stuck.'] },
      { guide: { verb: 'take', target: 'shell', say: 'PICK UP the shell phone on the table.' } },
      'Garden. Grandpa. Key. Sardines. Easy.',
    ],
  },
  // One ready state per room (?dev&at=<id>, npm run solve -- --from=<id>).
  checkpoints: {
    house: { room: 'house', inventory: ['shell_phone'], unlocked: ['house', 'garden'], flags: { guess: 'sardines' } },
    garden: { room: 'garden', inventory: ['shell_phone', 'token'], unlocked: ['house', 'garden'], flags: { guess: 'sardines' }, props: { 'house.armchair': 'searched' } },
    market: {
      room: 'market', inventory: ['shell_phone', 'token'], unlocked: ALL,
      flags: { guess: 'sardines', pipe_taken: true, tank_drained: true, lou_has_key: true },
      props: { 'house.armchair': 'searched', 'garden.tank': 'draining' },
    },
    finale: {
      room: 'house', inventory: ['shell_phone', 'key'], unlocked: ALL,
      flags: { guess: 'sardines', pipe_taken: true, tank_drained: true, lou_has_key: true, deposit_known: true, flowers_done: true, bouquet_given: true },
      props: { 'house.armchair': 'searched', 'garden.tank': 'draining' },
      where: { grandpa: 'house' },
    },
  },
  // No music yet (the demo runs without it): rooms have no `music`, and `audio.music` is empty.
  audio: {
    music: {},
    sfx: {
      door_open: 'door_open.mp3', door_close: 'door_close.mp3', latch: 'latch.mp3', coins: 'coins.mp3', cloth: 'cloth.mp3',
      paper: 'paper.mp3', click: 'click.mp3', success: 'success.mp3', error: 'error.mp3', ring: 'ring.mp3', drop: 'drop.mp3',
      bell: 'bell.mp3', glass: 'glass.mp3', metal: 'metal.mp3', shuffle: 'shuffle.mp3', chips: 'chips.mp3', pluck: 'pluck.mp3',
      select: 'select.mp3', bong: 'bong.mp3',
    },
  },
  skin: {
    icons: {
      map: 'ui/r1c5', pause: 'ui/r3c5', music: 'ui/r3c6', spark: 'ui/r3c4',
      pin: 'ui/r1c6', news: 'ui/r2c4', plane: 'ui/r2c1', car: 'ui/r2c2',
      confetti: ['ui/r4c1', 'ui/r4c2'], cardFallback: 'ui/r2c5',
    },
    sounds: { phone: 'ring', confetti: 'success' },
    heights: { actor: 115, hero: 36 },
  },
  // The sealed ending: ticket and card texts are encrypted in public/data/dossier.bin (npm run seal), never in the bundle.
  ending: {
    file: 'data/dossier.bin',
    password: { given: 'sardines-for-everyone' },
    guess: {
      flag: 'guess',
      labels: { sardines: 'sardines', mouse: 'a mouse', nothing: 'nothing at all' },
      right: 'You guessed {guess}. Right! Have a sardine.',
      wrong: 'You guessed {guess}. Nope! Nice try, detective.',
      none: 'You guessed {guess}. The pantry keeps its secret.',
    },
    scratch: { ticket: 'items/r4c1', sfx: 'shuffle' },
    card: { accent: '#e8a33d' },
  },
  titleScreen: { decor: 'decor/dining', footer: 'A tiny point-and-click. Turn your phone sideways.' },
  credits: [
    'THE PANTRY KEY', '', 'A web-scumm sample game', '',
    'Pixel ........ the grey cat', 'Biscuit ...... the sleepy cat', 'Grandma ...... the key loser', 'Grandpa ...... the pipe expert',
    'Lou .......... the borrower', 'The seller ... the forgetful husband', '',
    'Sound effects: Kenney (CC0)', 'Art: CC BY 4.0, see CREDITS.md', '', 'Thanks for playing!',
  ],
  ui: {
    walkTo: 'Walk to', newGame: 'New game', continue: 'Continue', confirmErase: 'Erase the saved game?', yes: 'Yes', no: 'No',
    pause: 'Pause', resume: 'Resume', music: 'Music', sfx: 'Sounds', autosave: 'Autosave', credits: 'Credits', restart: 'Restart',
    skip: 'Skip', rotate: 'Rotate your phone', rotateSub: 'This game plays in landscape.', mapTitle: 'Where to?',
    mapLocked: 'Not yet!', mapBack: 'Back', world: 'World', zoomIn: 'Zoom', arrival: 'Arrival:', pickUp: 'Pick up', hangUp: 'Hang up',
    calling: 'calling…', loading: 'Loading…', on: 'on', off: 'off', giveWhat: 'Pick an item from the bag first.', replay: 'Play again',
    miniGame: 'Mini-game', tapToContinue: '▼ tap to continue', ok: 'OK', password: 'Password?',
  },
});
