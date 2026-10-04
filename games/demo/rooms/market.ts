import { defineRoom } from '@engine/core/define';

// Room 3: the market. Lou left the key with the seller as a deposit; the token buys a go at the flower game (pick),
// the bouquet pays the deposit.
export default defineRoom({
  id: 'market',
  music: 'theme',
  name: 'The market',
  // A wide room (layout `width: 960`, a 1.5-screen backdrop): the camera follows Pixel; `camera` commands pan it.
  decor: 'decor/market_wide',
  description: 'A North African market street at dusk, seen down its length. Left: spice stalls with cones of colourful spices, baskets and crates, shelves of brass lanterns, rugs hanging above. Center: an alley of stone arches lit by hanging lanterns, a minaret against a violet sky. Right: a big blue studded door in a tiled wall, potted plants, bougainvillea, an awning with tassels. Warm cobblestones. Glowing, festive evening light',

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
    far_stalls: { name: 'far stalls' },
  },

  look: {
    stall: 'Spices, teapots, a lantern. No sardines. What kind of market is this?',
    lantern: 'The lantern Lou wants. Shiny. Not edible.',
    oranges: ['Oranges. Round, orange, not sardines.', 'Still oranges.'],
    bouquet: 'My bouquet! Freshly picked. By me. With paws.',
    neighbor: ['Lou, the neighbour. Fixes everything. Borrows everything.', 'Lou smells of oil and socks.'],
    seller: ['The seller. Big moustache. Bigger smile.', 'He keeps looking at the flowers. Suspicious.'],
    far_stalls: ['More stalls, further down. Also no sardines.', 'A whole market and not one fish.'],
    blue_door: 'A big blue door. Locked. Everything is locked today.',
  },

  on: [
    // Looking down the alley pans the camera to the far stalls, then back to Pixel.
    { id: 'market.look-alley', verb: 'look', a: 'alley', do: [{ camera: { to: 'far_stalls', ms: 900 } }, { say: ['hero', 'The alley goes on and on. Like Biscuit\'s naps. The map is that way.'], id: 'market.look-alley.l-the-alley-goes' }, { camera: 'follow' }] },
    // Token → the flower game (pick). Win → the bouquet appears on the stall.
    { id: 'market.give-token-seller', verb: 'give', a: 'token', b: 'seller', if: '!flowers_done', do: [
      { id: 'market.give-token-seller.l-a-token-today-i', say: ['seller', 'A token? Today I only take flowers. For... reasons.'] },
      { id: 'market.give-token-seller.l-pick-the-right', say: ['seller', 'Pick the right three flowers from my bucket, and the token will do.'] },
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
        { id: 'market.give-token-seller.l-beautiful-i-put', say: ['seller', 'Beautiful! I put it on the stall for you.'] },
      ] },
    ] },
    { id: 'market.take-bouquet', verb: 'take', a: 'bouquet', do: [{ gain: 'bouquet' }, { sfx: 'pluck' }, { say: ['hero', 'For the seller. Not for eating. Sadly.'], id: 'market.take-bouquet.l-for-the-seller' }] },

    // Bouquet → the key.
    { id: 'market.give-bouquet-seller', verb: 'give', a: 'bouquet', b: 'seller', do: [
      { lose: 'bouquet' }, { set: 'bouquet_given' },
      { id: 'market.give-bouquet-seller.l-for-me-oh-no', say: ['seller', 'For me? ...Oh no. Today is my wedding anniversary!'] },
      { pose: ['seller', 'panic'] }, { id: 'market.give-bouquet-seller.l-i-forgot-you', say: ['seller', 'I forgot! You saved me, little cat.'] },
      { pose: ['seller', 'offering'] }, { id: 'market.give-bouquet-seller.l-here-the-key-the', say: ['seller', 'Here: the key. The lantern is paid.'] },
      { gain: 'key' }, { sfx: 'coins' }, { pose: ['seller', 'idle'] },
      { pose: ['neighbor', 'celebrate'] }, { id: 'market.give-bouquet-seller.l-yes-my-lantern', say: ['neighbor', 'Yes! My lantern!'] },
      { say: ['hero', 'And my sardines!'], id: 'market.give-bouquet-seller.l-and-my-sardines' }, { pose: ['neighbor', 'idle'] },
      // The world hears it: Grandpa goes home (game.ts `events`).
      { emit: 'key_found' },
    ] },

    { id: 'market.take-lantern', verb: 'take', a: 'lantern', do: [{ id: 'market.take-lantern.l-paws-off-that', say: ['seller', 'Paws off! That lantern is sold. Almost.'] }] },
    { id: 'market.take-oranges', verb: 'take', a: 'oranges', do: [{ say: ['hero', 'Oranges are not sardines. Nice try, oranges.'], id: 'market.take-oranges.l-oranges-are-not' }] },
    { id: 'market.use-alley', verb: ['use', 'open'], a: 'alley', do: [{ map: true }] },
    { id: 'market.open-blue-door', verb: ['open', 'push'], a: 'blue_door', do: [{ sfx: 'door_close' }, { say: ['hero', 'Locked. Of course.'], id: 'market.open-blue-door.l-locked-of-course' }] },
  ],

  talk: {
    neighbor: [
      { id: 'market.neighbor.where-is-the-pantry-key', topic: 'Where is the pantry key?', do: [
        { id: 'market.neighbor.where-is-the-pantry-key.l-ah-i-left-it', say: ['neighbor', 'Ah. I left it with the seller. A deposit for that lantern.'] },
        { id: 'market.neighbor.where-is-the-pantry-key.l-pay-for-the', say: ['neighbor', 'Pay for the lantern and the key is yours.'] },
        { set: 'deposit_known' },
        { choice: [
          { id: 'market.neighbor.where-is-the-pantry-key.c-that-is-my-key', text: 'That is MY key! Well, Grandma\'s.', do: [
            { pose: ['neighbor', 'pinch'] }, { id: 'market.neighbor.where-is-the-pantry-key.c-that-is-my-key.l-technically-it', say: ['neighbor', 'Technically, it is his now. Deposits are serious business.'] }, { pose: ['neighbor', 'idle'] },
          ] },
          { id: 'market.neighbor.where-is-the-pantry-key.c-fine-how-do-i', text: 'Fine. How do I pay?', do: [
            { pose: ['neighbor', 'thumbs'] }, { id: 'market.neighbor.where-is-the-pantry-key.c-fine-how-do-i.l-he-loves-tokens', say: ['neighbor', 'He loves tokens. And flowers. Mostly flowers today.'] }, { pose: ['neighbor', 'idle'] },
          ] },
        ] },
      ] },
      { id: 'market.neighbor.why-did-you-take-the-key', topic: 'Why did you take the key?', do: [
        { id: 'market.neighbor.why-did-you-take-the-key.l-to-make-a-copy', say: ['neighbor', 'To make a copy. In case Grandma loses it.'] }, { say: ['hero', 'She did lose it.'], id: 'market.neighbor.why-did-you-take-the-key.l-she-did-lose-it' }, { id: 'market.neighbor.why-did-you-take-the-key.l-see-i-was-right', say: ['neighbor', 'See? I was right.'] },
      ] },
      { id: 'market.neighbor.what-is-the-lantern-for', topic: 'What is the lantern for?', do: [{ id: 'market.neighbor.what-is-the-lantern-for.l-for-my-garage-i', say: ['neighbor', 'For my garage. I fix things at night. Like a bat with a wrench.'] }] },
    ],
    seller: [
      { id: 'market.seller.can-i-have-the-key', topic: 'Can I have the key?', do: [
        { id: 'market.seller.can-i-have-the-key.l-the-key-is-lou-s', say: ['seller', 'The key is Lou\'s deposit. Pay for the lantern, and it is yours.'] },
        { id: 'market.seller.can-i-have-the-key.l-tokens-are-fine', say: ['seller', 'Tokens are fine. Flowers are better. Today, flowers are much better.'] },
      ] },
      { id: 'market.seller.do-you-sell-sardines', topic: 'Do you sell sardines?', do: [
        { id: 'market.seller.do-you-sell-sardines.l-sardines-no', say: ['seller', 'Sardines? No. Spices, teapots, lanterns.'] }, { say: ['hero', 'Worst. Market. Ever.'], id: 'market.seller.do-you-sell-sardines.l-worst-market' },
        { pose: ['seller', 'laugh'] }, { wait: 700 }, { pose: ['seller', 'idle'] },
      ] },
      { id: 'market.seller.why-flowers-today', topic: 'Why flowers today?', do: [{ id: 'market.seller.why-flowers-today.l-no-reason', say: ['seller', 'No reason. Definitely no reason. What day is it?'] }] },
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
    { id: 'market.enter.once', once: [{ id: 'market.enter.once.l-pixel-over-here', say: ['neighbor', 'Pixel! Over here!'] }, { say: ['hero', 'Lou! Where is my key?'], id: 'market.enter.once.l-lou-where-is-my' }] },
  ],

  // Lou cannot stand still: a stroll along the stalls, on its own, until the deal is done.
  scripts: [
    { stepIds: ['lou_paces.wait', 'lou_paces.walk', 'lou_paces.face', 'lou_paces.wait-2', 'lou_paces.walk-2', 'lou_paces.face-2'], id: 'lou_paces', loop: true, while: '!bouquet_given', do: [
      { wait: 6000 }, { walk: [760, 300], who: 'neighbor' }, { face: 'left', who: 'neighbor' }, { wait: 3000 },
      { walk: [147, 278], who: 'neighbor' }, { face: 'right', who: 'neighbor' },
    ] },
  ],
});
