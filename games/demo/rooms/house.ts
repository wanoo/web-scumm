import { defineRoom } from '@engine/core/define';

// Room 1: Grandma's house. Tutorial (in game.ts, start.intro), the armchair, and the finale at the pantry.
export default defineRoom({
  id: 'house',
  name: 'Grandma\'s house',
  decor: 'decor/dining',
  description: 'Grandma\'s dining room at golden hour, seen from the front. Left: a tall wooden bookshelf with books, plants and a vase, a lamp with an orange shade on a small side table. Center: wide-open French windows with flowered curtains, giving on to a sunny garden, a village and a church spire. Right: a white door to the hall, family pictures on green damask wallpaper. Terracotta tiled floor with a big red rug. Warm, cozy, late-afternoon sun',

  props: {
    pantry: { name: 'pantry cupboard', states: { locked: 'home2/r1c3', open: 'home2/r1c4' }, initial: 'locked' },
    armchair: { name: 'Grandpa\'s armchair', states: { remote: 'home2/r2c1', searched: 'home2/r2c2' }, initial: 'remote' },
    clock: { name: 'clock', img: 'home2/r1c5' },
    table: { img: 'furniture_dining/table' },
    chair: { img: 'furniture_dining/chaise2' },
    shell: { name: 'shell phone', img: 'items/r4c3', visible: { not: { has: 'shell_phone' } } },
    teacup: { name: 'teacup', img: 'home2/r2c3' },
  },

  actors: {
    grandma: { char: 'grandma', facing: 'right' },
    biscuit: { char: 'biscuit', pose: 'sleep' },
  },

  hotspots: {
    window: { name: 'garden window' },
    door: { name: 'hall door' },
    bookshelf: { name: 'bookshelf' },
    lamp: { name: 'lamp' },
  },

  look: {
    pantry: ['The pantry cupboard. The sardines live in there.', 'Locked. I can hear the sardines. (Sardines are silent. I hear them anyway.)',
      'Still locked. Still sardines.', 'I could stare at it all day. I might.'],
    armchair: ['Grandpa\'s armchair. It eats remotes, coins and socks.', 'Something shiny behind the cushion?'],
    clock: ['Tick. Tock. Breakfast o\'clock.', 'Two hours past breakfast, actually.', 'The clock agrees with me: food.'],
    shell: 'Grandma\'s shell phone. Talk into it and Grandma answers. From anywhere.',
    teacup: ['Grandma\'s tea. Lukewarm.', 'Not sardine-flavoured. Pass.'],
    grandma: ['Grandma. Keeper of sardines. Loser of keys.', 'She smells of tea and biscuits. Not Biscuit the cat. The other kind.'],
    biscuit: ['Biscuit. My big brother. Sleeps twenty hours a day.', 'The other four hours, he naps.'],
    window: ['The garden. Grandpa is out there somewhere.', 'Fresh air, birds, flowers. And Grandpa.'],
    door: 'The hall. Nothing to eat there. I checked. Twice.',
    bookshelf: ['Books. Not one about sardines. Disappointing.', 'A cookbook! ...Vegetables. Never mind.'],
    lamp: 'A warm lamp. Good for naps. Everything is good for naps.',
  },

  on: [
    // Tutorial step 3, and the hint item.
    { verb: 'take', a: 'shell', do: [{ gain: 'shell_phone' }, { sfx: 'select' }, 'Got it. It smells like the sea.'] },

    // The armchair: a token behind the cushion, once (the prop state remembers it).
    { verb: ['open', 'pull', 'push', 'use'], a: 'armchair', if: { prop: ['armchair', 'remote'] }, do: [
      { sfx: 'cloth' }, { prop: ['armchair', 'searched'] }, 'Behind the cushion... a market token!', { gain: 'token' },
      'And Grandpa\'s remote. I will leave that one. Too much TV.',
    ] },
    { verb: ['open', 'pull', 'push', 'use'], a: 'armchair', do: ['Just crumbs. Old crumbs.'] },
    { verb: 'look', a: 'armchair', if: { prop: ['armchair', 'searched'] }, do: ['Just an armchair now. A comfy one.'] },

    // The pantry, and the finale.
    { verb: 'look', a: 'pantry', if: { prop: ['pantry', 'open'] }, do: ['Open. An empty tin. A happy cat.'] },
    { verb: ['open', 'use', 'pull'], a: 'pantry', if: { prop: ['pantry', 'locked'] }, do: [{ sfx: 'latch' }, 'Locked. I need the key.'] },
    { verb: 'use', a: 'key', b: 'pantry', if: { prop: ['pantry', 'locked'] }, do: [
      { cutscene: [
        { sfx: 'metal' }, { wait: 300 }, { sfx: 'latch' }, { prop: ['pantry', 'open'] }, { sfx: 'door_open' },
        { used: 'key' }, { set: 'pantry_open' },
        'Open! Sardines! Hello, my little friends.',
        { pose: ['hero', 'eat'] }, { sfx: 'chips' }, { wait: 1400 },
        { pose: ['biscuit', 'idle'] }, { say: ['biscuit', 'Mrrp? Did someone say sardines?'] },
        { face: 'biscuit', who: 'grandma' },
        { say: ['grandma', 'Ha! Two cats, one tin. Share, you two.'] },
        { pose: ['hero', 'idle'] }, 'Fine. Half. Ish.',
      ] },
      { ending: true, after: [
        { say: ['grandma', 'Well done, Pixel. Best breakfast ever.'] },
        'Best. Breakfast. Ever.',
      ] },
    ] },

    // Ways out, and small gags.
    { verb: ['use', 'open', 'push'], a: 'window', if: { unlocked: 'garden' }, do: [{ sfx: 'door_open' }, { goto: 'garden', at: 'house' }] },
    { verb: ['use', 'open', 'push'], a: 'window', do: ['Not yet. First, the key. Grandma knows things.'] },
    { verb: 'open', a: 'door', do: ['The hall. The vacuum cleaner lives there. Our sworn enemy.'] },
    { verb: 'take', a: 'teacup', do: ['Hot tea and cat paws. No.'] },
    { verb: 'push', a: 'clock', do: ['Heavy. And it judges me.'] },
    { verb: 'take', a: 'bookshelf', do: ['A book falls. "Knitting for beginners." I put it back.'] },
  ],

  talk: {
    grandma: [
      { topic: 'Where is the key?', do: [
        { say: ['grandma', 'Grandpa had it last. He is in the garden, fixing the pipes.'] },
        { if: { not: { unlocked: 'garden' } }, then: [{ unlock: 'garden' }, { toast: 'New on the map: the garden' }] },
        { say: ['grandma', 'Go through the big window. Mind the roses.'] },
      ] },
      { topic: 'What is for dinner?', do: [
        { nth: [
          [{ say: ['grandma', 'Sardines. If we find the key.'] }],
          [{ say: ['grandma', 'Still sardines.'] }],
          [{ say: ['grandma', 'Pixel. Sardines. Go.'] }],
        ] },
      ] },
      { topic: 'Why lock the sardines?', do: [
        { say: ['grandma', 'Because a certain cat opens cupboards. A certain grey cat.'] },
        'Biscuit. Definitely Biscuit.',
      ] },
      { topic: 'I found the key!', if: { has: 'key' }, do: [{ say: ['grandma', 'Then what are you waiting for? Open the pantry!'] }] },
    ],
  },

  // Hints from the shell phone (Grandma's voice), in puzzle order.
  hints: [
    { until: { unlocked: 'garden' }, lines: ['Ask me where the key is, sweetie.'] },
    { until: { prop: ['armchair', 'searched'] }, lines: ['Grandpa\'s armchair eats everything. Look behind the cushion.', 'Open the armchair, sweetie. Or pull it.'] },
    { until: 'tank_drained', lines: ['Grandpa is in the garden. Go through the big window.'] },
    { until: { unlocked: 'market' }, lines: ['Something came out of the water tank, no? Read it, then call Lou.'] },
    { until: { has: 'key' }, lines: ['The key is at the market. Open the map.'] },
    { until: 'pantry_open', lines: ['You have the key! Use it on the pantry cupboard.'] },
  ],

  onEnter: [
    { if: { has: 'key' }, then: [{ once: ['Home! Pantry, here I come.'] }] },
  ],
});
