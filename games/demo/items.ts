import type { ItemDef } from '@engine/core/types';

// Inventory items. `look` as a list = one line per look, cycling.
export const items: Record<string, ItemDef> = {
  shell_phone: {
    name: 'shell phone', icon: 'items/r4c3',
    look: ['Grandma\'s shell phone. Talk into it and Grandma answers.', 'It smells like the sea. And a bit like Grandma.',
      'Still a shell. Still a phone.', 'If I hold it to my ear, I hear the ocean. And Grandma knitting.'],
  },
  token: { name: 'market token', icon: 'items/r2c2', look: 'A market token with a big star. Worth one go at something.' },
  pipe: { name: 'pipe', icon: 'house/r4c1', look: 'A piece of pipe. Water goes in, water goes out. Like me with milk.' },
  bouquet: { name: 'bouquet', icon: 'items/r2c1', look: ['A pretty bouquet. Picked with paws.', 'Not edible. I checked.'] },
  key: { name: 'pantry key', icon: 'items/r2c4', look: 'The pantry key! It jingles like a tin of sardines.' },
};
