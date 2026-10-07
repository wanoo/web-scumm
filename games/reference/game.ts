import { defineGame } from '@engine/core/define';
import { characters } from './cast';
import { items } from './items';
import { rules } from './rules';
import street from './rooms/street';
import market from './rooms/market';
import alley from './rooms/alley';
import backlot from './rooms/backlot';
import yard from './rooms/yard';
import kitchen from './rooms/kitchen';
import cellar from './rooms/cellar';
import hall from './rooms/hall';
import { game as demo } from '../demo/game';

// "The Night Market": web-scumm's reference chapter (3.4, D13: the sample game's art). Pixel and Biscuit light up the
// market before the festival: two playable cats with their own bags, an item handed from one to the other, a floor
// one of them changes for the other, a staged scene with layers, masks, lights and particles, a timed finale, choices,
// a character walking on his own until an event stops him, a minigame, English and French. Design: STORY.md.
export const game = defineGame({
  id: 'reference',
  title: 'The Night Market',
  lang: 'en',
  schemaVersion: 3,
  saveVersion: 1,
  hero: 'hero',
  players: { ids: ['hero', 'biscuit'], start: { biscuit: { room: 'yard' } }, give: 'Here, {nom}. The {objet}. Do not lose it.' },
  verbs: demo.verbs,
  characters: { ...characters, seller: { ...characters.seller, room: 'market' }, neighbor: { ...characters.neighbor, room: 'hall' } },
  items,
  rooms: [street, market, alley, backlot, yard, kitchen, cellar, hall],
  rules,
  // The seller walks his stall between the market and the alley in the dark; the lights bring him back to the market.
  scripts: [
    { stepIds: ['seller_rounds.wait', 'seller_rounds.moveactor', 'seller_rounds.wait-2', 'seller_rounds.moveactor-2'], id: 'seller_rounds', loop: true, while: '!lights_on', do: [{ wait: 7000 }, { moveActor: ['seller', 'alley'] }, { wait: 7000 }, { moveActor: ['seller', 'market'] }] },
  ],
  events: [
    { id: 'game.on-lights', on: 'lights', once: true, do: [{ moveActor: ['seller', 'market'] }, { id: 'game.on-lights.l-the-seller-ran', toast: 'The seller ran back to his stall in the market.' }] },
  ],
  globalTalk: demo.globalTalk,
  start: {
    room: 'street',
    intro: [
      { id: 'game.intro.l-festival-night', say: ['hero', 'Festival night. And every light in the market is out.'] },
      { id: 'game.intro.l-lou-is-in-his', say: ['hero', 'Lou is in his office, behind the left blue door. Biscuit is asleep in the garden. As usual.'] },
    ],
  },
  // A ready state per room the tools start from (?dev&at=<id>, the visual references, the frame-rate gate), and the
  // chapter boundary: the lights back on (a state the witness reaches; npm run solve -- --chapters proves both halves).
  checkpoints: {
    night_market: { room: 'market' },
    garden: { room: 'yard' },
    alley: { room: 'alley' },
    lights: {
      room: 'street', active: 'hero', inventory: ['lit_lamp'],
      flags: { token_found: true, radio_on: true, matches_taken: true, oil_bought: true, lamp_taken: true, ladder_down: true, key_found: true, cellar_open: true, cable_taken: true, lights_on: true },
      props: { 'kitchen.radio': 'on', 'kitchen.cupboard': 'open', 'kitchen.armchair': 'searched' },
      players: { biscuit: { room: 'kitchen' } },
      where: { neighbor: 'hall', seller: 'market' },
      seen: { 'event.game.on-lights': 1 },
      goals: ['lights_on'],
    },
  },
  // The quest journal of the pause menu (4.1.12, ADR 0014); npm run solve -- --goal=100% reaches every one that is not
  // optional. Each is a flag set once on the chapter's path.
  objectives: {
    lights: { title: 'Bring the lights back', done: 'lights_on' },
    ladder: { title: 'Get the ladder down from the wall', done: 'ladder_down', parent: 'lights' },
    cellar: { title: 'Open the cellar', done: 'cellar_open', parent: 'lights' },
    board: { title: 'Hang the festival board', done: 'board_hung' },
    radio: { title: 'Make Grandma dance', done: 'radio_on', optional: true },
  },
  saves: { slots: 3 },
  settings: true,
  // The demo's sounds, and its theme in stems with this chapter's own mixes (3.5): Biscuit's harp and bass, the night
  // without the melody until the lights come back, then the whole orchestra for the festival. Since 3.7 the market has
  // a score of its own (written for the project, games/demo/audio/projects/night-market): the theme lets it in on its
  // next phrase after a bridge, and it hands back on its "home" bar after the other bridge, fading over two beats.
  audio: {
    ...demo.audio,
    music: { ...demo.audio!.music, market: 'night_market.mp3', bridge_to_market: 'bridge_to_market.mp3', bridge_to_theme: 'bridge_to_theme.mp3' },
    scores: {
      theme: { ...demo.audio!.scores!.theme, phraseBars: 4, states: [
        { if: { player: 'biscuit' }, stems: ['harp', 'bass'] },
        { if: '!lights_on', stems: ['strings', 'harp', 'bass'] },
      ] },
      market: {
        stems: { melody: 'night-market-stems/melody.mp3', chords: 'night-market-stems/chords.mp3', bass: 'night-market-stems/bass.mp3' },
        bpm: 96, beatsPerBar: 4, loop: [0, 16], phraseBars: 4, markers: { home: 8 },
        // 42.5 s × 48 kHz × 2 channels × 4 bytes × 3 stems, decoded (npm run audio -- stems).
        pcmBytes: 48960024,
        states: [{ if: '!lights_on', stems: ['chords', 'bass'] }],
      },
    },
    transitions: [
      { from: 'theme', to: 'market', at: 'phrase', bridge: 'bridge_to_market' },
      { from: 'market', to: 'theme', at: 'home', bridge: 'bridge_to_theme', fadeBeats: 2 },
    ],
  },
  skin: { ...demo.skin, icons: { ...demo.skin.icons } },
  titleScreen: { decor: 'decor/market_wide', music: 'theme', footer: 'The reference chapter of web-scumm. Turn your phone sideways.' },
  credits: ['THE NIGHT MARKET', '', 'The reference chapter of web-scumm (3.4)', '', 'Art and sound: the sample game\'s (CC BY 4.0)', 'Music: Swan Lake theme, arranged (CC BY 4.0)', '', 'Thanks for playing!'],
  // Measured with `npm run weight` and `npm run e2e:weight` once built: see BENCH.md "3.4".
  // 3.7: two scores' stems (3.9 MB), the full warm-up (9.2 MB), the most decoded at once during a transition (128 MB:
  // both scores and a bridge).
  assetBudgets: { initialKB: 3000, roomKB: 3000, chapterKB: 6000, backgroundScoreKB: 4800, offlineTotalKB: 11000, decodedAudioMB: 128, transitionPeakMB: 150, initialJsKB: 140 },
  i18n: { same: demo.i18n?.same?.filter((p) => p.startsWith('ui/') || p === 'char:hero/name' || p === 'char:biscuit/name' || p === 'char:neighbor/name').concat(['room:kitchen/props.radio.name']) },
  ui: demo.ui,
});
