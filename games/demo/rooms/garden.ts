import { defineRoom } from '@engine/core/define';

// Room 2: the garden. The pipe, the water tank (pipes minigame), the sock and its note, then the call to Lou.
export default defineRoom({
  id: 'garden',
  music: 'theme',
  name: 'The garden',
  decor: 'decor/backyard',
  description: 'A sunny cottage garden behind the house, in the afternoon. Left: the stone house with green shutters, climbing roses and a back door up three stone steps, terracotta pots. Center: a wrought-iron bench, a green watering can, flower beds of lavender and daisies along a low stone wall. Right: a green wooden garden gate, a cherry tree full of red cherries with a birdhouse, a garden gnome in the flowers. A sandy gravel path as floor. Warm, bright, cheerful',

  props: {
    tank: { name: 'water tank', states: { full: 'house/r3c5', draining: 'house/r3c6' }, initial: 'full' },
    spare_pipe: { name: 'pipe', img: 'house/r4c1', visible: '!pipe_taken' },
    sock: { name: 'sock', img: 'minigame/r4c1', visible: 'tank_drained' },
  },

  actors: {
    grandpa: { char: 'grandpa', facing: 'left' },
  },

  exits: {
    back_door: { name: 'back door', to: 'house', entry: 'garden', sfx: 'door_open', verbs: ['use', 'open', 'push'] },
  },

  hotspots: {
    gate: { name: 'garden gate' },
    bench: { name: 'bench' },
    gnome: { name: 'garden gnome' },
    tree: { name: 'cherry tree' },
    can: { name: 'watering can' },
  },

  look: {
    tank: ['A big water tank. Full to the top.', 'Something is at the bottom. Something key-shaped?'],
    spare_pipe: 'A spare pipe, lying in the dirt.',
    grandpa: ['Grandpa. He carried his armchair outside. For the sun.', 'He is "fixing the pipes". With his eyes closed.'],
    back_door: 'Back to Grandma\'s house.',
    gate: 'The street. Full of dogs. No thanks.',
    bench: 'A bench. Nobody sits on it. Grandpa prefers his armchair.',
    gnome: ['A garden gnome. He has seen things.', 'He never blinks. Respect.'],
    tree: 'A cherry tree. Birds live up there. Birds! ...Focus, Pixel. Sardines.',
    can: 'A watering can. Empty. Like my food bowl.',
  },

  on: [
    { id: 'garden.take-spare-pipe', verb: 'take', a: 'spare_pipe', do: [{ set: 'pipe_taken' }, { gain: 'pipe' }, { sfx: 'metal' }, 'A pipe! Grandpa will not miss it. He is asleep.'] },

    // The tank: the tap is stuck, the pipe opens another way out (pipes minigame).
    { id: 'garden.use-pipe-tank', verb: 'use', a: 'pipe', b: 'tank', if: '!tank_drained', do: [
      { minigame: 'pipes', params: {
        tiles: { ground: 'pipes/r3c1', straight: ['pipes/r3c2', 'pipes/r3c5'], elbow: ['pipes/r3c3', 'pipes/r3c6'], tee: ['pipes/r3c4', 'pipes/r4c1'] },
        source: 'pipes/r4c2', nozzle: ['pipes/r4c3', 'pipes/r4c4'], tank: 'house/r3c5', mushrooms: ['house/r4c5', 'house/r4c6'],
        intro: 'Tap a pipe to turn it. Bring the water to the mushrooms.', win: 'The mushrooms are drinking!',
      }, then: [
        { used: 'pipe' },
        { cutscene: [
          { prop: ['tank', 'draining'] }, { sfx: 'drop' }, { shake: 300 }, { set: 'tank_drained' },
          { pose: ['grandpa', 'surprised'] },
          { say: ['grandpa', 'Look! Something at the bottom!'] },
          { wait: 500 },
          'That is not a key. That is a sock.',
          { pose: ['grandpa', 'idle'] },
        ] },
      ] },
    ] },
    { id: 'garden.use-tank', verb: ['use', 'open', 'pull'], a: 'tank', if: '!tank_drained', do: ['The tap is stuck. The water needs another way out. A pipe, maybe?'] },
    { id: 'garden.use-tank-2', verb: ['use', 'open', 'pull'], a: 'tank', do: ['Empty-ish. The only treasure was a sock.'] },
    { id: 'garden.look-tank', verb: 'look', a: 'tank', if: 'tank_drained', do: ['Draining. Slowly. Very slowly.'] },

    // The sock and its note: Lou has the key.
    { id: 'garden.look-sock', verb: 'look', a: 'sock', do: [
      { if: '!lou_has_key', then: [
        { sfx: 'paper' }, 'A wet sock. With a note inside!', 'It says: "Borrowed the key to copy it. Lou."', { set: 'lou_has_key' },
        { say: ['grandpa', 'Lou, the neighbour! Call Lou with the shell phone.'] },
      ], else: ['A sock. Lou leaves socks everywhere.'] },
    ] },
    { id: 'garden.take-sock', verb: 'take', a: 'sock', do: ['A wet sock. Cat rule number two: never touch wet things.'] },

    { id: 'garden.open-gate', verb: ['open', 'use'], a: 'gate', do: ['Dogs. Street. No.'] },
    { id: 'garden.push-gnome', verb: 'push', a: 'gnome', do: ['He does not move. He has roots.'] },
    { id: 'garden.use-tree', verb: ['use', 'pull'], a: 'tree', do: ['I could climb it. But sardines do not grow on trees.'] },
    { id: 'garden.take-can', verb: ['take', 'use'], a: 'can', do: ['Empty. I am not carrying an empty can around.'] },
  ],

  talk: {
    grandpa: [
      { id: 'garden.grandpa.where-is-the-key', topic: 'Where is the key?', if: '!tank_drained', do: [
        { id: 'garden.grandpa.where-is-the-key.nth', nth: [
          [{ say: ['grandpa', 'The key? It fell in the water tank. Plop.'] }, { say: ['grandpa', 'Drain it. But the tap is stuck.'] }],
          [{ say: ['grandpa', 'Still stuck? Try a pipe. Pipes are good with water.'] }],
          [{ pose: ['grandpa', 'laugh'] }, { say: ['grandpa', 'Ha! A cat doing plumbing. I love it.'] }, { pose: ['grandpa', 'idle'] }],
        ] },
      ] },
      { id: 'garden.grandpa.there-was-no-key-in-the', topic: 'There was no key in the tank!', if: 'tank_drained', do: [
        { say: ['grandpa', 'No? Only a sock? Read the sock. Socks always have something to say.'] },
      ] },
      { id: 'garden.grandpa.why-is-your-armchair', topic: 'Why is your armchair outside?', do: [{ say: ['grandpa', 'It wanted some sun. Armchairs need vitamins too.'] }] },
      { id: 'garden.grandpa.are-you-fixing-the-pipes', topic: 'Are you fixing the pipes?', do: [
        { say: ['grandpa', 'Yes. With my eyes closed. I am an expert.'] },
        { pose: ['grandpa', 'slumped'] }, { wait: 900 }, { pose: ['grandpa', 'idle'] },
      ] },
    ],
  },

  hints: [
    { until: { any: ['pipe_taken', 'tank_drained'] }, lines: ['There is a spare pipe on the ground. Take it, sweetie.'] },
    { until: 'tank_drained', lines: ['Use the pipe on the water tank.', 'Pipe. Tank. Together. Go!'] },
    { until: 'lou_has_key', lines: ['Something came out of the tank. Look at it.'] },
    { until: { unlocked: 'market' }, lines: ['Talk into my shell phone and call Lou.'] },
    { until: { has: 'key' }, lines: ['Lou is at the market. Open the map.'] },
    { until: 'pantry_open', lines: ['Come home with that key, sweetie!'] },
  ],

  onEnter: [
    { id: 'garden.enter.once', once: [
      { say: ['grandpa', 'Pixel! Did you come to help me fix the pipes?'] },
      'I came for a key. And sardines.',
    ] },
  ],
});
