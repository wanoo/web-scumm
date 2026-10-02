import type { ItemDef } from '@engine/core/types';

// Inventory items. `look` as a list = one line per look, cycling.
export const items: Record<string, ItemDef> = {
  note: { name: 'note', icon: 'items/r1c5', look: ['A note. It says: "Make a game."', 'Still says the same thing.'] },
  bucket: { name: 'bucket', icon: 'home2/r4c2', look: 'A red bucket. Fits on a head.' },
};
