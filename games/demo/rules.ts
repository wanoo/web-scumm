import type { GameRules } from '@engine/core/types';

// Fallback answers per verb (drawn at random, never twice in a row), reactions by kind, and rules valid in every room.
export const rules: GameRules = {
  fallbacks: {
    give: ['Nobody wants {objet}. Their loss.', 'I will keep it. Cats keep things.'],
    open: ['It does not open. I pushed it with my nose.', 'Closed. Very closed.'],
    close: ['Already closed. Like my eyes, most of the day.', 'Nothing to close.'],
    take: ['Too heavy. I am a small cat.', 'I will leave it there. For now.', 'Paws off, Pixel.'],
    look: ['Hmm. {nom}. Nothing to eat there.', 'Looks like {nom}. Not like sardines.'],
    talk: ['No answer. Rude.', 'It does not speak cat.'],
    use: ['Nothing happens. I tried my best paw.', 'That does nothing. Yet.'],
    push: ['It does not move. I need more breakfast.', 'Push, push... nope.'],
    pull: ['It does not budge.', 'I pull. It stays. We are even.'],
    use2: ['{objet} with {cible}? No. Good try though.', 'These do not go together. Like cats and baths.'],
  },
  kinds: [
    { verb: 'pull', kind: 'cat', say: 'Never pull a cat. Cat law, article one.' },
    { verb: 'push', kind: 'cat', say: 'Never push a sleeping cat. Cat law, article two.' },
    { verb: 'take', kind: 'cat', say: '{nom} is heavier than he looks. Mostly fur.' },
    { verb: 'talk', kind: 'cat', say: '{nom} says: zzzz. Very deep thoughts.' },
    { verb: ['use', 'give'], kind: 'cat', say: '{nom} purrs and goes back to sleep.' },
    { verb: 'take', kind: 'person', say: 'I cannot carry {nom}. But {nom} can carry me.' },
    { verb: ['push', 'pull'], kind: 'person', say: 'Pushing people around? Not my style. I am a nice cat.' },
  ],
  on: [
    // Once the note is read, the shell phone calls Lou (two voices on the line). Before that, it gives hints.
    { id: 'game.talk-shell-phone', verb: 'talk', a: 'shell_phone', if: { all: ['lou_has_key', { not: { unlocked: 'market' } }] }, do: [
      'Shell phone, call Lou!',
      { phone: ['neighbor', 'seller'], do: [
        { say: ['neighbor', 'Lou speaking. Oh, hi Pixel!'] },
        'Lou! You have Grandma\'s key!',
        { say: ['neighbor', 'Had. I am at the market. Come and get it!'] },
        { say: ['seller', 'LOU! Your lantern is ready!'], shout: true },
        { say: ['neighbor', 'Hurry up, it is busy here. Bye!'] },
      ] },
      { unlock: 'market' }, { sfx: 'bell' }, { toast: 'New on the map: the market' },
    ] },
  ],
};
