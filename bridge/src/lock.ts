// One asynchronous section at a time per key (a player, a pairing code). The store is synchronous, but `propose`
// and `confirmPairing` await Biscuit and the signature between their reads and their writes: in 4.1.1 two proposals
// for one player could read the same last sequence and both land, and one of them was then lost on the player's
// side as "already seen". A chain of promises per key serialises the sections; a key nobody waits on is forgotten.
export class KeyedLock {
  private tails = new Map<string, Promise<void>>();

  /** Runs `section` once every section queued before it on `key` has finished, and returns its result. */
  async run<T>(key: string, section: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((ok) => {
      release = ok;
    });
    const tail = previous.then(() => mine);
    this.tails.set(key, tail);
    await previous;
    try {
      return await section();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
