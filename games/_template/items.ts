import type { ItemDef } from '@engine/core/types';

// Inventory items. `look` as a list = one line per look, cycling.
export const items: Record<string, ItemDef> = {
  note: { name: 'note', icon: 'items/note', look: ['A note. It says: "Make a game."', 'Still says the same thing.'] },
  bucket: { name: 'bucket', icon: 'items/bucket', look: 'A red bucket. Fits on a head.' },
};
