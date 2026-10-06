# 0005 · A save is read back before it counts

**Context.** Browsers lose writes: a full quota, a private window, a tab killed during a write, a storage evicted.
A save the player believes is there and is not is the worst bug a long game can have.

**Decision.** In the browser saves go to IndexedDB (`src/engine/dom/save-store.ts`): writes are serialised, the
committed envelope is read back and compared before the save is reported done, and a failure is shown to the player.
An update of the PWA waits for a verified save (`src/engine/dom/update.ts`). Without IndexedDB, a localStorage store
(`src/engine/dom/storage.ts`) is the fallback, and the e2e test that path.

**Cost.** A save takes a read more; the store is asynchronous everywhere.

**Would change it.** A storage API that confirms durability by itself, in every browser the project supports.
