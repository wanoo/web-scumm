import { defineRoom } from '@engine/core/define';

// Room 3: the market. Lou left the key with the seller as a deposit; the token buys a go at the flower game (pick),
// the bouquet pays the deposit.
export default defineRoom({
  id: 'market',
  name: 'The market',
  decor: 'decor/market',

  props: {
    stall_left: { img: 'furniture_market/etal_gauche' },
    stall_mid: { img: 'furniture_market/etal_milieu' },
    stall: { name: 'seller\'s stall', img: 'furniture_market/etal_droit' },
    lantern: { name: 'lantern', img: 'world/r3c4' },
    oranges: { name: 'oranges', img: 'minigame/r3c1' },
    bouquet: { name: 'bouquet', img: 'items/r2c1', visible: { all: ['flowers_done', { not: { has: 'bouquet' } }, '!bouquet_given'] } },
  },

  actors: {
    neighbor: { char: 'neighbor', facing: 'right' },
    seller: { char: 'seller', facing: 'left' },
  },

  hotspots: {
    alley: { name: 'alley' },
    blue_door: { name: 'blue door' },
  },

  look: {
    stall: 'Spices, teapots, a lantern. No sardines. What kind of market is this?',
    lantern: 'The lantern Lou wants. Shiny. Not edible.',
    oranges: ['Oranges. Round, orange, not sardines.', 'Still oranges.'],
    bouquet: 'My bouquet! Freshly picked. By me. With paws.',
    neighbor: ['Lou, the neighbour. Fixes everything. Borrows everything.', 'Lou smells of oil and socks.'],
    seller: ['The seller. Big moustache. Bigger smile.', 'He keeps looking at the flowers. Suspicious.'],
    alley: 'The alley goes on and on. Like Biscuit\'s naps. The map is that way.',
    blue_door: 'A big blue door. Locked. Everything is locked today.',
  },

  on: [
    // Token → the flower game (pick). Win → the bouquet appears on the stall.
    { verb: 'give', a: 'token', b: 'seller', if: '!flowers_done', do: [
      { say: ['seller', 'A token? Today I only take flowers. For... reasons.'] },
      { say: ['seller', 'Pick the right three flowers from my bucket, and the token will do.'] },
      { minigame: 'pick', params: {
        rounds: [
          { prompt: 'The seller wants a red flower with a black heart.', options: ['minigame/r1c2', 'minigame/r1c1', 'minigame/r1c3'], answer: 1 },
          { prompt: 'Now a big yellow one that looks at the sun.', options: ['minigame/r1c5', 'minigame/r1c4', 'minigame/r1c2'], answer: 2 },
          { prompt: 'Last one: purple, and it smells like soap.', options: ['minigame/r1c4', 'minigame/r1c3', 'minigame/r1c5'], answer: 0 },
        ],
        decoy: 'minigame/r1c6', decoyLine: 'Ouch! A nettle. Not romantic at all.', wrongLine: 'Not that one. Look again.',
        win: 'A perfect bouquet!',
      }, then: [
        { lose: 'token' }, { set: 'flowers_done' }, { sfx: 'success' },
        { say: ['seller', 'Beautiful! I put it on the stall for you.'] },
      ] },
    ] },
    { verb: 'take', a: 'bouquet', do: [{ gain: 'bouquet' }, { sfx: 'pluck' }, 'For the seller. Not for eating. Sadly.'] },

    // Bouquet → the key.
    { verb: 'give', a: 'bouquet', b: 'seller', do: [
      { lose: 'bouquet' }, { set: 'bouquet_given' },
      { say: ['seller', 'For me? ...Oh no. Today is my wedding anniversary!'] },
      { pose: ['seller', 'panic'] }, { say: ['seller', 'I forgot! You saved me, little cat.'] },
      { pose: ['seller', 'offering'] }, { say: ['seller', 'Here: the key. The lantern is paid.'] },
      { gain: 'key' }, { sfx: 'coins' }, { pose: ['seller', 'idle'] },
      { pose: ['neighbor', 'celebrate'] }, { say: ['neighbor', 'Yes! My lantern!'] },
      'And my sardines!', { pose: ['neighbor', 'idle'] },
    ] },

    { verb: 'take', a: 'lantern', do: [{ say: ['seller', 'Paws off! That lantern is sold. Almost.'] }] },
    { verb: 'take', a: 'oranges', do: ['Oranges are not sardines. Nice try, oranges.'] },
    { verb: ['use', 'open'], a: 'alley', do: [{ map: true }] },
    { verb: ['open', 'push'], a: 'blue_door', do: [{ sfx: 'door_close' }, 'Locked. Of course.'] },
  ],

  talk: {
    neighbor: [
      { topic: 'Where is the pantry key?', do: [
        { say: ['neighbor', 'Ah. I left it with the seller. A deposit for that lantern.'] },
        { say: ['neighbor', 'Pay for the lantern and the key is yours.'] },
        { set: 'deposit_known' },
        { choice: [
          { text: 'That is MY key! Well, Grandma\'s.', do: [
            { pose: ['neighbor', 'pinch'] }, { say: ['neighbor', 'Technically, it is his now. Deposits are serious business.'] }, { pose: ['neighbor', 'idle'] },
          ] },
          { text: 'Fine. How do I pay?', do: [
            { pose: ['neighbor', 'thumbs'] }, { say: ['neighbor', 'He loves tokens. And flowers. Mostly flowers today.'] }, { pose: ['neighbor', 'idle'] },
          ] },
        ] },
      ] },
      { topic: 'Why did you take the key?', do: [
        { say: ['neighbor', 'To make a copy. In case Grandma loses it.'] }, 'She did lose it.', { say: ['neighbor', 'See? I was right.'] },
      ] },
      { topic: 'What is the lantern for?', do: [{ say: ['neighbor', 'For my garage. I fix things at night. Like a bat with a wrench.'] }] },
    ],
    seller: [
      { topic: 'Can I have the key?', do: [
        { say: ['seller', 'The key is Lou\'s deposit. Pay for the lantern, and it is yours.'] },
        { say: ['seller', 'Tokens are fine. Flowers are better. Today, flowers are much better.'] },
      ] },
      { topic: 'Do you sell sardines?', do: [
        { say: ['seller', 'Sardines? No. Spices, teapots, lanterns.'] }, 'Worst. Market. Ever.',
        { pose: ['seller', 'laugh'] }, { wait: 700 }, { pose: ['seller', 'idle'] },
      ] },
      { topic: 'Why flowers today?', do: [{ say: ['seller', 'No reason. Definitely no reason. What day is it?'] }] },
    ],
  },

  hints: [
    { until: 'deposit_known', lines: ['Talk to Lou about the key, sweetie.'] },
    { until: { any: [{ has: 'token' }, 'flowers_done'] }, lines: ['Did you search Grandpa\'s armchair at home? It eats tokens.'] },
    { until: 'flowers_done', lines: ['Give your market token to the seller.'] },
    { until: { any: [{ has: 'bouquet' }, 'bouquet_given'] }, lines: ['Your bouquet is on the stall. Take it.'] },
    { until: { has: 'key' }, lines: ['Give the bouquet to the seller.'] },
    { until: 'pantry_open', lines: ['You have the key! Come home and open the pantry.'] },
  ],

  onEnter: [
    { once: [{ say: ['neighbor', 'Pixel! Over here!'] }, 'Lou! Where is my key?'] },
  ],
});
